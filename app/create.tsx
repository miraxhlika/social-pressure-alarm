import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { usePreventRemove } from '@react-navigation/native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIconButton } from '@/components/ui/app-icon-button';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { StatusPill } from '@/components/ui/status-pill';
import {
  FlowFooterButton,
  FlowIconBadge,
  FlowListRow,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { SkeletonTextStack } from '@/components/ui/skeleton';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  ALARM_RUNTIME_CACHE_MAX_AGE_MS,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  saveNewAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { getDeviceTimezone } from '@/lib/alarm-schedule';
import { getExactAlarmAccessState } from '@/lib/exact-alarm-access';
import {
  CHECKPOINT_TEMPLATES,
  FIRST_CHECKPOINT_TEMPLATES,
  FIRST_RUN_GRACE_SECONDS,
  formatGracePeriodLabel,
  getCheckpointTemplate,
  getCheckpointTemplateDefaults,
} from '@/lib/checkpoint-templates';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  getNotificationPermissionState,
  NotificationPermissionState,
  openNotificationSettingsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { markOnboardingCompleted } from '@/lib/onboarding';
import {
  SOCIAL_CIRCLES_CACHE_MAX_AGE_MS,
  getCachedMySocialCircles,
  listMySocialCircles,
} from '@/lib/social/circles';
import { findCircleName, getSharedOutcomeLabel } from '@/lib/social/settings';
import { SocialCircleSummary } from '@/lib/social/types';
import { useAppDialog } from '@/providers/app-dialog-provider';
import { useSocialSession } from '@/providers/social-session-provider';
import {
  Alarm,
  AlarmSocialSettings,
  AlarmProofCodeType,
  CheckpointPreset,
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

type LinkMode = 'scanQr' | 'scanBarcode' | 'saved';
type ScannerPurpose = 'link' | 'test';
type ExpandedField = 'name' | 'category' | 'schedule' | 'window' | 'recurrence' | 'accountability' | 'place' | 'notes' | null;
type SocialMode = 'private' | 'circle';

type FormErrors = {
  label?: string;
  expectedQrPayload?: string;
  gracePeriodSeconds?: string;
};

type CreateStep = 0 | 1 | 2;

const REPEAT_OPTIONS: { value: RepeatSchedule; label: string; help: string }[] = [
  { value: 'once', label: 'One-time', help: 'Runs once' },
  { value: 'daily', label: 'Daily', help: 'Every day' },
  { value: 'weekdays', label: 'Weekdays', help: 'Mon to Fri' },
];

const GRACE_PRESET_OPTIONS = [
  { value: 120, label: '2 min', help: 'Nearby' },
  { value: 300, label: '5 min', help: 'Short walk' },
  { value: 600, label: '10 min', help: 'Balanced' },
  { value: 900, label: '15 min', help: 'Forgiving' },
] as const;

function getFirstRunUseCaseIcon(id: UseCaseType): keyof typeof Ionicons.glyphMap {
  switch (id) {
    case 'wake_up':
      return 'sunny-outline';
    case 'leave_home':
      return 'exit-outline';
    case 'study_start':
      return 'book-outline';
    case 'workout':
      return 'barbell-outline';
    default:
      return 'flag-outline';
  }
}

function createInitialTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

function createFirstRunTime(useCaseType: UseCaseType = 'custom') {
  const nextTime = new Date();

  switch (useCaseType) {
    case 'wake_up':
      nextTime.setHours(7, 0, 0, 0);
      break;
    case 'leave_home':
      nextTime.setHours(8, 0, 0, 0);
      break;
    case 'study_start':
    case 'deep_work':
      nextTime.setHours(9, 0, 0, 0);
      break;
    case 'workout':
      nextTime.setHours(18, 0, 0, 0);
      break;
    case 'medication':
      nextTime.setHours(9, 0, 0, 0);
      break;
    default:
      nextTime.setHours(nextTime.getHours() + 1, 0, 0, 0);
      break;
  }

  return nextTime;
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
      return 'Once';
  }
}

function getLinkModeLabel(linkMode: LinkMode) {
  switch (linkMode) {
    case 'scanBarcode':
      return 'Scanned barcode';
    case 'saved':
      return 'Saved code';
    default:
      return 'Scanned QR';
  }
}

function getProofCodeTypeFromLinkMode(linkMode: LinkMode): AlarmProofCodeType {
  return linkMode === 'scanBarcode' ? 'barcode' : 'qr';
}

function getLinkModeFromProofCodeType(proofCodeType?: AlarmProofCodeType): LinkMode {
  return proofCodeType === 'barcode' ? 'scanBarcode' : 'scanQr';
}

function getSocialSettingsMode(settings?: AlarmSocialSettings): SocialMode {
  return settings?.circleId && (settings.shareMisses || settings.shareSuccesses) ? 'circle' : 'private';
}

function buildAlarmSocialSettings({
  selectedCircleId,
  shareMisses,
  shareSuccesses,
  socialMode,
}: {
  selectedCircleId: string | null;
  shareMisses: boolean;
  shareSuccesses: boolean;
  socialMode: SocialMode;
}): AlarmSocialSettings | undefined {
  if (socialMode !== 'circle' || !selectedCircleId) {
    return undefined;
  }

  return {
    circleId: selectedCircleId,
    shareMisses,
    shareSuccesses,
  };
}

function buildSavedCodeId(payload: string) {
  let hash = 0;

  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }

  const hashPart = hash.toString(16).toUpperCase().padStart(8, '0');
  const lengthPart = payload.length.toString(16).toUpperCase().padStart(4, '0');

  return `CP-${hashPart.slice(0, 4)}-${hashPart.slice(4)}-${lengthPart}`;
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const { alert } = useAppDialog();
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
  const {
    configured: isSocialConfigured,
    isLoading: isSocialSessionLoading,
    isProfileComplete,
    user,
  } = useSocialSession();
  const [time, setTime] = useState(createInitialTime);
  const [label, setLabel] = useState('');
  const [useCaseType, setUseCaseType] = useState<UseCaseType>('custom');
  const [placeObject, setPlaceObject] = useState('');
  const [notes, setNotes] = useState('');
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
  const [activeStep, setActiveStep] = useState<CreateStep>(1);
  const [expandedField, setExpandedField] = useState<ExpandedField>(null);
  const [sourceAlarm, setSourceAlarm] = useState<Alarm | null>(null);
  const [savedCodePresets, setSavedCodePresets] = useState<CheckpointPreset[]>([]);
  const [selectedSavedCodePresetId, setSelectedSavedCodePresetId] = useState<string | null>(null);
  const [socialMode, setSocialMode] = useState<SocialMode>('private');
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [shareSuccesses, setShareSuccesses] = useState(false);
  const [shareMisses, setShareMisses] = useState(false);
  const [socialCircles, setSocialCircles] = useState<SocialCircleSummary[]>([]);
  const [isLoadingSocialCircles, setIsLoadingSocialCircles] = useState(false);
  const [socialCirclesError, setSocialCirclesError] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isFirstCheckpoint, setIsFirstCheckpoint] = useState(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [notificationPermissionState, setNotificationPermissionState] =
    useState<NotificationPermissionState>('undetermined');
  const scrollViewRef = useRef<ScrollView | null>(null);
  const nameInputRef = useRef<TextInput | null>(null);
  const scannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScannedPayloadRef = useRef<{ payload: string; purpose: ScannerPurpose; scannedAt: number } | null>(null);
  const saveInFlightRef = useRef(false);
  const newAlarmIdRef = useRef<string | null>(null);
  const [nameFocusRequest, setNameFocusRequest] = useState(0);
  const isEditMode = params.mode === 'edit' && typeof params.alarmId === 'string';
  const isReuseMode = params.mode === 'reuse' && typeof params.alarmId === 'string';
  const isOnboardingConversion = params.onboardingMode === 'convert_demo';
  const returnTo = useMemo(() => normalizeReturnToParam(params.returnTo), [params.returnTo]);
  const selectedTemplate = getCheckpointTemplate(useCaseType);
  const parsedGracePeriod = Number.parseInt(gracePeriodSeconds, 10);
  const gracePreviewSeconds = Number.isFinite(parsedGracePeriod) ? Math.max(parsedGracePeriod, 0) : 0;
  const hasLinkedProofCode = expectedQrPayload.trim().length > 0;
  const canSaveLinkedProof = hasLinkedProofCode;
  const shouldSaveFromDetailsStep = activeStep === 1 && canSaveLinkedProof;
  let footerButtonLabel = 'Link proof code';
  let footerHelperCopy = '';

  if (activeStep === 0) {
    footerButtonLabel = 'Choose a starting point';
    footerHelperCopy = 'Pick the commitment you want to prove with a real place or object.';
  } else if (activeStep === 2) {
    if (!hasLinkedProofCode) {
      footerButtonLabel = 'Link a Code';
      footerHelperCopy = 'Scan a QR code or barcode at the real place or object.';
    } else {
      footerButtonLabel = isSaving
        ? isOnboardingConversion
          ? 'Starting practice...'
          : 'Saving...'
        : isEditMode
          ? 'Save Changes'
          : isOnboardingConversion
            ? 'Start practice clear'
            : 'Save Checkpoint';
      footerHelperCopy = isOnboardingConversion
        ? 'You will clear this checkpoint once now, then keep the daily schedule.'
        : 'Code linked. Save when you are ready.';
    }
  } else if (shouldSaveFromDetailsStep) {
    footerButtonLabel = isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Checkpoint';
    footerHelperCopy =
      notificationPermissionState === 'denied'
        ? 'Notifications are blocked in Settings. Re-enable them before saving.'
        : notificationPermissionState === 'undetermined'
          ? 'We ask for notifications when you save, so the reminder can go live.'
          : 'Reminders open the app so you can scan. Keep notifications on.';
  } else if (activeStep === 1) {
    footerHelperCopy =
      notificationPermissionState === 'undetermined'
        ? 'Next you will scan a code. Notifications are asked when you save.'
        : '';
  }
  const formattedTime = useMemo(
    () =>
      time.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time]
  );

  const refreshNotificationPermission = useCallback(async () => {
    const nextPermissionState = await getNotificationPermissionState().catch(
      () => 'undetermined' as NotificationPermissionState
    );
    setNotificationPermissionState(nextPermissionState);
    return nextPermissionState;
  }, []);

  const refreshCameraPermission = useCallback(async () => {
    await getPermission().catch(() => null);
  }, [getPermission]);

  useEffect(() => {
    void refreshNotificationPermission();
    void refreshCameraPermission();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshNotificationPermission();
        void refreshCameraPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshCameraPermission, refreshNotificationPermission]);
  const shouldShowCameraFallback = Boolean(
    scannerMessage &&
      !isScannerVisible &&
      !permission?.granted &&
      (scannerPurpose === 'test' || linkMode === 'scanQr' || linkMode === 'scanBarcode')
  );
  const cameraFallbackTitle = permission?.canAskAgain === false ? 'Camera is blocked' : 'Camera is not ready';
  const cameraFallbackActionLabel = permission?.canAskAgain === false ? 'Open settings' : 'Allow camera';

  const applySocialSettingsToForm = useCallback((settings?: AlarmSocialSettings) => {
    const mode = getSocialSettingsMode(settings);

    setSocialMode(mode);
    setSelectedCircleId(mode === 'circle' ? settings?.circleId ?? null : null);
    setShareSuccesses(mode === 'circle' ? Boolean(settings?.shareSuccesses) : false);
    setShareMisses(mode === 'circle' ? Boolean(settings?.shareMisses) : true);
  }, []);

  const handleTimeChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) {
      return;
    }

    setTime(selectedDate);
  };

  useEffect(() => {
    let isMounted = true;

    const loadSocialCircles = async () => {
      if (!isSocialConfigured || !user?.id || !isProfileComplete) {
        setSocialCircles([]);
        setIsLoadingSocialCircles(false);
        setSocialCirclesError('');
        return;
      }

      const cachedCircles = getCachedMySocialCircles(user.id);

      if (cachedCircles) {
        setSocialCircles(cachedCircles);
        setIsLoadingSocialCircles(false);
      } else {
        setIsLoadingSocialCircles(true);
      }

      setSocialCirclesError('');

      try {
        const nextCircles = await listMySocialCircles({ maxAgeMs: SOCIAL_CIRCLES_CACHE_MAX_AGE_MS });

        if (isMounted) {
          setSocialCircles(nextCircles);
        }
      } catch (error) {
        if (isMounted) {
          setSocialCirclesError(error instanceof Error ? error.message : 'Circles could not be loaded.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingSocialCircles(false);
        }
      }
    };

    void loadSocialCircles();

    return () => {
      isMounted = false;
    };
  }, [isProfileComplete, isSocialConfigured, user?.id]);

  useEffect(() => {
    if (socialMode === 'circle' && !selectedCircleId && socialCircles.length > 0) {
      setSelectedCircleId(socialCircles[0].id);
    }
  }, [selectedCircleId, socialCircles, socialMode]);

  useEffect(() => {
    const loadFormData = async () => {
      const store = await hydrateAlarmRuntimeForCurrentUser({
        maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS,
      }).catch(() => readAlarmStore());
      setSavedCodePresets(store.checkpointPresets);
      setIsFirstCheckpoint(store.lifetimeAlarmCreations === 0 && store.successHistory.length === 0);
      setErrors({});

      if (!params.alarmId || (!isEditMode && !isReuseMode)) {
        const prefilledTemplate = getCheckpointTemplateDefaults(params.prefillUseCaseType);
        const prefilledGracePeriod = Number.parseInt(params.prefillGracePeriodSeconds ?? '', 10);
        const shouldGuideFirstRun = isOnboardingConversion || store.lifetimeAlarmCreations === 0;
        const hasPrefillUseCase =
          typeof params.prefillUseCaseType === 'string' && params.prefillUseCaseType.length > 0;

        setSourceAlarm(null);
        setUseCaseType(prefilledTemplate.useCaseType);
        setLabel(typeof params.prefillLabel === 'string' ? params.prefillLabel : prefilledTemplate.label);
        setPlaceObject(prefilledTemplate.label);
        setNotes('');
        setExpectedQrPayload('');
        setLinkMode('scanQr');
        setProofCodeCapturedAt(null);
        setProofCodeVerifiedAt(null);
        setSelectedSavedCodePresetId(null);
        applySocialSettingsToForm(undefined);
        setRepeatSchedule(normalizeRepeatScheduleParam(params.prefillRepeatSchedule, prefilledTemplate.repeatSchedule));
        setGracePeriodSeconds(
          Number.isFinite(prefilledGracePeriod) && prefilledGracePeriod >= 15
            ? String(prefilledGracePeriod)
            : String(shouldGuideFirstRun ? FIRST_RUN_GRACE_SECONDS : prefilledTemplate.gracePeriodSeconds)
        );
        setTime(shouldGuideFirstRun ? createFirstRunTime(prefilledTemplate.useCaseType) : createInitialTime());
        setActiveStep(shouldGuideFirstRun && !hasPrefillUseCase ? 0 : 1);
        setExpandedField(shouldGuideFirstRun ? 'schedule' : null);
        return;
      }

      const alarm = store.alarms.find((candidate) => candidate.id === params.alarmId) ?? null;
      setActiveStep(1);

      if (!alarm) {
        setSourceAlarm(null);
        setUseCaseType('custom');
        setLabel('');
        setPlaceObject('');
        setNotes('');
        setExpectedQrPayload('');
        setLinkMode('scanQr');
        setProofCodeCapturedAt(null);
        setProofCodeVerifiedAt(null);
        setSelectedSavedCodePresetId(null);
        applySocialSettingsToForm(undefined);
        return;
      }

      const nextTime = createInitialTime();
      const activeScheduledDate = alarm.isActive && alarm.scheduledFor ? new Date(alarm.scheduledFor) : null;

      if (activeScheduledDate && !Number.isNaN(activeScheduledDate.getTime())) {
        nextTime.setHours(activeScheduledDate.getHours(), activeScheduledDate.getMinutes(), 0, 0);
      } else {
        nextTime.setHours(alarm.hour, alarm.minute, 0, 0);
      }

      setSourceAlarm(alarm);
      setTime(nextTime);
      setLabel(alarm.label);
      setUseCaseType(alarm.useCaseType);
      setPlaceObject(alarm.placeObject ?? '');
      setNotes(alarm.notes ?? '');
      setExpectedQrPayload(alarm.expectedQrPayload);
      setLinkMode(getLinkModeFromProofCodeType(alarm.proofCodeType));
      setProofCodeCapturedAt(alarm.createdAt);
      setProofCodeVerifiedAt(null);
      setSelectedSavedCodePresetId(null);
      applySocialSettingsToForm(alarm.socialSettings);
      setRepeatSchedule(alarm.repeatSchedule);
      setGracePeriodSeconds(String(alarm.gracePeriodSeconds));
    };

    void loadFormData();
  }, [
    isEditMode,
    isOnboardingConversion,
    isReuseMode,
    applySocialSettingsToForm,
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

  useEffect(() => {
    if (nameFocusRequest === 0 || activeStep !== 1 || expandedField !== 'name') {
      return;
    }

    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [activeStep, expandedField, nameFocusRequest]);

  const toggleField = (field: NonNullable<ExpandedField>) => {
    setExpandedField((currentField) => (currentField === field ? null : field));
  };

  const focusNameField = useCallback(() => {
    setActiveStep(1);
    setExpandedField('name');
    setNameFocusRequest((currentRequest) => currentRequest + 1);
  }, []);

  const handleSelectFirstUseCase = useCallback(async (nextUseCaseType: UseCaseType) => {
    const defaults = getCheckpointTemplateDefaults(nextUseCaseType);
    setUseCaseType(defaults.useCaseType);
    setLabel(defaults.label);
    setPlaceObject(defaults.label);
    setRepeatSchedule(defaults.repeatSchedule === 'once' ? 'daily' : defaults.repeatSchedule);
    setGracePeriodSeconds(String(FIRST_RUN_GRACE_SECONDS));
    setTime(createFirstRunTime(defaults.useCaseType));
    setErrors({});
    setActiveStep(1);
    setExpandedField('schedule');
    await trackAnalyticsEvent('use_case_selected', {
      source: 'onboarding',
      useCaseType: defaults.useCaseType,
    });
  }, []);

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

  const handleReturnFromDetailsStep = useCallback(() => {
    if (isOnboardingConversion || isFirstCheckpoint) {
      setActiveStep(0);
      setExpandedField(null);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(returnTo);
  }, [isFirstCheckpoint, isOnboardingConversion, returnTo, router]);

  // Only intercept an actual attempt to leave an unfinished link-code step.
  // Once saving starts, the success redirect must be allowed to remove this screen.
  usePreventRemove(activeStep === 2 && !isSaving, handleReturnToDetailsStep);

  const handleOpenScanner = useCallback(async (mode: Extract<LinkMode, 'scanQr' | 'scanBarcode'>) => {
    setLinkMode(mode);
    setScannerPurpose('link');
    setSelectedSavedCodePresetId(null);
    lastScannedPayloadRef.current = null;
    setScannerMessage('');

    if (!permission?.granted) {
      if (permission?.canAskAgain === false) {
        setScannerMessage('Camera access is blocked. Open Settings to scan proof codes for this checkpoint.');
        return;
      }

      const response = await requestPermission();

      if (!response.granted) {
        setScannerMessage('Camera access is required to scan proof codes for this checkpoint.');
        return;
      }
    }

    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [permission?.canAskAgain, permission?.granted, requestPermission]);

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
    setSelectedSavedCodePresetId(null);
    setErrors((currentErrors) => ({
      ...currentErrors,
      expectedQrPayload: undefined,
    }));
    void handleOpenScanner('scanQr');
  }, [handleOpenScanner]);

  const handleContinueToLinkCode = useCallback(() => {
    if (!validateDetailsStep()) {
      if (!label.trim()) {
        focusNameField();
      }
      return;
    }

    // Link code is a camera action. Notifications are requested at save, when the
    // reminder actually goes live — never stack two OS prompts on one tap.
    handleOpenLinkCodeStep();
  }, [focusNameField, handleOpenLinkCodeStep, label, validateDetailsStep]);

  const handleOpenSavedCodes = useCallback(() => {
    setLinkMode('saved');
    setIsScannerVisible(false);
    setScannerPurpose('link');
    lastScannedPayloadRef.current = null;
    setScannerMessage(savedCodePresets.length > 0 ? 'Choose one saved code below.' : 'No saved codes are available yet.');
  }, [savedCodePresets.length]);

  const handleUseSavedProofCode = useCallback((preset: CheckpointPreset) => {
    setLinkMode('saved');
    setExpectedQrPayload(preset.expectedQrPayload);
    setProofCodeCapturedAt(preset.createdAt);
    setProofCodeVerifiedAt(null);
    setSelectedSavedCodePresetId(preset.id);
    setIsScannerVisible(false);
    setScannerPurpose('link');
    lastScannedPayloadRef.current = null;
    setScannerMessage(`Using saved code from ${preset.label}.`);
    setErrors((currentErrors) => ({
      ...currentErrors,
      expectedQrPayload: undefined,
    }));
  }, []);

  const handleOpenTestScanner = useCallback(async () => {
    if (!expectedQrPayload.trim()) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        expectedQrPayload: 'Scan or choose a saved proof code before testing it.',
      }));
      return;
    }

    setScannerPurpose('test');
    lastScannedPayloadRef.current = null;
    setScannerMessage('Scan the saved QR code or barcode once to verify it matches this checkpoint.');

    if (!permission?.granted) {
      if (permission?.canAskAgain === false) {
        setScannerMessage('Camera access is blocked. Open Settings to test this proof code.');
        return;
      }

      const response = await requestPermission();

      if (!response.granted) {
        setScannerMessage('Camera access is required to scan and test this proof code.');
        return;
      }
    }

    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [expectedQrPayload, permission?.canAskAgain, permission?.granted, requestPermission]);

  const handleCameraFallbackAction = useCallback(async () => {
    if (permission?.canAskAgain === false) {
      await Linking.openSettings().catch(() => null);
      return;
    }

    const response = await requestPermission();

    if (!response.granted) {
      setScannerMessage('Camera is still unavailable. Allow camera access to scan a QR code or barcode.');
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
      setSelectedSavedCodePresetId(null);
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

  const handleSocialModeChange = useCallback(
    (nextMode: SocialMode) => {
      setSocialMode(nextMode);

      if (nextMode === 'private') {
        setSelectedCircleId(null);
        setShareSuccesses(false);
        setShareMisses(false);
        return;
      }

      setSelectedCircleId((currentCircleId) => currentCircleId ?? socialCircles[0]?.id ?? null);
    },
    [socialCircles]
  );

  const handleShareMissesToggle = useCallback(() => {
    setShareMisses((currentValue) => !currentValue);
  }, []);

  const handleShareSuccessesToggle = useCallback(() => {
    setShareSuccesses((currentValue) => !currentValue);
  }, []);

  const handleSave = useCallback(async () => {
    // State updates do not disable the button until React renders again. Guard the
    // mutation synchronously so rapid presses cannot create two checkpoints.
    if (saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;

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
      nextErrors.expectedQrPayload = 'Scan or choose the exact code this checkpoint should accept.';
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      nextErrors.gracePeriodSeconds = 'Use 15 seconds or more.';
    }

    if (Object.keys(nextErrors).length > 0) {
      saveInFlightRef.current = false;
      setErrors(nextErrors);
      if (nextErrors.label || nextErrors.gracePeriodSeconds) {
        setActiveStep(1);
      } else if (nextErrors.expectedQrPayload) {
        setActiveStep(2);
      }
      if (nextErrors.label) {
        focusNameField();
      }
      return;
    }

    setErrors({});
    setIsSaving(true);

    let scheduledNotificationIds: string[] | undefined;
    let didNavigateAway = false;

    try {
      const store = await readAlarmStore();
      const hasNotificationPermission = await ensureNotificationPermissionsAsync();
      const nextNotificationPermissionState = await getNotificationPermissionState().catch(
        () => (hasNotificationPermission ? 'granted' : 'denied') as NotificationPermissionState
      );

      if (!hasNotificationPermission) {
        setNotificationPermissionState(nextNotificationPermissionState);
        alertNotificationPermission(() => {
          void openNotificationSettingsAsync().catch(() => null);
        });
        return;
      }

      // Avoid a permission-state re-render while leaving for practice — that flash
      // is what makes the create form reappear after the OS dialog.
      if (!isOnboardingConversion) {
        setNotificationPermissionState(nextNotificationPermissionState);
      }

      if (!newAlarmIdRef.current) {
        newAlarmIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      // Keep one stable identity for this screen's creation attempt. If a later
      // navigation regression retries the save, persistence can update the same
      // checkpoint instead of inserting another one.
      const alarmId = isEditMode && sourceAlarm ? sourceAlarm.id : newAlarmIdRef.current;
      const nextSocialSettings = buildAlarmSocialSettings({
        selectedCircleId,
        shareMisses,
        shareSuccesses,
        socialMode,
      });
      const baseAlarm: Alarm = {
        id: alarmId,
        hour: time.getHours(),
        minute: time.getMinutes(),
        label: trimmedLabel,
        useCaseType,
        placeObject: trimmedPlaceObject || trimmedLabel,
        notes: trimmedNotes || undefined,
        expectedQrPayload: trimmedExpectedQrPayload,
        proofCodeType: getProofCodeTypeFromLinkMode(linkMode),
        repeatSchedule,
        timezone: getDeviceTimezone(),
        scheduleRevision: isEditMode && sourceAlarm ? sourceAlarm.scheduleRevision + 1 : 1,
        gracePeriodSeconds: gracePeriod,
        isActive: true,
        createdAt: isEditMode && sourceAlarm ? sourceAlarm.createdAt : new Date().toISOString(),
        socialSettings: nextSocialSettings,
        lastOutcome: undefined,
      };

      // A practice clear is already happening in the foreground, so it does not
      // need (and must not create) a local notification with a past trigger.
      // Its immediate scheduledFor makes the alarm live; a successful clear
      // schedules the first real recurring notification in RingingScreen.
      const scheduled = isOnboardingConversion
        ? {
            notificationIds: [] as string[],
            notificationRegistrations: [],
            scheduledFor: new Date().toISOString(),
            strategyKey: undefined,
            omittedKinds: [],
          }
        : await scheduleAlarmNotificationAsync(baseAlarm);
      scheduledNotificationIds = scheduled.notificationIds;

      if (isEditMode && sourceAlarm?.notificationIds) {
        await cancelAlarmNotificationAsync(sourceAlarm.notificationIds);
      }

      const nextAlarm: Alarm = {
        ...baseAlarm,
        isPracticeRun: isOnboardingConversion,
        notificationIds: scheduled.notificationIds,
        notificationRegistrations: scheduled.notificationRegistrations,
        scheduledFor: scheduled.scheduledFor,
        notificationStrategyKey: scheduled.strategyKey,
      };

      if (isEditMode && sourceAlarm) {
        await updateAlarm(nextAlarm);
      } else {
        await saveNewAlarm(nextAlarm);
        if (isOnboardingConversion) {
          await trackAnalyticsEvent('demo_checkpoint_created', {
            useCaseType,
          });
        }
        await trackAnalyticsEvent('recurring_checkpoint_saved', {
          checkpointId: nextAlarm.id,
          useCaseType,
          repeatSchedule,
          gracePeriodSeconds: gracePeriod,
          creationCountBeforeSave: store.lifetimeAlarmCreations,
          source: isReuseMode ? 'reuse' : 'new',
          socialMode: nextSocialSettings ? 'circle' : 'private',
        });
      }

      if (isOnboardingConversion && !isEditMode) {
        await markOnboardingCompleted();
        didNavigateAway = true;
        router.replace({
          pathname: '/ringing',
          params: {
            alarmId: nextAlarm.id,
          },
        });
        return;
      }

      const exactAlarmAccess = await getExactAlarmAccessState();
      if (scheduled.omittedKinds.length > 0 || exactAlarmAccess === 'inexact') {
        const omittedCopy = scheduled.omittedKinds.length > 0
          ? ` Optional ${scheduled.omittedKinds.join(' and ')} reminders were omitted because the device notification limit was reached.`
          : '';
        const timingCopy = exactAlarmAccess === 'inexact'
          ? ' Android exact alarm access is off, so the reminder may be delayed. You can enable it from Account → Notifications.'
          : '';
        await alert({
          title: 'Checkpoint saved with a warning',
          description: `${timingCopy}${omittedCopy}`.trim(),
          icon: 'notifications-outline',
          tone: 'warning',
        });
      }

      didNavigateAway = true;
      router.replace(returnTo);
    } catch (error) {
      if (scheduledNotificationIds) {
        await cancelAlarmNotificationAsync(scheduledNotificationIds);
      }

      const errorMessage = error instanceof Error ? error.message : 'The checkpoint could not be saved right now.';

      await alert({
        description: errorMessage,
        icon: 'cloud-offline-outline',
        title: 'Checkpoint not saved',
        tone: 'warning',
      });
    } finally {
      saveInFlightRef.current = false;
      if (!didNavigateAway) {
        setIsSaving(false);
      }
    }
  }, [
    alert,
    expectedQrPayload,
    focusNameField,
    gracePeriodSeconds,
    isEditMode,
    isOnboardingConversion,
    isReuseMode,
    label,
    linkMode,
    notes,
    placeObject,
    repeatSchedule,
    returnTo,
    router,
    selectedCircleId,
    shareMisses,
    shareSuccesses,
    socialMode,
    sourceAlarm,
    time,
    useCaseType,
  ]);

  return (
    <View style={styles.createRoot}>
      <AppScreen
        backgroundColor={colors.elevated}
        contentStyle={styles.screenContent}
        footer={
          activeStep === 0 ? null : (
            <View style={styles.bottomFooter}>
              <FlowFooterButton
                disabled={isSaving}
                icon={canSaveLinkedProof ? 'checkmark' : activeStep === 2 ? 'scan' : 'qr-code-outline'}
                label={footerButtonLabel}
                onPress={
                  activeStep === 2
                    ? !hasLinkedProofCode
                      ? () => void handleOpenScanner(linkMode === 'scanBarcode' ? 'scanBarcode' : 'scanQr')
                      : handleSave
                    : shouldSaveFromDetailsStep
                      ? handleSave
                      : handleContinueToLinkCode
                }
              />
              {footerHelperCopy ? (
                <View style={styles.footerHelper}>
                  <Ionicons color={colors.muted} name="lock-closed-outline" size={12} />
                  <Text style={[styles.footerHelperText, { color: colors.textSoft }]}>{footerHelperCopy}</Text>
                </View>
              ) : null}
            </View>
          )
        }
        keyboardAware
        scrollRef={scrollViewRef}>
      <FlowTopBar
        leftAccessibilityLabel={
          activeStep === 0
            ? 'Close first checkpoint setup'
            : activeStep === 1
              ? isOnboardingConversion || isFirstCheckpoint
                ? 'Back to starting point'
                : 'Close create checkpoint'
              : 'Back to create checkpoint'
        }
        leftIcon={activeStep === 0 || (activeStep === 1 && !(isOnboardingConversion || isFirstCheckpoint)) ? 'close' : 'chevron-back'}
        onLeftPress={
          activeStep === 0 ? handleCancel : activeStep === 1 ? handleReturnFromDetailsStep : handleReturnToDetailsStep
        }
        subtitle={
          activeStep === 0
            ? 'One commitment. One real place.'
            : activeStep === 1
              ? isOnboardingConversion
                ? 'Then link a code and clear it once.'
                : 'Set it up in a minute.'
              : isOnboardingConversion
                ? 'Link a code, then clear it once.'
                : 'Choose the code that proves completion.'
        }
        title={
          activeStep === 0
            ? 'Start with one'
            : activeStep === 1
              ? isEditMode
                ? 'Edit checkpoint'
                : isOnboardingConversion
                  ? 'First checkpoint'
                  : 'New checkpoint'
              : 'Proof code'
        }
      />

      {activeStep === 0 ? (
        <FirstUseCaseStep colors={colors} onSelect={(nextUseCaseType) => void handleSelectFirstUseCase(nextUseCaseType)} />
      ) : activeStep === 1 ? (
        <CreateDetailsStep
          colors={colors}
          errors={errors}
          expandedField={expandedField}
          formattedTime={formattedTime}
          gracePeriodSeconds={gracePeriodSeconds}
          gracePreviewSeconds={gracePreviewSeconds}
          guidedFirstRun={isOnboardingConversion || isFirstCheckpoint}
          label={label}
          nameInputRef={nameInputRef}
          proofCodeVerifiedAt={proofCodeVerifiedAt}
          hasLinkedProofCode={hasLinkedProofCode}
          notes={notes}
          onExpectedCodePress={handleContinueToLinkCode}
          onFieldToggle={toggleField}
          onGracePeriodChange={(nextValue) => {
            setGracePeriodSeconds(nextValue);
            setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
          }}
          onOpenAccount={() => router.push('/account')}
          onOpenCircles={() => router.push('/circles')}
          onLabelChange={(nextValue) => {
            setLabel(nextValue);
            setErrors((currentErrors) => ({ ...currentErrors, label: undefined }));
          }}
          onNotesChange={setNotes}
          onPlaceObjectChange={setPlaceObject}
          onRepeatScheduleChange={setRepeatSchedule}
          onSelectedCircleChange={setSelectedCircleId}
          onShareMissesToggle={handleShareMissesToggle}
          onShareSuccessesToggle={handleShareSuccessesToggle}
          onSocialModeChange={handleSocialModeChange}
          onTemplateSelect={(nextUseCaseType) => {
            const defaults = getCheckpointTemplateDefaults(nextUseCaseType);
            setUseCaseType(defaults.useCaseType);
            setRepeatSchedule(defaults.repeatSchedule === 'once' ? 'daily' : defaults.repeatSchedule);
            setGracePeriodSeconds(
              String(isOnboardingConversion || isFirstCheckpoint ? FIRST_RUN_GRACE_SECONDS : defaults.gracePeriodSeconds)
            );
            if (!label.trim() || label === selectedTemplate.defaultLabel) {
              setLabel(defaults.label);
            }
            if (!placeObject.trim() || placeObject === selectedTemplate.defaultLabel) {
              setPlaceObject(defaults.label);
            }
            setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
          }}
          onTimeChange={handleTimeChange}
          placeObject={placeObject}
          repeatSchedule={repeatSchedule}
          selectedTemplate={selectedTemplate}
          selectedCircleId={selectedCircleId}
          shareMisses={shareMisses}
          shareSuccesses={shareSuccesses}
          socialCircles={socialCircles}
          socialCirclesError={socialCirclesError}
          socialMode={socialMode}
          socialSessionState={{
            configured: isSocialConfigured,
            isLoading: isSocialSessionLoading || isLoadingSocialCircles,
            isProfileComplete,
            signedIn: Boolean(user?.id),
          }}
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
          savedCodePresets={savedCodePresets}
          selectedSavedCodePresetId={selectedSavedCodePresetId}
          onBarcodeScanned={handleBarcodeScanned}
          onCameraFallbackAction={handleCameraFallbackAction}
          onClearCode={handleClearProofCode}
          onHideScanner={() => setIsScannerVisible(false)}
          onOpenSavedCodes={handleOpenSavedCodes}
          onOpenScanner={handleOpenScanner}
          onOpenTestScanner={handleOpenTestScanner}
          onUseSavedCode={handleUseSavedProofCode}
          permissionGranted={Boolean(permission?.granted)}
          proofCodeCapturedAt={proofCodeCapturedAt}
          proofCodeVerifiedAt={proofCodeVerifiedAt}
          scannerMessage={scannerMessage}
          scannerPurpose={scannerPurpose}
          shouldShowCameraFallback={shouldShowCameraFallback}
        />
      )}
      </AppScreen>
      {isSaving && isOnboardingConversion ? (
        <View
          accessibilityLabel="Starting practice"
          accessibilityRole="progressbar"
          pointerEvents="auto"
          style={[styles.practiceTransitionOverlay, { backgroundColor: colors.elevated }]}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.practiceTransitionTitle, { color: colors.text }]}>Starting practice</Text>
          <Text style={[styles.practiceTransitionCopy, { color: colors.textSoft }]}>
            Opening your live checkpoint…
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function FirstUseCaseStep({
  colors,
  onSelect,
}: {
  colors: ReturnType<typeof getAppColors>;
  onSelect: (value: UseCaseType) => void;
}) {
  return (
    <View style={styles.firstUseCaseLayout}>
      <Text style={[styles.firstUseCaseIntro, { color: colors.textSoft }]}>
        Choose one routine. You will link a code at a real place, then clear it once so the loop clicks.
      </Text>
      <View style={styles.firstUseCaseList}>
        {FIRST_CHECKPOINT_TEMPLATES.map((template) => (
          <Pressable
            accessibilityLabel={`${template.title}. ${template.description}`}
            accessibilityRole="button"
            key={template.id}
            onPress={() => onSelect(template.id)}
            style={({ pressed }) => [
              styles.firstUseCaseCard,
              { backgroundColor: colors.panelMuted, borderColor: colors.line },
              pressed && styles.pressed,
            ]}>
            <View style={[styles.firstUseCaseIcon, { backgroundColor: colors.primarySurface }]}>
              <Ionicons color={colors.primary} name={getFirstRunUseCaseIcon(template.id)} size={22} />
            </View>
            <View style={styles.firstUseCaseCopy}>
              <Text style={[styles.firstUseCaseTitle, { color: colors.text }]}>{template.title}</Text>
              <Text style={[styles.firstUseCaseDescription, { color: colors.textSoft }]}>{template.description}</Text>
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={18} />
          </Pressable>
        ))}
      </View>
      <View style={[styles.firstUseCaseNote, { backgroundColor: colors.panel, borderColor: colors.line }]}>
        <Ionicons color={colors.primary} name="notifications-outline" size={16} />
        <Text style={[styles.firstUseCaseNoteText, { color: colors.textSoft }]}>
          Reminders open the app so you can scan. Keep notifications on for the best result.
        </Text>
      </View>
    </View>
  );
}

function CreateDetailsStep({
  colors,
  errors,
  expandedField,
  formattedTime,
  gracePeriodSeconds,
  gracePreviewSeconds,
  guidedFirstRun = false,
  hasLinkedProofCode,
  label,
  nameInputRef,
  notes,
  onExpectedCodePress,
  onFieldToggle,
  onGracePeriodChange,
  onOpenAccount,
  onOpenCircles,
  onLabelChange,
  onNotesChange,
  onPlaceObjectChange,
  onRepeatScheduleChange,
  onSelectedCircleChange,
  onShareMissesToggle,
  onShareSuccessesToggle,
  onSocialModeChange,
  onTemplateSelect,
  onTimeChange,
  placeObject,
  proofCodeVerifiedAt,
  repeatSchedule,
  selectedCircleId,
  selectedTemplate,
  shareMisses,
  shareSuccesses,
  socialCircles,
  socialCirclesError,
  socialMode,
  socialSessionState,
  time,
}: {
  colors: ReturnType<typeof getAppColors>;
  errors: FormErrors;
  expandedField: ExpandedField;
  formattedTime: string;
  gracePeriodSeconds: string;
  gracePreviewSeconds: number;
  guidedFirstRun?: boolean;
  hasLinkedProofCode: boolean;
  label: string;
  nameInputRef: RefObject<TextInput | null>;
  notes: string;
  onExpectedCodePress: () => void;
  onFieldToggle: (field: NonNullable<ExpandedField>) => void;
  onGracePeriodChange: (value: string) => void;
  onOpenAccount: () => void;
  onOpenCircles: () => void;
  onLabelChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onPlaceObjectChange: (value: string) => void;
  onRepeatScheduleChange: (value: RepeatSchedule) => void;
  onSelectedCircleChange: (value: string) => void;
  onShareMissesToggle: () => void;
  onShareSuccessesToggle: () => void;
  onSocialModeChange: (value: SocialMode) => void;
  onTemplateSelect: (value: UseCaseType) => void;
  onTimeChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  placeObject: string;
  proofCodeVerifiedAt: string | null;
  repeatSchedule: RepeatSchedule;
  selectedCircleId: string | null;
  selectedTemplate: ReturnType<typeof getCheckpointTemplate>;
  shareMisses: boolean;
  shareSuccesses: boolean;
  socialCircles: SocialCircleSummary[];
  socialCirclesError: string;
  socialMode: SocialMode;
  socialSessionState: {
    configured: boolean;
    isLoading: boolean;
    isProfileComplete: boolean;
    signedIn: boolean;
  };
  time: Date;
}) {
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const selectedCircleName = findCircleName(socialCircles, selectedCircleId ?? undefined);
  const accountabilityValue =
    socialMode === 'circle' && selectedCircleId
      ? selectedCircleName ?? 'Shared circle'
      : 'Private';
  const accountabilityDescription =
    socialMode === 'circle' && selectedCircleId
      ? getSharedOutcomeLabel({ circleId: selectedCircleId, shareMisses, shareSuccesses })
      : 'Not shared';

  return (
    <View style={styles.detailsLayout}>
      {guidedFirstRun ? (
        <View style={[styles.guidedBanner, { backgroundColor: colors.primarySurface, borderColor: colors.ring }]}>
          <Ionicons color={colors.primary} name="flash-outline" size={18} />
          <Text style={[styles.guidedBannerText, { color: colors.text }]}>
            Practice clear starts as soon as you save. Your regular {getRepeatLabel(repeatSchedule).toLowerCase()} time stays for later.
          </Text>
        </View>
      ) : null}

      <View style={styles.nameSection}>
        <Text style={[styles.fieldLabel, { color: colors.textSoft }]}>WHAT DO YOU NEED TO DO?</Text>
        <AppInput
          autoCapitalize="words"
          error={errors.label}
          label="Checkpoint name"
          onChangeText={onLabelChange}
          placeholder={selectedTemplate.defaultLabel || 'Morning routine'}
          ref={nameInputRef}
          value={label}
        />
      </View>

      <FlowPanel style={styles.corePanel}>
        <CreateFieldRow
          description={`${getRepeatLabel(repeatSchedule)} · reach window ${formatGracePeriodLabel(gracePreviewSeconds || 0)}`}
          expanded={expandedField === 'schedule'}
          icon="alarm-outline"
          onPress={() => onFieldToggle('schedule')}
          title="When"
          value={formattedTime}>
          <View style={[styles.pickerPanel, { backgroundColor: colors.panelMuted }]}>
            <Text style={[TextPresets.label, { color: colors.text }]}>
              {guidedFirstRun ? 'Usual time after practice' : 'Time'}
            </Text>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              mode="time"
              onChange={onTimeChange}
              value={time}
            />
          </View>
          <Text style={[styles.editorLabel, { color: colors.textSoft }]}>REPEATS</Text>
          <View style={styles.optionGrid}>
            {REPEAT_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                onPress={() => onRepeatScheduleChange(option.value)}
                selected={repeatSchedule === option.value}
                title={option.label}
              />
            ))}
          </View>
        </CreateFieldRow>

        <CreateFieldRow
          description="How long you have to reach the code after the reminder"
          expanded={expandedField === 'window'}
          icon="timer-outline"
          onPress={() => onFieldToggle('window')}
          title="Reach window"
          value={formatGracePeriodLabel(gracePreviewSeconds || 0)}>
          <View style={styles.optionGrid}>
            {GRACE_PRESET_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                onPress={() => onGracePeriodChange(String(option.value))}
                selected={Number.parseInt(gracePeriodSeconds, 10) === option.value}
                title={option.label}
              />
            ))}
          </View>
          <AppInput
            error={errors.gracePeriodSeconds}
            helper="Minimum 15 seconds"
            keyboardType="number-pad"
            label="Custom seconds"
            onChangeText={onGracePeriodChange}
            placeholder="600"
            value={gracePeriodSeconds}
          />
        </CreateFieldRow>

        <CreateFieldRow
          description={
            hasLinkedProofCode
              ? proofCodeVerifiedAt
                ? 'Tested and ready'
                : 'Ready to use'
              : 'Scan a QR code or barcode'
          }
          expanded={false}
          icon={hasLinkedProofCode ? (proofCodeVerifiedAt ? 'checkmark-circle-outline' : 'qr-code-outline') : 'qr-code-outline'}
          onPress={onExpectedCodePress}
          title="Proof code"
          value={hasLinkedProofCode ? (proofCodeVerifiedAt ? 'Tested' : 'Linked') : 'Add'}
        />
      </FlowPanel>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showMoreOptions }}
        onPress={() => setShowMoreOptions((currentValue) => !currentValue)}
        style={({ pressed }) => [
          styles.moreOptionsButton,
          { backgroundColor: colors.panelMuted },
          pressed && styles.pressed,
        ]}>
        <View style={styles.moreOptionsIcon}>
          <Ionicons color={colors.textSoft} name="options-outline" size={18} />
        </View>
        <View style={styles.moreOptionsCopy}>
          <Text style={[styles.moreOptionsTitle, { color: colors.text }]}>More options</Text>
          <Text style={[styles.moreOptionsDescription, { color: colors.textSoft }]}>
            {guidedFirstRun ? 'Category, location, and notes' : 'Category, sharing, location, and notes'}
          </Text>
        </View>
        <Ionicons color={colors.muted} name={showMoreOptions ? 'chevron-up' : 'chevron-down'} size={18} />
      </Pressable>

      {showMoreOptions ? (
        <FlowPanel style={styles.optionalPanel}>
          <CreateFieldRow
            description="Helps personalize defaults"
            expanded={expandedField === 'category'}
            icon="shapes-outline"
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

          {!guidedFirstRun ? (
            <CreateFieldRow
              description={accountabilityDescription}
              expanded={expandedField === 'accountability'}
              icon="people-outline"
              onPress={() => onFieldToggle('accountability')}
              title="Accountability"
              value={accountabilityValue}>
              <AccountabilityEditor
                circles={socialCircles}
                colors={colors}
                error={socialCirclesError}
                onOpenAccount={onOpenAccount}
                onOpenCircles={onOpenCircles}
                onSelectedCircleChange={onSelectedCircleChange}
                onShareMissesToggle={onShareMissesToggle}
                onShareSuccessesToggle={onShareSuccessesToggle}
                onSocialModeChange={onSocialModeChange}
                selectedCircleId={selectedCircleId}
                sessionState={socialSessionState}
                shareMisses={shareMisses}
                shareSuccesses={shareSuccesses}
                socialMode={socialMode}
              />
            </CreateFieldRow>
          ) : null}

          <CreateFieldRow
            description="Where the proof code lives"
            expanded={expandedField === 'place'}
            icon="location-outline"
            onPress={() => onFieldToggle('place')}
            title="Place or object"
            value={placeObject.trim() || 'Optional'}>
            <AppInput
              autoCapitalize="words"
              label="Place or object"
              onChangeText={onPlaceObjectChange}
              placeholder="Mailbox, front door..."
              value={placeObject}
            />
          </CreateFieldRow>

          <CreateFieldRow
            description="Anything useful to remember"
            expanded={expandedField === 'notes'}
            icon="document-text-outline"
            onPress={() => onFieldToggle('notes')}
            title="Notes"
            value={notes.trim() ? 'Added' : 'Optional'}>
            <AppInput
              label="Notes"
              multiline
              onChangeText={onNotesChange}
              placeholder="Outside by the front entrance."
              value={notes}
            />
          </CreateFieldRow>
        </FlowPanel>
      ) : null}
    </View>
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
  savedCodePresets,
  selectedSavedCodePresetId,
  onBarcodeScanned,
  onCameraFallbackAction,
  onClearCode,
  onHideScanner,
  onOpenSavedCodes,
  onOpenScanner,
  onOpenTestScanner,
  onUseSavedCode,
  permissionGranted,
  proofCodeCapturedAt,
  proofCodeVerifiedAt,
  scannerMessage,
  scannerPurpose,
  shouldShowCameraFallback,
}: {
  cameraFallbackActionLabel: string;
  cameraFallbackTitle: string;
  colors: ReturnType<typeof getAppColors>;
  error?: string;
  expectedQrPayload: string;
  isScannerEnabled: boolean;
  isScannerVisible: boolean;
  linkMode: LinkMode;
  savedCodePresets: CheckpointPreset[];
  selectedSavedCodePresetId: string | null;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onCameraFallbackAction: () => void;
  onClearCode: () => void;
  onHideScanner: () => void;
  onOpenSavedCodes: () => void;
  onOpenScanner: (mode: Extract<LinkMode, 'scanQr' | 'scanBarcode'>) => void;
  onOpenTestScanner: () => void;
  onUseSavedCode: (preset: CheckpointPreset) => void;
  permissionGranted: boolean;
  proofCodeCapturedAt: string | null;
  proofCodeVerifiedAt: string | null;
  scannerMessage: string;
  scannerPurpose: ScannerPurpose;
  shouldShowCameraFallback: boolean;
}) {
  const activeBarcodeTypes =
    scannerPurpose === 'test' || linkMode === 'scanBarcode' ? PROOF_CODE_BARCODE_TYPES : QR_BARCODE_TYPES;
  const cameraScannerKey = `${scannerPurpose}:${linkMode}`;
  const selectedSavedCodePreset = savedCodePresets.find((preset) => preset.id === selectedSavedCodePresetId) ?? null;

  return (
    <>
      <View style={styles.scanModeGrid}>
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
        <LinkModeTile
          glyph="bookmark-outline"
          label="Use Saved Code"
          onPress={onOpenSavedCodes}
          selected={linkMode === 'saved'}
        />
      </View>

      {linkMode === 'saved' ? (
        <FlowPanel>
          <FlowSectionLabel>SAVED CODES</FlowSectionLabel>
          {savedCodePresets.length > 0 ? savedCodePresets.map((preset) => {
            const isSelected = selectedSavedCodePresetId === preset.id;

            return (
              <FlowListRow
                key={preset.id}
                description={`${buildSavedCodeId(preset.expectedQrPayload)} · Last used ${new Date(
                  preset.lastUsedAt
                ).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                })}`}
                leading={
                  <Ionicons
                    color={isSelected ? colors.success : colors.primary}
                    name={isSelected ? 'checkmark-circle' : 'bookmark-outline'}
                    size={20}
                  />
                }
                onPress={() => onUseSavedCode(preset)}
                statusLabel={isSelected ? 'Selected' : 'Use'}
                statusTone={isSelected ? 'success' : 'default'}
                style={
                  isSelected
                    ? {
                        backgroundColor: colors.successSurface,
                        borderColor: colors.success,
                      }
                    : undefined
                }
                title={preset.label}
              />
            );
          }) : (
            <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
              Saved codes appear after you save a checkpoint with a scanned QR code or barcode.
            </Text>
          )}
        </FlowPanel>
      ) : null}

      {isScannerVisible ? (
        <FlowPanel style={styles.scannerPanel}>
          <View style={styles.scannerHeader}>
            <View style={styles.scannerCopy}>
              <Text style={[TextPresets.label, { color: colors.text }]}>
                {scannerPurpose === 'test' ? 'Test scan' : linkMode === 'scanBarcode' ? 'Scan barcode' : 'Scan QR code'}
              </Text>
              <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>Hold the saved code inside the frame.</Text>
            </View>
            <AppIconButton
              accessibilityHint="Closes the camera preview"
              accessibilityLabel="Hide scanner"
              icon="close"
              onPress={onHideScanner}
              size="compact"
              variant="ghost"
            />
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
                {proofCodeVerifiedAt ? 'Tested' : selectedSavedCodePreset ? 'Saved code' : 'Saved'}
              </Text>
              <AppIconButton
                accessibilityHint="Removes the linked proof code from this checkpoint"
                accessibilityLabel="Clear saved code"
                icon="trash-outline"
                onPress={onClearCode}
                size="compact"
                variant="danger"
              />
            </View>
            <View style={[styles.linkedCodeIcon, { backgroundColor: colors.panelMuted }]}>
              <Ionicons
                color={colors.text}
                name={linkMode === 'scanBarcode' ? 'barcode-outline' : 'qr-code-outline'}
                size={44}
              />
            </View>
            <Text style={[styles.codeId, { color: colors.text }]}>ID: {buildSavedCodeId(expectedQrPayload)}</Text>
            <Text style={[styles.codeTimestamp, { color: colors.textSoft }]}>
              {selectedSavedCodePreset
                ? `Picked from ${selectedSavedCodePreset.label}`
                : proofCodeCapturedAt
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
              Scan a QR code, scan a barcode, or choose a saved code to link proof.
            </Text>
            {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}
          </View>
        )}
      </FlowPanel>

      {expectedQrPayload.trim() ? (
        <View style={styles.testScanGroup}>
          <FlowSectionLabel>OPTIONAL TEST SCAN</FlowSectionLabel>
          <Pressable
            accessibilityLabel={`Test Scan. Optionally verify this code matches. ${proofCodeVerifiedAt ? 'Matched' : 'Optional'}.`}
            accessibilityRole="button"
            onPress={onOpenTestScanner}
            style={({ pressed }) => [styles.testScanRow, pressed && styles.pressed]}>
            <Ionicons color={colors.primary} name="scan-outline" size={19} />
            <View style={styles.testScanCopy}>
              <Text style={[styles.testScanTitle, { color: colors.text }]}>Test Scan</Text>
              <Text style={[styles.testScanDescription, { color: colors.textSoft }]}>
                {proofCodeVerifiedAt ? 'Verified. This code matches.' : 'Optional — confirm the linked code still matches'}
              </Text>
            </View>
            <StatusPill label={proofCodeVerifiedAt ? 'Matched' : 'Optional'} tone={proofCodeVerifiedAt ? 'success' : 'default'} />
            <Ionicons color={colors.muted} name="chevron-forward" size={17} />
          </Pressable>
          {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}
        </View>
      ) : null}

      <FlowPanel style={styles.strictInfo} tone="muted">
        <View style={styles.strictInfoIcon}>
          <Ionicons color={colors.primary} name="shield-checkmark-outline" size={22} />
        </View>
        <View style={styles.strictInfoCopy}>
          <Text style={[TextPresets.label, { color: colors.text }]}>Exact matching is required.</Text>
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
            Camera access is required to scan a QR code or barcode for this checkpoint.
          </Text>
          <AppButton label={cameraFallbackActionLabel} onPress={onCameraFallbackAction} size="compact" variant="secondary" />
        </FlowPanel>
      ) : null}
    </>
  );
}

