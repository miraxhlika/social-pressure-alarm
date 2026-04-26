import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import {
  FlowFooterButton,
  FlowIconBadge,
  FlowListRow,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore, saveNewAlarm, updateAlarm } from '@/lib/alarms';
import {
  CHECKPOINT_TEMPLATES,
  formatGracePeriodLabel,
  getCheckpointTemplate,
  getCheckpointTemplateDefaults,
} from '@/lib/checkpoint-templates';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { markOnboardingCompleted } from '@/lib/onboarding';
import { readAppPreferences } from '@/lib/preferences';
import {
  Alarm,
  AlarmProofStrictness,
  RepeatSchedule,
  UseCaseType,
} from '@/types/alarm';

type CameraBarcodeTypes = NonNullable<
  NonNullable<ComponentProps<typeof CameraView>['barcodeScannerSettings']>['barcodeTypes']
>;

const QR_BARCODE_TYPES: CameraBarcodeTypes = ['qr'];
const PROOF_CODE_BARCODE_TYPES: CameraBarcodeTypes = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code39',
  'code93',
  'code128',
  'codabar',
  'itf14',
  'pdf417',
  'aztec',
  'datamatrix',
];

const SCAN_DEDUPE_WINDOW_MS = 3000;

type LinkMode = 'generateQr' | 'scanQr' | 'scanBarcode' | 'manual';
type ScannerPurpose = 'link' | 'test';
type ExpandedField = 'name' | 'category' | 'schedule' | 'window' | 'recurrence' | 'place' | 'notes' | 'strictness' | null;

type FormErrors = {
  label?: string;
  expectedQrPayload?: string;
  gracePeriodSeconds?: string;
};

const REPEAT_OPTIONS: { value: RepeatSchedule; label: string; help: string }[] = [
  { value: 'once', label: 'One-time', help: 'Runs once' },
  { value: 'daily', label: 'Daily', help: 'Every day' },
  { value: 'weekdays', label: 'Weekdays', help: 'Mon to Fri' },
];

const GRACE_PRESET_OPTIONS = [
  { value: 45, label: '45 sec', help: 'Very close' },
  { value: 90, label: '90 sec', help: 'Short walk' },
  { value: 120, label: '2 min', help: 'Balanced' },
  { value: 180, label: '3 min', help: 'Forgiving' },
] as const;

const STRICTNESS_OPTIONS: { value: AlarmProofStrictness; label: string; help: string }[] = [
  { value: 'strict', label: 'Strict', help: 'Exact saved code only.' },
  { value: 'standard', label: 'Standard', help: 'Exact match with softer guidance.' },
];

function createInitialTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

function normalizeRepeatScheduleParam(value: string | undefined, fallback: RepeatSchedule) {
  return value === 'daily' || value === 'weekdays' || value === 'once' ? value : fallback;
}

function normalizeReturnToParam(value: string | undefined): Href {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  const [pathname] = value.split('?');
  const isAllowedReturn =
    pathname === '/' ||
    pathname === '/alarms' ||
    pathname === '/circles' ||
    pathname === '/account' ||
    pathname === '/history' ||
    pathname === '/missed' ||
    pathname.startsWith('/checkpoint/');

  return isAllowedReturn ? (value as Href) : '/';
}

function getRepeatLabel(repeatSchedule: RepeatSchedule) {
  switch (repeatSchedule) {
    case 'daily':
      return 'Daily';
    case 'weekdays':
      return 'Weekdays';
    default:
      return 'None';
  }
}

function getLinkModeLabel(linkMode: LinkMode) {
  switch (linkMode) {
    case 'generateQr':
      return 'Generated QR';
    case 'scanBarcode':
      return 'Scanned barcode';
    case 'manual':
      return 'Manual entry';
    default:
      return 'Scanned QR';
  }
}

function createGeneratedProofPayload(label: string) {
  const seed = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `spa:${seed || 'checkpoint'}:${Date.now().toString(36)}:${randomSuffix}`;
}