function AccountabilityEditor({
  circles,
  colors,
  error,
  onOpenAccount,
  onOpenCircles,
  onSelectedCircleChange,
  onShareMissesToggle,
  onShareSuccessesToggle,
  onSocialModeChange,
  selectedCircleId,
  sessionState,
  shareMisses,
  shareSuccesses,
  socialMode,
}: {
  circles: SocialCircleSummary[];
  colors: ReturnType<typeof getAppColors>;
  error: string;
  onOpenAccount: () => void;
  onOpenCircles: () => void;
  onSelectedCircleChange: (value: string) => void;
  onShareMissesToggle: () => void;
  onShareSuccessesToggle: () => void;
  onSocialModeChange: (value: SocialMode) => void;
  selectedCircleId: string | null;
  sessionState: {
    configured: boolean;
    isLoading: boolean;
    isProfileComplete: boolean;
    signedIn: boolean;
  };
  shareMisses: boolean;
  shareSuccesses: boolean;
  socialMode: SocialMode;
}) {
  const hasCircles = circles.length > 0;
  const canSelectCircle = sessionState.configured && sessionState.signedIn && sessionState.isProfileComplete && hasCircles;

  return (
    <View style={styles.accountabilityEditor}>
      <View style={styles.optionGrid}>
        <OptionChip
          description="Only you can see outcomes"
          onPress={() => onSocialModeChange('private')}
          selected={socialMode === 'private'}
          title="Private"
        />
        <OptionChip
          description={canSelectCircle ? 'Share selected outcomes' : 'Requires a circle'}
          onPress={() => {
            if (canSelectCircle) {
              onSocialModeChange('circle');
            }
          }}
          selected={socialMode === 'circle'}
          title="Circle"
        />
      </View>

      {!sessionState.configured ? (
        <FlowPanel tone="muted">
          <Text style={[TextPresets.label, { color: colors.text }]}>Circles unavailable</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            Private checkpoints still work. Add backend configuration before sharing outcomes.
          </Text>
        </FlowPanel>
      ) : sessionState.isLoading ? (
        <FlowPanel tone="muted">
          <SkeletonTextStack lines={2} widths={['64%', '42%']} />
        </FlowPanel>
      ) : !sessionState.signedIn ? (
        <FlowPanel tone="muted">
          <Text style={[TextPresets.label, { color: colors.text }]}>Sign in to share</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            Private checkpoint creation is always available.
          </Text>
          <AppButton label="Go to account" onPress={onOpenAccount} size="compact" variant="secondary" />
        </FlowPanel>
      ) : !sessionState.isProfileComplete ? (
        <FlowPanel tone="muted">
          <Text style={[TextPresets.label, { color: colors.text }]}>Finish your profile</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            Save a display name before sharing checkpoint outcomes.
          </Text>
          <AppButton label="Complete profile" onPress={onOpenAccount} size="compact" variant="secondary" />
        </FlowPanel>
      ) : error ? (
        <FlowPanel tone="warning">
          <Text style={[TextPresets.label, { color: colors.text }]}>Circles did not load</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            {error} Private checkpoints still save normally.
          </Text>
        </FlowPanel>
      ) : !hasCircles ? (
        <FlowPanel tone="muted">
          <Text style={[TextPresets.label, { color: colors.text }]}>No circles yet</Text>
          <Text style={[TextPresets.body, styles.smallBody, { color: colors.textSoft }]}>
            Create or join a circle, then come back to share checkpoint outcomes.
          </Text>
          <AppButton label="Create or join" onPress={onOpenCircles} size="compact" variant="secondary" />
        </FlowPanel>
      ) : null}

      {canSelectCircle && socialMode === 'circle' ? (
        <>
          <View style={styles.circlePickerList}>
            {circles.map((circle) => (
              <FlowListRow
                key={circle.id}
                description={`${circle.memberCount} member${circle.memberCount === 1 ? '' : 's'}`}
                leading={
                  <Ionicons
                    color={selectedCircleId === circle.id ? colors.success : colors.primary}
                    name={selectedCircleId === circle.id ? 'checkmark-circle' : 'people-outline'}
                    size={20}
                  />
                }
                onPress={() => onSelectedCircleChange(circle.id)}
                statusLabel={selectedCircleId === circle.id ? 'Selected' : undefined}
                statusTone="success"
                title={circle.name}
              />
            ))}
          </View>

          <FlowSectionLabel>SHARE WITH CIRCLE</FlowSectionLabel>
          <View style={styles.optionGrid}>
            <OptionChip
              description="Tell the circle when this is missed"
              onPress={onShareMissesToggle}
              selected={shareMisses}
              title="Share misses"
            />
            <OptionChip
              description="Tell the circle when this is cleared"
              onPress={onShareSuccessesToggle}
              selected={shareSuccesses}
              title="Share clears"
            />
          </View>
        </>
      ) : null}
    </View>
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
        isExpanded={expanded}
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

function alertNotificationPermission(onOpenSettings: () => void) {
  Alert.alert(
    'Turn notifications back on',
    'Checkpoints need notifications to go live at the right time. Enable notifications in Settings, then return here to save this checkpoint.',
    [
      {
        text: 'Not now',
        style: 'cancel',
      },
      {
        text: 'Open Settings',
        onPress: onOpenSettings,
      },
    ]
  );
}

const styles = StyleSheet.create({
  createRoot: {
    flex: 1,
  },
  practiceTransitionOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    zIndex: 20,
  },
  practiceTransitionTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  practiceTransitionCopy: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  screenContent: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
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
  detailsLayout: {
    gap: Spacing.md,
  },
  nameSection: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  fieldLabel: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    letterSpacing: 0.55,
    lineHeight: 14,
  },
  corePanel: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    gap: 6,
    padding: 0,
  },
  optionalPanel: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    gap: 6,
    padding: 0,
  },
  editorLabel: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 14,
  },
  moreOptionsButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 62,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  moreOptionsIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  moreOptionsCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  moreOptionsTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  moreOptionsDescription: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  firstUseCaseLayout: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  firstUseCaseIntro: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: Spacing.xs,
  },
  firstUseCaseList: {
    gap: Spacing.sm,
  },
  firstUseCaseCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 88,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  firstUseCaseIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  firstUseCaseCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  firstUseCaseTitle: {
    ...TextPresets.label,
    fontSize: 16,
    lineHeight: 21,
  },
  firstUseCaseDescription: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  firstUseCaseNote: {
    alignItems: 'flex-start',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  firstUseCaseNoteText: {
    ...TextPresets.body,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  guidedBanner: {
    alignItems: 'flex-start',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  guidedBannerText: {
    ...TextPresets.body,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
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
  accountabilityEditor: {
    gap: Spacing.md,
  },
  circlePickerList: {
    gap: Spacing.sm,
  },
  scanModeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkModeTile: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexBasis: 96,
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
  linkedCodeIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 96,
    justifyContent: 'center',
    width: 96,
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
  testScanGroup: {
    gap: 7,
  },
  testScanRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  testScanCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  testScanTitle: {
    ...TextPresets.label,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  testScanDescription: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
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