function buildSavedCodeId(payload: string) {
  let hash = 0;

  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }

  return `CP-${hash.toString(16).toUpperCase().padStart(8, '0').slice(0, 4)}-${payload.length
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')}`;
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    alarmId?: string;
    mode?: string;
    onboardingMode?: string;
    recoveryFocus?: string;
    prefillUseCaseType?: string;
    prefillLabel?: string;
    prefillRepeatSchedule?: string;
    prefillGracePeriodSeconds?: string;
    returnTo?: string;
  }>();
  const colors = getAppColors(useColorScheme());
  const [time, setTime] = useState(createInitialTime);
  const [label, setLabel] = useState('');
  const [useCaseType, setUseCaseType] = useState<UseCaseType>('custom');
  const [placeObject, setPlaceObject] = useState('');
  const [notes, setNotes] = useState('');
  const [proofStrictness, setProofStrictness] = useState<AlarmProofStrictness>('strict');
  const [expectedQrPayload, setExpectedQrPayload] = useState('');
  const [linkMode, setLinkMode] = useState<LinkMode>('scanQr');
  const [proofCodeCapturedAt, setProofCodeCapturedAt] = useState<string | null>(null);
  const [proofCodeVerifiedAt, setProofCodeVerifiedAt] = useState<string | null>(null);
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>('once');
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState('120');
  const [isSaving, setIsSaving] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scannerPurpose, setScannerPurpose] = useState<ScannerPurpose>('link');
  const [scannerMessage, setScannerMessage] = useState('');
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [expandedField, setExpandedField] = useState<ExpandedField>(null);
  const [sourceAlarm, setSourceAlarm] = useState<Alarm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [permission, requestPermission] = useCameraPermissions();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScannedPayloadRef = useRef<{ payload: string; purpose: ScannerPurpose; scannedAt: number } | null>(null);
  const isEditMode = params.mode === 'edit' && typeof params.alarmId === 'string';
  const isReuseMode = params.mode === 'reuse' && typeof params.alarmId === 'string';
  const isOnboardingConversion = params.onboardingMode === 'convert_demo';
  const returnTo = useMemo(() => normalizeReturnToParam(params.returnTo), [params.returnTo]);
  const selectedTemplate = getCheckpointTemplate(useCaseType);
  const parsedGracePeriod = Number.parseInt(gracePeriodSeconds, 10);
  const gracePreviewSeconds = Number.isFinite(parsedGracePeriod) ? Math.max(parsedGracePeriod, 0) : 0;
  const hasLinkedProofCode = expectedQrPayload.trim().length > 0;
  const shouldSaveFromDetailsStep = activeStep === 1 && hasLinkedProofCode;
  let footerButtonLabel = 'Continue to Link Code';
  let footerHelperCopy = 'You can edit these details anytime.';

  if (activeStep === 2) {
    footerButtonLabel = 'Continue';
    footerHelperCopy = hasLinkedProofCode
      ? 'Code linked. Continue to review your checkpoint.'
      : 'Link a code before saving this checkpoint.';
  } else if (shouldSaveFromDetailsStep) {
    footerButtonLabel = isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Checkpoint';
    footerHelperCopy = 'Code linked. You can save or tap Link Code to retest.';
  }
  const formattedTime = useMemo(
    () =>
      time.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time]
  );
  const checkpointName = label.trim() || selectedTemplate.defaultLabel || 'Checkpoint name';
  const placeObjectLabel = placeObject.trim() || checkpointName;
  const shouldShowCameraFallback = Boolean(
    scannerMessage &&
      !isScannerVisible &&
      !permission?.granted &&
      (scannerPurpose === 'test' || linkMode === 'scanQr' || linkMode === 'scanBarcode')
  );
  const cameraFallbackTitle = permission?.canAskAgain === false ? 'Camera is blocked' : 'Camera is not ready';
  const cameraFallbackActionLabel = permission?.canAskAgain === false ? 'Open settings' : 'Allow camera';

  const handleTimeChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) {
      return;
    }

    setTime(selectedDate);
  };

  useEffect(() => {
    const loadFormData = async () => {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const [store, appPreferences] = await Promise.all([readAlarmStore(), readAppPreferences()]);
      setErrors({});
      setActiveStep(1);

      if (!params.alarmId || (!isEditMode && !isReuseMode)) {
        const prefilledTemplate = getCheckpointTemplateDefaults(params.prefillUseCaseType);
        const prefilledGracePeriod = Number.parseInt(params.prefillGracePeriodSeconds ?? '', 10);

        setSourceAlarm(null);
        setUseCaseType(prefilledTemplate.useCaseType);
        setLabel(typeof params.prefillLabel === 'string' ? params.prefillLabel : prefilledTemplate.label);
        setPlaceObject('');
        setNotes('');
        setProofStrictness(appPreferences.defaultProofStrictness);
        setExpectedQrPayload('');
        setLinkMode('scanQr');
        setProofCodeCapturedAt(null);
        setProofCodeVerifiedAt(null);
        setRepeatSchedule(normalizeRepeatScheduleParam(params.prefillRepeatSchedule, prefilledTemplate.repeatSchedule));
        setGracePeriodSeconds(
          Number.isFinite(prefilledGracePeriod) && prefilledGracePeriod >= 15
            ? String(prefilledGracePeriod)
            : String(prefilledTemplate.gracePeriodSeconds)
        );
        return;
      }

      const alarm = store.alarms.find((candidate) => candidate.id === params.alarmId) ?? null;

      if (!alarm) {
        setSourceAlarm(null);
        setUseCaseType('custom');
        setLabel('');
        setPlaceObject('');
        setNotes('');
        setProofStrictness(appPreferences.defaultProofStrictness);
        setExpectedQrPayload('');
        setLinkMode('scanQr');
        setProofCodeCapturedAt(null);
        setProofCodeVerifiedAt(null);
        return;
      }

      const nextTime = createInitialTime();
      nextTime.setHours(alarm.hour, alarm.minute, 0, 0);

      setSourceAlarm(alarm);
      setTime(nextTime);
      setLabel(alarm.label);
      setUseCaseType(alarm.useCaseType);
      setPlaceObject(alarm.placeObject ?? '');
      setNotes(alarm.notes ?? '');
      setProofStrictness(alarm.proofStrictness);
      setExpectedQrPayload(alarm.expectedQrPayload);
      setLinkMode('manual');
      setProofCodeCapturedAt(alarm.createdAt);
      setProofCodeVerifiedAt(null);
      setRepeatSchedule(alarm.repeatSchedule);
      setGracePeriodSeconds(String(alarm.gracePeriodSeconds));
    };

    void loadFormData();
  }, [
    isEditMode,
    isReuseMode,
    params.alarmId,
    params.prefillGracePeriodSeconds,
    params.prefillLabel,
    params.prefillRepeatSchedule,
    params.prefillUseCaseType,
  ]);

  useEffect(() => {
    return () => {
      if (scannerTimeoutRef.current) {
        clearTimeout(scannerTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeStep]);

  const toggleField = (field: NonNullable<ExpandedField>) => {
    setExpandedField((currentField) => (currentField === field ? null : field));
  };

  const validateDetailsStep = useCallback(() => {
    const nextErrors: FormErrors = {};

    if (!label.trim()) {
      nextErrors.label = 'Enter a checkpoint name.';
    }

    if (Number.isNaN(parsedGracePeriod) || parsedGracePeriod < 15) {
      nextErrors.gracePeriodSeconds = 'Use at least 15 seconds.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        ...nextErrors,
      }));
      return false;
    }

    return true;
  }, [label, parsedGracePeriod]);

  const handleReturnToDetailsStep = useCallback(() => {
    setActiveStep(1);
    setExpandedField(null);
    setIsScannerVisible(false);
  }, []);

  useEffect(() => {
    if (activeStep !== 2) {
      return undefined;
    }

    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      handleReturnToDetailsStep();
    });
  }, [activeStep, handleReturnToDetailsStep, navigation]);

  const handleOpenScanner = useCallback(async (mode: Extract<LinkMode, 'scanQr' | 'scanBarcode'>) => {
    setLinkMode(mode);
    setScannerPurpose('link');
    lastScannedPayloadRef.current = null;
    setScannerMessage('');

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScannerMessage('Camera access is required to scan a proof code into this checkpoint.');
        return;
      }
    }

    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [permission?.granted, requestPermission]);

  const handleOpenLinkCodeStep = useCallback(() => {
    setActiveStep(2);
    setExpandedField(null);

    if (!expectedQrPayload.trim()) {
      void handleOpenScanner(linkMode === 'scanBarcode' ? 'scanBarcode' : 'scanQr');
    }
  }, [expectedQrPayload, handleOpenScanner, linkMode]);

  const handleClearProofCode = useCallback(() => {
    setExpectedQrPayload('');
    setProofCodeCapturedAt(null);
    setProofCodeVerifiedAt(null);
    setErrors((currentErrors) => ({
      ...currentErrors,
      expectedQrPayload: undefined,
    }));
    void handleOpenScanner('scanQr');
  }, [handleOpenScanner]);

  const handleContinueToLinkCode = useCallback(() => {
    if (!validateDetailsStep()) {
      return;
    }

    handleOpenLinkCodeStep();
  }, [handleOpenLinkCodeStep, validateDetailsStep]);

  const handleGenerateProofCode = useCallback(() => {
    const generatedPayload = createGeneratedProofPayload(label || selectedTemplate.defaultLabel);

    setLinkMode('generateQr');
    setExpectedQrPayload(generatedPayload);
    setProofCodeCapturedAt(new Date().toISOString());
    setProofCodeVerifiedAt(null);
    setIsScannerVisible(false);
    setScannerPurpose('link');
    lastScannedPayloadRef.current = null;
    setScannerMessage('Generated a unique proof payload. Place the matching QR at the checkpoint.');
    setErrors((currentErrors) => ({
      ...currentErrors,
      expectedQrPayload: undefined,
    }));
  }, [label, selectedTemplate.defaultLabel]);

  const handleOpenTestScanner = useCallback(async () => {
    if (!expectedQrPayload.trim()) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        expectedQrPayload: 'Generate, scan, or paste a proof code before testing it.',
      }));
      return;
    }

    setScannerPurpose('test');
    lastScannedPayloadRef.current = null;
    setScannerMessage('Scan the saved QR code or barcode once to verify it matches this checkpoint.');

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScannerMessage('Camera access is required to test this proof code.');
        return;
      }
    }

    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [expectedQrPayload, permission?.granted, requestPermission]);

  const handleCameraFallbackAction = useCallback(async () => {
    if (permission?.canAskAgain === false) {
      await Linking.openSettings();
      return;
    }

    const response = await requestPermission();

    if (!response.granted) {
      setScannerMessage('Camera is still unavailable. Paste the exact QR or barcode payload instead.');
      return;
    }

    setScannerMessage(scannerPurpose === 'test' ? 'Camera ready. Scan the saved proof code to verify it.' : '');
    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [permission?.canAskAgain, requestPermission, scannerPurpose]);

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!isScannerEnabled) {
        return;
      }

      const scannedAt = Date.now();
      const previousScan = lastScannedPayloadRef.current;

      if (
        previousScan &&
        previousScan.payload === data &&
        previousScan.purpose === scannerPurpose &&
        scannedAt - previousScan.scannedAt < SCAN_DEDUPE_WINDOW_MS
      ) {
        lastScannedPayloadRef.current = { ...previousScan, scannedAt };
        return;
      }

      lastScannedPayloadRef.current = { payload: data, purpose: scannerPurpose, scannedAt };
      setIsScannerEnabled(false);

      if (scannerPurpose === 'test') {
        const didMatch = data.trim() === expectedQrPayload.trim();

        setProofCodeVerifiedAt(didMatch ? new Date().toISOString() : null);
        setScannerMessage(
          didMatch
            ? 'Test scan matched. This code is ready for the live checkpoint.'
            : 'Test scan did not match. The live checkpoint will reject this code.'
        );
        setIsScannerVisible(false);

        if (scannerTimeoutRef.current) {
          clearTimeout(scannerTimeoutRef.current);
        }

        scannerTimeoutRef.current = setTimeout(() => {
          setIsScannerEnabled(true);
        }, 500);

        return;
      }

      setExpectedQrPayload(data);
      setProofCodeCapturedAt(new Date().toISOString());
      setProofCodeVerifiedAt(null);
      setErrors((currentErrors) => ({
        ...currentErrors,
        expectedQrPayload: undefined,
      }));
      setScannerMessage(linkMode === 'scanBarcode' ? 'Barcode payload captured.' : 'QR payload captured.');
      setIsScannerVisible(false);

      if (scannerTimeoutRef.current) {
        clearTimeout(scannerTimeoutRef.current);
      }

      scannerTimeoutRef.current = setTimeout(() => {
        setIsScannerEnabled(true);
      }, 500);
    },
    [expectedQrPayload, isScannerEnabled, linkMode, scannerPurpose]
  );

  const handleCancel = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(returnTo);
  }, [returnTo, router]);

  const handleSave = useCallback(async () => {
    const trimmedLabel = label.trim();
    const trimmedPlaceObject = placeObject.trim();
    const trimmedNotes = notes.trim();
    const trimmedExpectedQrPayload = expectedQrPayload.trim();
    const gracePeriod = Number.parseInt(gracePeriodSeconds, 10);
    const nextErrors: FormErrors = {};

    if (!trimmedLabel) {
      nextErrors.label = 'Enter a checkpoint name.';
    }

    if (!trimmedExpectedQrPayload) {
      nextErrors.expectedQrPayload = 'Generate, scan, or paste the exact code this checkpoint should accept.';
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      nextErrors.gracePeriodSeconds = 'Use 15 seconds or more.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      if (nextErrors.label || nextErrors.gracePeriodSeconds) {
        setActiveStep(1);
      }
      return;
    }

    setErrors({});

    const store = await readAlarmStore();

    setIsSaving(true);

    let scheduledNotificationIds: string[] | undefined;

    try {
      const hasNotificationPermission = await ensureNotificationPermissionsAsync();

      if (!hasNotificationPermission) {
        alertNotificationPermission();
        return;
      }

      const alarmId = isEditMode && sourceAlarm ? sourceAlarm.id : `${Date.now()}`;
      const baseAlarm: Alarm = {
        id: alarmId,
        hour: time.getHours(),
        minute: time.getMinutes(),
        label: trimmedLabel,
        useCaseType,
        placeObject: trimmedPlaceObject || trimmedLabel,
        notes: trimmedNotes || undefined,
        proofStrictness,
        expectedQrPayload: trimmedExpectedQrPayload,
        repeatSchedule,
        gracePeriodSeconds: gracePeriod,
        isActive: true,
        createdAt: isEditMode && sourceAlarm ? sourceAlarm.createdAt : new Date().toISOString(),
        socialSettings: isEditMode ? sourceAlarm?.socialSettings : undefined,
        lastOutcome: undefined,
      };

      const scheduled = await scheduleAlarmNotificationAsync(baseAlarm);
      scheduledNotificationIds = scheduled.notificationIds;

      if (isEditMode && sourceAlarm?.notificationIds) {
        await cancelAlarmNotificationAsync(sourceAlarm.notificationIds);
      }

      const nextAlarm: Alarm = {
        ...baseAlarm,
        notificationIds: scheduled.notificationIds,
        scheduledFor: scheduled.scheduledFor,
        notificationStrategyKey: scheduled.strategyKey,
      };

      if (isEditMode && sourceAlarm) {
        await updateAlarm(nextAlarm);
      } else {
        await saveNewAlarm(nextAlarm);
        await trackAnalyticsEvent('recurring_checkpoint_saved', {
          checkpointId: nextAlarm.id,
          useCaseType,
          repeatSchedule,
          gracePeriodSeconds: gracePeriod,
          creationCountBeforeSave: store.lifetimeAlarmCreations,
          source: isReuseMode ? 'reuse' : 'new',
          socialMode: 'private',
        });
      }

      if (isOnboardingConversion && !isEditMode) {
        await markOnboardingCompleted();
        router.replace({
          pathname: '/success',
          params: {
            alarmId: nextAlarm.id,
            label: nextAlarm.label,
            mode: 'setup_complete',
            promptSecondCheckpoint: store.lifetimeAlarmCreations === 0 ? '1' : '0',
          },
        });
        return;
      }

      router.replace(returnTo);
    } catch (error) {
      if (scheduledNotificationIds) {
        await cancelAlarmNotificationAsync(scheduledNotificationIds);
      }

      const errorMessage = error instanceof Error ? error.message : 'The checkpoint could not be saved right now.';

      Alert.alert('Unable to save checkpoint', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [
    expectedQrPayload,
    gracePeriodSeconds,
    isEditMode,
    isOnboardingConversion,
    isReuseMode,
    label,
    notes,
    placeObject,
    proofStrictness,
    repeatSchedule,
    returnTo,
    router,
    sourceAlarm,
    time,
    useCaseType,
  ]);

  return (
    <AppScreen
      backgroundColor={colors.elevated}
      contentStyle={styles.screenContent}
      footer={
        <View style={styles.bottomFooter}>
          <FlowFooterButton
            disabled={isSaving}
            icon={activeStep === 2 ? 'arrow-forward' : 'add'}
            label={footerButtonLabel}
            onPress={activeStep === 2 ? handleReturnToDetailsStep : shouldSaveFromDetailsStep ? handleSave : handleContinueToLinkCode}
          />
          <View style={styles.footerHelper}>
            <Ionicons color={colors.muted} name="lock-closed-outline" size={12} />
            <Text style={[styles.footerHelperText, { color: colors.textSoft }]}>{footerHelperCopy}</Text>
          </View>
        </View>
      }
      keyboardAware
      scrollRef={scrollViewRef}>
      <FlowTopBar
        leftAccessibilityLabel={activeStep === 1 ? 'Close create checkpoint' : 'Back to create checkpoint'}
        leftIcon="chevron-back"
        onLeftPress={activeStep === 1 ? handleCancel : handleReturnToDetailsStep}
        subtitle={activeStep === 1 ? 'Define what to prove, when, and where.' : 'Link the exact code that proves it.'}
        title={activeStep === 1 ? 'Create Checkpoint' : 'Link QR / Barcode'}
      />

      {activeStep === 1 ? (
        <CreateDetailsStep
          colors={colors}
          errors={errors}
          expandedField={expandedField}
          formattedTime={formattedTime}
          gracePeriodSeconds={gracePeriodSeconds}
          gracePreviewSeconds={gracePreviewSeconds}
          label={label}
          proofCodeVerifiedAt={proofCodeVerifiedAt}
          hasLinkedProofCode={hasLinkedProofCode}
          notes={notes}
          onExpectedCodePress={handleOpenLinkCodeStep}
          onFieldToggle={toggleField}
          onGracePeriodChange={(nextValue) => {
            setGracePeriodSeconds(nextValue);
            setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
          }}
          onLabelChange={(nextValue) => {
            setLabel(nextValue);
            setErrors((currentErrors) => ({ ...currentErrors, label: undefined }));
          }}
          onNotesChange={setNotes}
          onPlaceObjectChange={setPlaceObject}
          onProofStrictnessChange={setProofStrictness}
          onRepeatScheduleChange={setRepeatSchedule}
          onTemplateSelect={(nextUseCaseType) => {
            const defaults = getCheckpointTemplateDefaults(nextUseCaseType);
            setUseCaseType(defaults.useCaseType);
            setRepeatSchedule(defaults.repeatSchedule);
            setGracePeriodSeconds(String(defaults.gracePeriodSeconds));
            setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
          }}
          onTimeChange={handleTimeChange}
          placeObject={placeObject}
          proofStrictness={proofStrictness}
          repeatSchedule={repeatSchedule}
          selectedTemplate={selectedTemplate}
          time={time}
        />
      ) : (
        <LinkCodeStep
          cameraFallbackActionLabel={cameraFallbackActionLabel}
          cameraFallbackTitle={cameraFallbackTitle}
          colors={colors}
          error={errors.expectedQrPayload}
          expectedQrPayload={expectedQrPayload}
          isScannerEnabled={isScannerEnabled}
          isScannerVisible={isScannerVisible}
          linkMode={linkMode}
          onBarcodeScanned={handleBarcodeScanned}
          onCameraFallbackAction={handleCameraFallbackAction}
          onClearCode={handleClearProofCode}
          onGenerate={handleGenerateProofCode}
          onHideScanner={() => setIsScannerVisible(false)}
          onOpenScanner={handleOpenScanner}
          onOpenTestScanner={handleOpenTestScanner}
          permissionGranted={Boolean(permission?.granted)}
          placeObjectLabel={placeObjectLabel}
          proofCodeCapturedAt={proofCodeCapturedAt}
          proofCodeVerifiedAt={proofCodeVerifiedAt}
          scannerMessage={scannerMessage}
          scannerPurpose={scannerPurpose}
          shouldShowCameraFallback={shouldShowCameraFallback}
          strictnessLabel={proofStrictness === 'strict' ? 'Exact matching is required.' : 'Exact match with guided fallback.'}
        />
      )}
    </AppScreen>
  );
}

function CreateDetailsStep({
  colors,
  errors,
  expandedField,
  formattedTime,
  gracePeriodSeconds,
  gracePreviewSeconds,
  hasLinkedProofCode,
  label,
  notes,
  onExpectedCodePress,
  onFieldToggle,
  onGracePeriodChange,
  onLabelChange,
  onNotesChange,
  onPlaceObjectChange,
  onProofStrictnessChange,
  onRepeatScheduleChange,
  onTemplateSelect,
  onTimeChange,
  placeObject,
  proofCodeVerifiedAt,
  proofStrictness,
  repeatSchedule,
  selectedTemplate,
  time,
}: {
  colors: ReturnType<typeof getAppColors>;
  errors: FormErrors;
  expandedField: ExpandedField;
  formattedTime: string;
  gracePeriodSeconds: string;
  gracePreviewSeconds: number;
  hasLinkedProofCode: boolean;
  label: string;
  notes: string;
  onExpectedCodePress: () => void;
  onFieldToggle: (field: NonNullable<ExpandedField>) => void;
  onGracePeriodChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onPlaceObjectChange: (value: string) => void;
  onProofStrictnessChange: (value: AlarmProofStrictness) => void;
  onRepeatScheduleChange: (value: RepeatSchedule) => void;
  onTemplateSelect: (value: UseCaseType) => void;
  onTimeChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  placeObject: string;
  proofCodeVerifiedAt: string | null;
  proofStrictness: AlarmProofStrictness;
  repeatSchedule: RepeatSchedule;
  selectedTemplate: ReturnType<typeof getCheckpointTemplate>;
  time: Date;
}) {
  const checkpointTitle = label.trim() || selectedTemplate.defaultLabel || 'Enter a clear name';

  return (
    <FlowPanel style={styles.formPanel}>
      <CreateFieldRow
        description={label.trim() ? 'Tap to rename' : 'Enter a clear name'}
        expanded={expandedField === 'name'}
        icon="clipboard-outline"
        onPress={() => onFieldToggle('name')}
        title="Checkpoint Name"
        value={checkpointTitle}>
        <AppInput
          autoCapitalize="words"
          error={errors.label}
          label="Name"
          onChangeText={onLabelChange}
          placeholder={selectedTemplate.defaultLabel || 'Morning Medication'}
          value={label}
        />
      </CreateFieldRow>

      <CreateFieldRow
        description="Select a category"
        expanded={expandedField === 'category'}
        icon="calendar-clear-outline"
        onPress={() => onFieldToggle('category')}
        title="Category"
        value={selectedTemplate.title}>
        <View style={styles.optionGrid}>
          {CHECKPOINT_TEMPLATES.map((template) => (
            <OptionChip
              key={template.id}
              onPress={() => onTemplateSelect(template.id)}
              selected={template.id === selectedTemplate.id}
              title={template.shortTitle}
            />
          ))}
        </View>
      </CreateFieldRow>

      <CreateFieldRow
        description="One-time or recurring"
        expanded={expandedField === 'schedule'}
        icon="alarm-outline"
        onPress={() => onFieldToggle('schedule')}
        title="Schedule"
        value={formattedTime}>
        <View style={[styles.pickerPanel, { backgroundColor: colors.panelMuted }]}>
          <Text style={[TextPresets.label, { color: colors.text }]}>Trigger time</Text>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            mode="time"
            onChange={onTimeChange}
            value={time}
          />
        </View>
      </CreateFieldRow>

      <CreateFieldRow
        description="Set the time window"
        expanded={expandedField === 'window'}
        icon="time-outline"
        onPress={() => onFieldToggle('window')}
        title="Due Window"
        value={formatGracePeriodLabel(gracePreviewSeconds || 0)}>
        <View style={styles.optionGrid}>
          {GRACE_PRESET_OPTIONS.map((option) => (
            <OptionChip
              description={option.help}
              key={option.value}
              onPress={() => onGracePeriodChange(String(option.value))}
              selected={Number.parseInt(gracePeriodSeconds, 10) === option.value}
              title={option.label}
            />
          ))}
        </View>
        <AppInput
          error={errors.gracePeriodSeconds}
          helper="Use 15 seconds or more."
          keyboardType="number-pad"
          label="Custom seconds"
          onChangeText={onGracePeriodChange}
          placeholder="120"
          value={gracePeriodSeconds}
        />
      </CreateFieldRow>

      <CreateFieldRow
        description="How often it repeats"
        expanded={expandedField === 'recurrence'}
        icon="repeat-outline"
        onPress={() => onFieldToggle('recurrence')}
        title="Recurrence"
        value={getRepeatLabel(repeatSchedule)}>
        <View style={styles.optionGrid}>
          {REPEAT_OPTIONS.map((option) => (
            <OptionChip
              description={option.help}
              key={option.value}
              onPress={() => onRepeatScheduleChange(option.value)}
              selected={repeatSchedule === option.value}
              title={option.label}
            />
          ))}
        </View>
      </CreateFieldRow>

      <CreateFieldRow
        description={hasLinkedProofCode ? 'Tap to review or test' : 'Link a QR / Barcode'}
        expanded={false}
        icon="link-outline"
        onPress={onExpectedCodePress}
        title="Link Code"
        value={hasLinkedProofCode ? (proofCodeVerifiedAt ? 'Tested' : 'Linked') : 'Next'} />

      <CreateFieldRow
        description="Describe where or what"
        expanded={expandedField === 'place'}
        icon="location-outline"
        onPress={() => onFieldToggle('place')}
        title="Place / Object"
        value={placeObject.trim() || 'Add'}>
        <AppInput
          autoCapitalize="words"
          label="Place / Object"
          onChangeText={onPlaceObjectChange}
          placeholder="Mailbox - Front Door"
          value={placeObject}
        />
      </CreateFieldRow>

      <CreateFieldRow
        description="Add any helpful details"
        expanded={expandedField === 'notes'}
        icon="document-text-outline"
        onPress={() => onFieldToggle('notes')}
        title="Notes (Optional)"
        value={notes.trim() ? 'Added' : 'None'}>
        <AppInput
          label="Notes"
          multiline
          onChangeText={onNotesChange}
          placeholder="Outside by the front entrance."
          value={notes}
        />
      </CreateFieldRow>

      <CreateFieldRow
        description="How strict the match should be"
        expanded={expandedField === 'strictness'}
        icon="flash-outline"
        onPress={() => onFieldToggle('strictness')}
        title="Strictness"
        value={proofStrictness === 'strict' ? 'Strict' : 'Standard'}>
        <View style={styles.optionGrid}>
          {STRICTNESS_OPTIONS.map((option) => (
            <OptionChip
              description={option.help}
              key={option.value}
              onPress={() => onProofStrictnessChange(option.value)}
              selected={proofStrictness === option.value}
              title={option.label}
            />
          ))}
        </View>
      </CreateFieldRow>
    </FlowPanel>
  );
}

function LinkCodeStep({
  cameraFallbackActionLabel,
  cameraFallbackTitle,
  colors,
  error,
  expectedQrPayload,
  isScannerEnabled,
  isScannerVisible,
  linkMode,
  onBarcodeScanned,
  onCameraFallbackAction,
  onClearCode,
  onGenerate,
  onHideScanner,
  onOpenScanner,
  onOpenTestScanner,
  permissionGranted,
  placeObjectLabel,
  proofCodeCapturedAt,
  proofCodeVerifiedAt,
  scannerMessage,
  scannerPurpose,
  shouldShowCameraFallback,
  strictnessLabel,
}: {
  cameraFallbackActionLabel: string;
  cameraFallbackTitle: string;
  colors: ReturnType<typeof getAppColors>;
  error?: string;
  expectedQrPayload: string;
  isScannerEnabled: boolean;
  isScannerVisible: boolean;
  linkMode: LinkMode;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onCameraFallbackAction: () => void;
  onClearCode: () => void;
  onGenerate: () => void;
  onHideScanner: () => void;
  onOpenScanner: (mode: Extract<LinkMode, 'scanQr' | 'scanBarcode'>) => void;
  onOpenTestScanner: () => void;
  permissionGranted: boolean;
  placeObjectLabel: string;
  proofCodeCapturedAt: string | null;
  proofCodeVerifiedAt: string | null;
  scannerMessage: string;
  scannerPurpose: ScannerPurpose;
  shouldShowCameraFallback: boolean;
  strictnessLabel: string;
}) {
  const activeBarcodeTypes =
    scannerPurpose === 'test' || linkMode === 'scanBarcode' ? PROOF_CODE_BARCODE_TYPES : QR_BARCODE_TYPES;
  const cameraScannerKey = `${scannerPurpose}:${linkMode}`;

  return (
    <>
      <View style={styles.scanModeGrid}>
        <LinkModeTile
          glyph="qr-code-outline"
          label="Generate New QR"
          onPress={onGenerate}
          selected={linkMode === 'generateQr'}
        />
        <LinkModeTile
          glyph="scan-outline"
          label="Scan QR Code"
          onPress={() => onOpenScanner('scanQr')}
          selected={linkMode === 'scanQr'}
        />
        <LinkModeTile
          glyph="barcode-outline"
          label="Scan Barcode"
          onPress={() => onOpenScanner('scanBarcode')}
          selected={linkMode === 'scanBarcode'}
        />
      </View>

      {isScannerVisible ? (
        <FlowPanel style={styles.scannerPanel}>
          <View style={styles.scannerHeader}>
            <View style={styles.scannerCopy}>
              <Text style={[TextPresets.label, { color: colors.text }]}>
                {scannerPurpose === 'test' ? 'Test scan' : linkMode === 'scanBarcode' ? 'Scan barcode' : 'Scan QR code'}
              </Text>
              <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>Hold the saved code inside the frame.</Text>
            </View>
            <AppButton label="Hide" onPress={onHideScanner} size="compact" variant="ghost" />
          </View>
          {permissionGranted ? (
            <CameraView
              key={cameraScannerKey}
              barcodeScannerSettings={{
                barcodeTypes: activeBarcodeTypes,
              }}
              onBarcodeScanned={isScannerEnabled ? onBarcodeScanned : undefined}
              style={styles.camera}
            />
          ) : null}
        </FlowPanel>
      ) : null}

      <FlowPanel>
        <FlowSectionLabel>SAVED CODE PREVIEW</FlowSectionLabel>
        {expectedQrPayload ? (
          <View style={[styles.codePreview, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
            <View style={styles.codePreviewHeader}>
              <Text style={[styles.savedBadge, { backgroundColor: colors.successSurface, color: colors.success }]}>
                {proofCodeVerifiedAt ? 'Tested' : 'Saved'}
              </Text>
              <AppButton label="Clear" onPress={onClearCode} size="compact" variant="danger" />
            </View>
            <QrMosaic payload={expectedQrPayload} />
            <Text style={[styles.codeId, { color: colors.text }]}>ID: {buildSavedCodeId(expectedQrPayload)}</Text>
            <Text style={[styles.codeTimestamp, { color: colors.textSoft }]}>
              {proofCodeCapturedAt
                ? `Created ${new Date(proofCodeCapturedAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : getLinkModeLabel(linkMode)}
            </Text>
          </View>
        ) : (
          <View style={[styles.emptyCodePreview, { borderColor: colors.line }]}>
            <FlowIconBadge icon="qr-code-outline" tone="muted" />
            <Text style={[TextPresets.label, { color: colors.text }]}>No code linked yet</Text>
            <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
              Generate a QR, scan an existing QR, or scan a barcode to link proof.
            </Text>
            {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}
          </View>
        )}
      </FlowPanel>

      <FlowPanel>
        <FlowSectionLabel>PLACE / OBJECT</FlowSectionLabel>
        <FlowListRow
          description="Outside by the front entrance"
          leading={<Ionicons color={colors.primary} name="location-outline" size={19} />}
          title={placeObjectLabel}
        />
      </FlowPanel>

      <FlowPanel>
        <FlowSectionLabel>TEST SCAN</FlowSectionLabel>
        <FlowListRow
          description="Verify this code matches"
          leading={<Ionicons color={colors.primary} name="scan-outline" size={19} />}
          onPress={onOpenTestScanner}
          statusLabel={proofCodeVerifiedAt ? 'Matched' : 'Test'}
          statusTone={proofCodeVerifiedAt ? 'success' : 'default'}
          title="Test Scan"
        />
      </FlowPanel>

      <FlowPanel style={styles.strictInfo} tone="muted">
        <View style={styles.strictInfoIcon}>
          <Ionicons color={colors.primary} name="shield-checkmark-outline" size={22} />
        </View>
        <View style={styles.strictInfoCopy}>
          <Text style={[TextPresets.label, { color: colors.text }]}>{strictnessLabel}</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            The scanned code must match this code exactly to check in.
          </Text>
        </View>
      </FlowPanel>

      {scannerMessage ? (
        <Text style={[TextPresets.body, styles.scannerMessage, { color: permissionGranted ? colors.textSoft : colors.danger }]}>
          {scannerMessage}
        </Text>
      ) : null}

      {shouldShowCameraFallback ? (
        <FlowPanel tone="warning">
          <Text style={[TextPresets.label, { color: colors.text }]}>{cameraFallbackTitle}</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            Scanning is fastest. If this device cannot use the camera, generate a new QR for this checkpoint.
          </Text>
          <AppButton label={cameraFallbackActionLabel} onPress={onCameraFallbackAction} size="compact" variant="secondary" />
        </FlowPanel>
      ) : null}
    </>
  );
}

function CreateFieldRow({
  children,
  description,
  expanded,
  icon,
  onPress,
  title,
  value,
}: {
  children?: React.ReactNode;
  description: string;
  expanded: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  title: string;
  value: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.fieldBlock}>
      <FlowListRow
        description={description}
        leading={<Ionicons color={colors.primary} name={icon} size={19} />}
        onPress={onPress}
        title={title}
        trailing={
          <Text numberOfLines={1} style={[styles.rowValue, { color: colors.textSoft }]}>
            {value}
          </Text>
        }
      />
      {expanded && children ? <View style={styles.fieldEditor}>{children}</View> : null}
    </View>
  );
}

function OptionChip({
  description,
  onPress,
  selected,
  title,
}: {
  description?: string;
  onPress: () => void;
  selected: boolean;
  title: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionChip,
        {
          backgroundColor: selected ? colors.primarySurface : colors.elevated,
          borderColor: selected ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.optionChipTitle, { color: selected ? colors.primary : colors.text }]}>{title}</Text>
      {description ? <Text style={[styles.optionChipDescription, { color: colors.textSoft }]}>{description}</Text> : null}
    </Pressable>
  );
}

function LinkModeTile({
  glyph,
  label,
  onPress,
  selected,
}: {
  glyph: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkModeTile,
        {
          backgroundColor: selected ? colors.primarySurface : colors.elevated,
          borderColor: selected ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <Ionicons color={selected ? colors.primary : colors.text} name={glyph} size={27} />
      <Text style={[styles.linkModeLabel, { color: selected ? colors.primary : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function QrMosaic({ payload }: { payload: string }) {
  const colors = getAppColors(useColorScheme());
  const cells = useMemo(() => createQrCells(payload), [payload]);

  return (
    <View style={[styles.qrMosaic, { backgroundColor: colors.elevated }]}>
      {cells.map((isActive, index) => (
        <View
          key={index}
          style={[
            styles.qrCell,
            {
              backgroundColor: isActive ? colors.text : 'transparent',
            },
          ]}
        />
      ))}
    </View>
  );
}

function createQrCells(payload: string) {
  const size = 13;
  let seed = 0;

  for (let index = 0; index < payload.length; index += 1) {
    seed = (seed * 33 + payload.charCodeAt(index)) >>> 0;
  }

  return Array.from({ length: size * size }).map((_, index) => {
    const row = Math.floor(index / size);
    const column = index % size;
    const inTopLeft = row < 4 && column < 4;
    const inTopRight = row < 4 && column > size - 5;
    const inBottomLeft = row > size - 5 && column < 4;

    if (inTopLeft || inTopRight || inBottomLeft) {
      const localRow = row < 4 ? row : row - (size - 4);
      const localColumn = column < 4 ? column : column - (size - 4);
      return localRow === 0 || localRow === 3 || localColumn === 0 || localColumn === 3 || (localRow === 2 && localColumn === 2);
    }

    return ((seed >> ((row + column) % 24)) + row * 7 + column * 11) % 3 !== 0;
  });
}

function alertNotificationPermission() {
  Alert.alert(
    'Notification permission needed',
    'Notifications are required so the checkpoint can go live on time.'
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  formPanel: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    gap: 7,
    padding: 0,
  },
  fieldBlock: {
    gap: 7,
  },
  fieldEditor: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  rowValue: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 96,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  optionChip: {
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 104,
    flexGrow: 1,
    gap: 2,
    minHeight: 50,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  optionChipTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  optionChipDescription: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  pickerPanel: {
    borderRadius: 10,
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  scanModeGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  linkModeTile: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    justifyContent: 'center',
    minHeight: 84,
    padding: 8,
  },
  linkModeLabel: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 15,
    textAlign: 'center',
  },
  scannerPanel: {
    gap: Spacing.md,
  },
  scannerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  scannerCopy: {
    flex: 1,
    gap: 2,
  },
  camera: {
    borderRadius: Radius.lg,
    height: 260,
    overflow: 'hidden',
    width: '100%',
  },
  codePreview: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
    padding: 10,
  },
  codePreviewHeader: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  savedBadge: {
    ...TextPresets.eyebrow,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  emptyCodePreview: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  qrMosaic: {
    borderRadius: Radius.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: 118,
    padding: 8,
    width: 118,
  },
  qrCell: {
    height: 6,
    margin: 1,
    width: 6,
  },
  codeId: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  codeTimestamp: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  strictInfo: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  strictInfoIcon: {
    paddingTop: 2,
  },
  strictInfoCopy: {
    flex: 1,
    gap: 2,
  },
  smallBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  scannerMessage: {
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  bottomFooter: {
    gap: 8,
  },
  footerHelper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
  },
  footerHelperText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
});
