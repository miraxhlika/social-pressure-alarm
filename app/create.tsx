import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore, saveNewAlarm, updateAlarm } from '@/lib/alarms';
import {
  CHECKPOINT_TEMPLATES,
  formatGracePeriodLabel,
  getCheckpointTemplate,
  getCheckpointTemplateDefaults,
  getUseCaseLabel,
} from '@/lib/checkpoint-templates';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { markOnboardingCompleted } from '@/lib/onboarding';
import { listMySocialCircles } from '@/lib/social/circles';
import { SocialCircleSummary } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, CheckpointPreset, FREE_ALARM_LIMIT, RepeatSchedule, UseCaseType } from '@/types/alarm';

const REPEAT_OPTIONS: { value: RepeatSchedule; label: string; help: string }[] = [
  { value: 'once', label: 'Once', help: 'One scheduled run' },
  { value: 'daily', label: 'Daily', help: 'Every day' },
  { value: 'weekdays', label: 'Weekdays', help: 'Mon to Fri' },
];

const GRACE_PRESET_OPTIONS = [
  { value: 45, label: '45 sec', help: 'Very close checkpoint' },
  { value: 90, label: '90 sec', help: 'Short walk' },
  { value: 120, label: '2 min', help: 'Strong default' },
  { value: 180, label: '3 min', help: 'More forgiving' },
] as const;

type FormErrors = {
  label?: string;
  expectedQrPayload?: string;
  gracePeriodSeconds?: string;
};

function createInitialTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

function getModeLabel(isEditMode: boolean, isReuseMode: boolean) {
  if (isEditMode) {
    return 'Edit';
  }

  if (isReuseMode) {
    return 'Reuse';
  }

  return 'New';
}

function normalizeRepeatScheduleParam(value: string | undefined, fallback: RepeatSchedule) {
  return value === 'daily' || value === 'weekdays' || value === 'once' ? value : fallback;
}

function buildCheckpointPlanSummary({
  useCaseType,
  label,
  formattedTime,
  repeatSchedule,
  gracePeriodSeconds,
  hasCode,
  socialLabel,
}: {
  useCaseType: UseCaseType;
  label: string;
  formattedTime: string;
  repeatSchedule: RepeatSchedule;
  gracePeriodSeconds: number;
  hasCode: boolean;
  socialLabel: string;
}) {
  const useCaseLabel = getUseCaseLabel(useCaseType);
  const repeatLabel =
    repeatSchedule === 'daily' ? 'every day' : repeatSchedule === 'weekdays' ? 'on weekdays' : 'once';
  const checkpointLabel = label.trim() || getCheckpointTemplate(useCaseType).defaultLabel || 'your checkpoint';
  const codeLabel = hasCode ? 'Code ready.' : 'Code still needed.';

  return `${useCaseLabel} at ${formattedTime}, ${repeatLabel}. You will have ${formatGracePeriodLabel(
    gracePeriodSeconds
  )} to scan ${checkpointLabel}. ${socialLabel}. ${codeLabel}`;
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    alarmId?: string;
    mode?: string;
    onboardingMode?: string;
    recoveryFocus?: string;
    prefillUseCaseType?: string;
    prefillLabel?: string;
    prefillRepeatSchedule?: string;
    prefillGracePeriodSeconds?: string;
  }>();
  const colors = getAppColors(useColorScheme());
  const { configured, isProfileComplete, user } = useSocialSession();
  const [time, setTime] = useState(createInitialTime);
  const [label, setLabel] = useState('');
  const [useCaseType, setUseCaseType] = useState<UseCaseType>('custom');
  const [expectedQrPayload, setExpectedQrPayload] = useState('');
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>('once');
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState('120');
  const [isCustomGraceExpanded, setIsCustomGraceExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const [savedPresets, setSavedPresets] = useState<CheckpointPreset[]>([]);
  const [arePresetsExpanded, setArePresetsExpanded] = useState(false);
  const [availableCircles, setAvailableCircles] = useState<SocialCircleSummary[]>([]);
  const [isSocialOptionsLoading, setIsSocialOptionsLoading] = useState(false);
  const [isSocialExpanded, setIsSocialExpanded] = useState(false);
  const [selectedCircleId, setSelectedCircleId] = useState('');
  const [shareSuccesses, setShareSuccesses] = useState(false);
  const [shareMisses, setShareMisses] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [sourceAlarm, setSourceAlarm] = useState<Alarm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [permission, requestPermission] = useCameraPermissions();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditMode = params.mode === 'edit' && typeof params.alarmId === 'string';
  const isReuseMode = params.mode === 'reuse' && typeof params.alarmId === 'string';
  const isOnboardingConversion = params.onboardingMode === 'convert_demo';
  const recoveryFocus = params.recoveryFocus === 'grace' || params.recoveryFocus === 'time' ? params.recoveryFocus : undefined;

  const formattedTime = useMemo(
    () =>
      time.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time]
  );
  const gracePreviewSeconds = useMemo(() => {
    const parsedValue = Number.parseInt(gracePeriodSeconds, 10);
    return Number.isFinite(parsedValue) ? Math.max(parsedValue, 0) : 0;
  }, [gracePeriodSeconds]);

  const screenTitle = isEditMode
    ? 'Edit checkpoint'
    : isReuseMode
      ? 'Reuse checkpoint'
      : isOnboardingConversion
        ? 'Finish the real checkpoint'
        : 'New checkpoint';
  const screenSubtitle = isEditMode
    ? 'Update the timing, proof, or accountability rules.'
    : isReuseMode
      ? 'Start from an existing checkpoint and edit anything.'
      : isOnboardingConversion
        ? 'Your practice choice is already loaded. Set the real schedule and scan the real checkpoint code.'
        : 'Start from a use-case template, then fine-tune the details.';
  const primaryActionLabel = isEditMode ? 'Save changes' : isOnboardingConversion ? 'Save real checkpoint' : 'Save checkpoint';
  const recoveryBannerCopy =
    recoveryFocus === 'grace'
      ? 'The last miss suggests the checkpoint may be too hard to reach in time. Start by adjusting the reach window.'
      : recoveryFocus === 'time'
        ? 'The last miss suggests the trigger time may not fit the real routine yet. Move the checkpoint to a better moment.'
        : null;
  const socialEnabled = configured && user && isProfileComplete;
  const selectedCircle = availableCircles.find((circle) => circle.id === selectedCircleId) ?? null;
  const socialShareCount = Number(shareSuccesses) + Number(shareMisses);
  const setupSummary = !selectedCircle
    ? 'Private by default'
    : socialShareCount === 2
      ? `Shares clears and misses with ${selectedCircle.name}`
      : shareSuccesses
        ? `Shares clears with ${selectedCircle.name}`
        : shareMisses
          ? `Shares misses with ${selectedCircle.name}`
          : `Circle selected: ${selectedCircle.name}`;
  const socialSummaryLabel = !selectedCircle ? 'Private' : setupSummary;
  const visiblePresets = arePresetsExpanded ? savedPresets : savedPresets.slice(0, 3);
  const selectedGracePreset =
    GRACE_PRESET_OPTIONS.find((option) => option.value === Number.parseInt(gracePeriodSeconds, 10)) ?? null;
  const parsedGracePeriod = Number.parseInt(gracePeriodSeconds, 10);
  const checkpointLabelPreview = label.trim() || sourceAlarm?.label || 'Choose a checkpoint';
  const selectedTemplate = getCheckpointTemplate(useCaseType);
  const checkpointStatusLabel = isScannerVisible
    ? 'Scanner live'
    : expectedQrPayload
      ? 'Checkpoint ready'
      : 'Checkpoint needed';
  const checkpointStatusTone = isScannerVisible ? 'primary' : expectedQrPayload ? 'success' : 'warning';
  const showSocialStep = configured;
  const stepItems = showSocialStep
    ? [
        { id: 1 as const, label: 'Checkpoint', detail: 'Time and code' },
        { id: 2 as const, label: 'Rules', detail: 'Repeat and reach time' },
        { id: 3 as const, label: 'Sharing', detail: 'Optional' },
      ]
    : [
        { id: 1 as const, label: 'Checkpoint', detail: 'Time and code' },
        { id: 2 as const, label: 'Rules', detail: 'Repeat and reach time' },
      ];
  const checkpointPlanSummary = useMemo(
    () =>
      buildCheckpointPlanSummary({
        useCaseType,
        label,
        formattedTime,
        repeatSchedule,
        gracePeriodSeconds: gracePreviewSeconds,
        hasCode: expectedQrPayload.trim().length > 0,
        socialLabel: socialSummaryLabel,
      }),
    [expectedQrPayload, formattedTime, gracePreviewSeconds, label, repeatSchedule, socialSummaryLabel, useCaseType]
  );

  const handleTimeChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) {
      return;
    }

    setTime(selectedDate);
  };

  useEffect(() => {
    const loadFormData = async () => {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();
      setSavedPresets(store.checkpointPresets);
      setErrors({});
      setActiveStep(recoveryFocus === 'grace' ? 2 : 1);

      if (!params.alarmId || (!isEditMode && !isReuseMode)) {
        const prefilledTemplate = getCheckpointTemplateDefaults(params.prefillUseCaseType);
        const prefilledGracePeriod = Number.parseInt(params.prefillGracePeriodSeconds ?? '', 10);

        setSourceAlarm(null);
        setUseCaseType(prefilledTemplate.useCaseType);
        setLabel(typeof params.prefillLabel === 'string' ? params.prefillLabel : prefilledTemplate.label);
        setExpectedQrPayload('');
        setRepeatSchedule(normalizeRepeatScheduleParam(params.prefillRepeatSchedule, prefilledTemplate.repeatSchedule));
        setGracePeriodSeconds(
          Number.isFinite(prefilledGracePeriod) && prefilledGracePeriod >= 15
            ? String(prefilledGracePeriod)
            : String(prefilledTemplate.gracePeriodSeconds)
        );
        setSelectedCircleId('');
        setIsSocialExpanded(false);
        setIsCustomGraceExpanded(
          !GRACE_PRESET_OPTIONS.some((option) =>
            option.value ===
            (Number.isFinite(prefilledGracePeriod) && prefilledGracePeriod >= 15
              ? prefilledGracePeriod
              : prefilledTemplate.gracePeriodSeconds)
          )
        );
        setShareSuccesses(false);
        setShareMisses(false);
        return;
      }

      const alarm = store.alarms.find((candidate) => candidate.id === params.alarmId) ?? null;

      if (!alarm) {
        setSourceAlarm(null);
        setUseCaseType('custom');
        setSelectedCircleId('');
        setIsSocialExpanded(false);
        setIsCustomGraceExpanded(false);
        setShareSuccesses(false);
        setShareMisses(false);
        return;
      }

      const nextTime = createInitialTime();
      nextTime.setHours(alarm.hour, alarm.minute, 0, 0);

      setSourceAlarm(alarm);
      setTime(nextTime);
      setLabel(alarm.label);
      setUseCaseType(alarm.useCaseType);
      setExpectedQrPayload(alarm.expectedQrPayload);
      setRepeatSchedule(alarm.repeatSchedule);
      setGracePeriodSeconds(String(alarm.gracePeriodSeconds));
      setIsCustomGraceExpanded(
        !GRACE_PRESET_OPTIONS.some((option) => option.value === alarm.gracePeriodSeconds)
      );
      setSelectedCircleId(alarm.socialSettings?.circleId ?? '');
      setIsSocialExpanded(Boolean(alarm.socialSettings?.circleId));
      setShareSuccesses(alarm.socialSettings?.shareSuccesses ?? false);
      setShareMisses(alarm.socialSettings?.shareMisses ?? false);
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
    recoveryFocus,
  ]);

  useEffect(() => {
    if (!socialEnabled) {
      setAvailableCircles([]);
      setSelectedCircleId('');
      setIsSocialExpanded(false);
      setShareSuccesses(false);
      setShareMisses(false);
      setIsSocialOptionsLoading(false);
      return;
    }

    let isMounted = true;
    setIsSocialOptionsLoading(true);

    const loadCircles = async () => {
      try {
        const circles = await listMySocialCircles();

        if (!isMounted) {
          return;
        }

        setAvailableCircles(circles);
        setSelectedCircleId((currentCircleId) =>
          currentCircleId && circles.some((circle) => circle.id === currentCircleId) ? currentCircleId : ''
        );
      } catch {
        if (isMounted) {
          setAvailableCircles([]);
        }
      } finally {
        if (isMounted) {
          setIsSocialOptionsLoading(false);
        }
      }
    };

    void loadCircles();

    return () => {
      isMounted = false;
    };
  }, [socialEnabled]);

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

  const validateCheckpointStep = useCallback(() => {
    const nextErrors: FormErrors = {};

    if (!label.trim()) {
      nextErrors.label = 'Name the checkpoint you will recognize instantly.';
    }

    if (!expectedQrPayload.trim()) {
      nextErrors.expectedQrPayload = 'Scan the checkpoint code or paste it exactly.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        ...nextErrors,
      }));
      return false;
    }

    return true;
  }, [expectedQrPayload, label]);

  const validateRulesStep = useCallback(() => {
    if (Number.isNaN(parsedGracePeriod) || parsedGracePeriod < 15) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        gracePeriodSeconds: 'Use at least 15 seconds so the checkpoint is still reachable.',
      }));
      return false;
    }

    return true;
  }, [parsedGracePeriod]);

  const isCheckpointStepComplete = label.trim().length > 0 && expectedQrPayload.trim().length > 0;
  const isRulesStepComplete = Number.isFinite(parsedGracePeriod) && parsedGracePeriod >= 15;

  const canAccessStep = useCallback(
    (stepId: 1 | 2 | 3) => {
      if (stepId <= activeStep) {
        return true;
      }

      if (stepId === 2) {
        return isCheckpointStepComplete;
      }

      if (!showSocialStep) {
        return false;
      }

      return isCheckpointStepComplete && isRulesStepComplete;
    },
    [activeStep, isCheckpointStepComplete, isRulesStepComplete, showSocialStep]
  );

  const handleStepPress = useCallback(
    (stepId: 1 | 2 | 3) => {
      if (stepId === 1) {
        setActiveStep(1);
        return;
      }

      if (stepId === 2) {
        if (!validateCheckpointStep()) {
          return;
        }

        setActiveStep(2);
        return;
      }

      if (!showSocialStep || !validateCheckpointStep() || !validateRulesStep()) {
        return;
      }

      setActiveStep(3);
      setIsSocialExpanded(true);
    },
    [showSocialStep, validateCheckpointStep, validateRulesStep]
  );

  const handleOpenScanner = useCallback(async () => {
    setScannerMessage('');

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScannerMessage('Camera access is required to scan a QR code into this field.');
        return;
      }
    }

    setIsScannerEnabled(true);
    setIsScannerVisible(true);
  }, [permission?.granted, requestPermission]);

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!isScannerEnabled) {
        return;
      }

      setIsScannerEnabled(false);
      setExpectedQrPayload(data);
      setErrors((currentErrors) => ({
        ...currentErrors,
        expectedQrPayload: undefined,
      }));
      setScannerMessage('QR payload captured. You can still edit the value manually if needed.');
      setIsScannerVisible(false);

      if (scannerTimeoutRef.current) {
        clearTimeout(scannerTimeoutRef.current);
      }

      scannerTimeoutRef.current = setTimeout(() => {
        setIsScannerEnabled(true);
      }, 500);
    },
    [isScannerEnabled]
  );

  const handleCheckpointLimitReached = useCallback(
    async (source: 'create' | 'checkpoints_tab') => {
      const store = await readAlarmStore();
      await trackAnalyticsEvent('checkpoint_limit_reached', {
        limit: FREE_ALARM_LIMIT,
        creationCount: store.lifetimeAlarmCreations,
        source,
      });

      Alert.alert(
        'Checkpoint limit reached',
        `This preview build currently allows ${FREE_ALARM_LIMIT} saved checkpoints per device. Edit, reuse, or delete an existing checkpoint for now.`,
        [
          {
            text: 'Manage checkpoints',
            onPress: () => router.replace('/alarms'),
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    },
    [router]
  );

  const handleTemplateSelect = useCallback(
    (nextUseCaseType: UseCaseType) => {
      const defaults = getCheckpointTemplateDefaults(nextUseCaseType);

      setUseCaseType(defaults.useCaseType);
      setLabel(defaults.label);
      setRepeatSchedule(defaults.repeatSchedule);
      setGracePeriodSeconds(String(defaults.gracePeriodSeconds));
      setIsCustomGraceExpanded(false);
      setErrors((currentErrors) => ({
        ...currentErrors,
        label: undefined,
        gracePeriodSeconds: undefined,
      }));

      void trackAnalyticsEvent('use_case_selected', {
        source: 'create',
        useCaseType: defaults.useCaseType,
      });
    },
    []
  );

  const handleContinueToRules = () => {
    if (!validateCheckpointStep()) {
      return;
    }

    setActiveStep(2);
  };

  const handleContinueToSharing = () => {
    if (!validateRulesStep()) {
      return;
    }

    setActiveStep(3);
    setIsSocialExpanded(true);
  };

  const handleSave = useCallback(async () => {
    const trimmedLabel = label.trim();
    const trimmedExpectedQrPayload = expectedQrPayload.trim();
    const gracePeriod = Number.parseInt(gracePeriodSeconds, 10);
    const nextErrors: FormErrors = {};

    if (!trimmedLabel) {
      nextErrors.label = 'Give this checkpoint a short label you will recognize immediately.';
    }

    if (!trimmedExpectedQrPayload) {
      nextErrors.expectedQrPayload = 'Scan a checkpoint QR code or type the exact payload it should accept.';
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      nextErrors.gracePeriodSeconds = 'Use 15 seconds or more so you still have a realistic chance to scan.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});

    const store = await readAlarmStore();

    if (!isEditMode && store.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      await handleCheckpointLimitReached('create');
      return;
    }

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
        expectedQrPayload: trimmedExpectedQrPayload,
        repeatSchedule,
        gracePeriodSeconds: gracePeriod,
        isActive: true,
        createdAt: isEditMode && sourceAlarm ? sourceAlarm.createdAt : new Date().toISOString(),
        socialSettings: selectedCircleId
          ? {
              circleId: selectedCircleId,
              shareSuccesses,
              shareMisses,
            }
          : undefined,
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
          socialMode: selectedCircleId ? 'circle' : 'private',
        });

        if (store.lifetimeAlarmCreations === 1) {
          await trackAnalyticsEvent('second_checkpoint_created', {
            checkpointId: nextAlarm.id,
            useCaseType,
            repeatSchedule,
            gracePeriodSeconds: gracePeriod,
          });
        }
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

      router.replace('/');
    } catch (error) {
      if (scheduledNotificationIds) {
        await cancelAlarmNotificationAsync(scheduledNotificationIds);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'The checkpoint could not be saved right now.';

      Alert.alert('Unable to save checkpoint', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [
    expectedQrPayload,
    gracePeriodSeconds,
    handleCheckpointLimitReached,
    isEditMode,
    isReuseMode,
    label,
    repeatSchedule,
    router,
    selectedCircleId,
    shareMisses,
    shareSuccesses,
    sourceAlarm,
    time,
    useCaseType,
    isOnboardingConversion,
  ]);

  return (
    <AppScreen
      footer={
        <View style={styles.bottomActions}>
          <AppButton
            disabled={isSaving}
            label={
              activeStep === 1
                ? 'Continue'
                : activeStep === 2
                  ? showSocialStep
                    ? 'Continue'
                    : isSaving
                      ? 'Saving...'
                      : primaryActionLabel
                  : isSaving
                    ? 'Saving...'
                    : primaryActionLabel
            }
            onPress={
              activeStep === 1
                ? handleContinueToRules
                : activeStep === 2
                  ? showSocialStep
                    ? handleContinueToSharing
                    : handleSave
                  : handleSave
            }
            style={styles.bottomAction}
          />
          <AppButton
            label={activeStep === 1 ? 'Cancel' : 'Back'}
            onPress={activeStep === 1 ? () => router.back() : () => setActiveStep((currentStep) => (currentStep === 3 ? 2 : 1))}
            style={styles.bottomAction}
            variant="secondary"
          />
        </View>
      }
      scrollRef={scrollViewRef}
      keyboardAware>
      <PageHeader
        badgeLabel={getModeLabel(isEditMode, isReuseMode)}
        badgeTone="primary"
        description={screenSubtitle}
        title={screenTitle}
      />

      {isOnboardingConversion ? (
        <AppCard elevated tone="primary" variant="inline">
          <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>From practice to real setup</Text>
          <Text style={[TextPresets.body, { color: colors.textSoft }]}>
            The use case, cadence, and reach window came from your practice run. Add the real QR code and choose the real time now.
          </Text>
        </AppCard>
      ) : null}

      {recoveryBannerCopy ? (
        <AppCard elevated tone="warning" variant="inline">
          <Text style={[TextPresets.eyebrow, { color: colors.warning }]}>Recovery edit</Text>
          <Text style={[TextPresets.body, { color: colors.textSoft }]}>{recoveryBannerCopy}</Text>
        </AppCard>
      ) : null}

      <View style={styles.stepRail}>
        {stepItems.map((step) => {
          const isActive = activeStep === step.id;
          const isAvailable = canAccessStep(step.id);

          return (
            <Pressable
              key={step.id}
              accessibilityLabel={`Step ${step.id}: ${step.label}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isAvailable, selected: isActive }}
              disabled={!isAvailable}
              onPress={() => handleStepPress(step.id)}
              style={[
                styles.stepCard,
                {
                  backgroundColor: isActive ? colors.primarySurface : colors.card,
                  borderColor: isActive ? colors.primary : colors.line,
                  opacity: isAvailable ? 1 : 0.55,
                },
              ]}>
              <View
                style={[
                  styles.stepNumberBadge,
                  {
                    backgroundColor: isActive ? colors.primary : colors.panelMuted,
                  },
                ]}>
                <Text style={[styles.stepNumber, { color: isActive ? colors.primaryText : colors.muted }]}>{step.id}</Text>
              </View>
              <Text numberOfLines={1} style={[styles.stepLabel, { color: isActive ? colors.primary : colors.textSoft }]}>
                {step.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <AppCard elevated tone="canvas" style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Live preview</Text>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              {selectedTemplate.title} {formattedTime}
            </Text>
          </View>
          <StatusPill label={expectedQrPayload ? 'Ready to save' : 'Needs code'} tone={expectedQrPayload ? 'success' : 'warning'} />
        </View>
        <Text style={[TextPresets.body, { color: colors.textSoft }]}>{checkpointPlanSummary}</Text>
      </AppCard>

      {activeStep === 1 ? (
        <AppCard elevated tone="primary">
          <SectionHeader
            kicker="Step 1"
            title="Set the checkpoint"
            description="Start from a template, then choose the exact time and proof."
            action={<StatusPill label="Required" tone="primary" />}
          />

          <View style={styles.templateSection}>
            <View style={styles.templateSectionCopy}>
              <Text style={[TextPresets.label, { color: colors.text }]}>Use-case templates</Text>
              <Text style={[TextPresets.body, { color: colors.muted }]}>
                Pick the setup that is closest to the commitment you want to protect.
              </Text>
            </View>

            <View style={styles.templateGrid}>
              {CHECKPOINT_TEMPLATES.map((template) => {
                const isSelected = template.id === useCaseType;

                return (
                  <Pressable
                    key={template.id}
                    accessibilityHint={`Loads the ${template.title} defaults into this checkpoint.`}
                    accessibilityLabel={`${template.title} template`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleTemplateSelect(template.id)}
                    style={[
                      styles.templateCard,
                      {
                        backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                        borderColor: isSelected ? colors.primary : colors.line,
                      },
                    ]}>
                    <View style={styles.templateCardHeader}>
                      <Text style={[TextPresets.label, { color: isSelected ? colors.primary : colors.text }]}>
                        {template.title}
                      </Text>
                      <StatusPill
                        label={formatGracePeriodLabel(template.gracePeriodSeconds)}
                        tone={isSelected ? 'primary' : 'default'}
                      />
                    </View>
                    <Text style={[TextPresets.body, { color: colors.textSoft }]}>{template.description}</Text>
                    <Text style={[TextPresets.body, { color: colors.muted }]}>
                      {template.defaultLabel ? `Starts with "${template.defaultLabel}"` : 'Starts with a blank label'} ·{' '}
                      {template.repeatSchedule === 'daily'
                        ? 'Every day'
                        : template.repeatSchedule === 'weekdays'
                          ? 'Weekdays'
                          : 'One time'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.timePanel, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
            <View style={styles.timeCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Trigger time</Text>
              <Text style={[styles.timeValue, { color: colors.text }]}>{formattedTime}</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>When this checkpoint goes live.</Text>
            </View>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'compact' : 'default'}
              mode="time"
              onChange={handleTimeChange}
              value={time}
            />
          </View>

          <AppInput
            autoCapitalize="words"
            error={errors.label}
            helper="Use the place or object you will recognize instantly."
            label="Checkpoint name"
            onChangeText={(nextValue) => {
              setLabel(nextValue);
              setErrors((currentErrors) => ({ ...currentErrors, label: undefined }));
            }}
            placeholder={selectedTemplate.defaultLabel || 'Front door'}
            value={label}
          />

          <View
            style={[
              styles.scanCard,
              {
                backgroundColor: isScannerVisible ? colors.elevated : colors.panelMuted,
                borderColor: isScannerVisible ? colors.primary : colors.line,
              },
            ]}>
            <View style={styles.scanHeader}>
              <View style={styles.scanCopy}>
                <Text style={[TextPresets.label, { color: colors.text }]}>Checkpoint code</Text>
                <Text style={[TextPresets.body, { color: colors.muted }]}>
                  Scan it now if it is nearby, or reuse a saved checkpoint.
                </Text>
              </View>
              <StatusPill label={checkpointStatusLabel} tone={checkpointStatusTone} />
            </View>

            <View style={styles.actionRow}>
              <AppButton
                label={expectedQrPayload ? 'Scan again' : 'Scan code'}
                onPress={() => {
                  void handleOpenScanner();
                }}
                style={styles.actionFill}
                variant="secondary"
              />
              {isScannerVisible ? (
                <AppButton
                  label="Hide"
                  onPress={() => setIsScannerVisible(false)}
                  style={styles.actionFill}
                  variant="ghost"
                />
              ) : null}
            </View>

            {isScannerVisible && permission?.granted ? (
              <View style={styles.scannerSection}>
                <CameraView
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                  onBarcodeScanned={isScannerEnabled ? handleBarcodeScanned : undefined}
                  style={styles.camera}
                />
                <Text style={[TextPresets.body, { color: colors.muted }]}>Hold the saved QR code inside the frame.</Text>
              </View>
            ) : null}

            {scannerMessage ? (
              <Text style={[TextPresets.body, { color: permission?.granted === false ? colors.danger : colors.textSoft }]}>
                {scannerMessage}
              </Text>
            ) : null}
          </View>

          {savedPresets.length > 0 ? (
            <View style={[styles.inlineSection, { borderTopColor: colors.line }]}>
              <View style={styles.inlineSectionHeader}>
                <View style={styles.inlineSectionCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Saved checkpoint codes</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>Reuse a trusted code and keep moving.</Text>
                </View>
                <AppButton
                  label={arePresetsExpanded ? 'Less' : 'More'}
                  onPress={() => setArePresetsExpanded((currentValue) => !currentValue)}
                  size="compact"
                  variant="ghost"
                />
              </View>

              <View style={styles.presetGrid}>
                {visiblePresets.map((preset) => {
                  const isSelectedPreset =
                    label.trim() === preset.label && expectedQrPayload.trim() === preset.expectedQrPayload;

                  return (
                    <Pressable
                      key={preset.id}
                      accessibilityHint={`Loads the ${preset.label} checkpoint into the form.`}
                      accessibilityLabel={`Use saved checkpoint ${preset.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelectedPreset }}
                      onPress={() => {
                        setLabel(preset.label);
                        setExpectedQrPayload(preset.expectedQrPayload);
                        setErrors((currentErrors) => ({
                          ...currentErrors,
                          label: undefined,
                          expectedQrPayload: undefined,
                        }));
                        setScannerMessage(`Loaded ${preset.label}.`);
                      }}
                      style={[
                        styles.inlinePresetCard,
                        {
                          backgroundColor: isSelectedPreset ? colors.primarySurface : colors.elevated,
                          borderColor: isSelectedPreset ? colors.primary : colors.line,
                        },
                      ]}>
                      <Text style={[TextPresets.label, { color: isSelectedPreset ? colors.primary : colors.text }]}>
                        {preset.label}
                      </Text>
                      <Text numberOfLines={1} style={[TextPresets.body, { color: colors.muted }]}>
                        {preset.expectedQrPayload}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <AppInput
            autoCapitalize="none"
            autoCorrect={false}
            error={errors.expectedQrPayload}
            helper="This must match exactly when the checkpoint goes live."
            label="Checkpoint code"
            onChangeText={(nextValue) => {
              setExpectedQrPayload(nextValue);
              setErrors((currentErrors) => ({ ...currentErrors, expectedQrPayload: undefined }));
            }}
            placeholder="bathroom-checkpoint"
            value={expectedQrPayload}
          />
        </AppCard>
      ) : null}

      {activeStep === 2 ? (
        <AppCard elevated tone="canvas">
          <SectionHeader
            kicker="Step 2"
            title="Shape the rules"
            description={`${formattedTime} · ${checkpointLabelPreview}`}
          />

          <View style={styles.repeatGrid}>
            {REPEAT_OPTIONS.map((option) => {
              const isSelected = repeatSchedule === option.value;

              return (
                <Pressable
                  accessibilityHint={`Sets the repeat schedule to ${option.help}.`}
                  accessibilityLabel={`${option.label} repeat schedule`}
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setRepeatSchedule(option.value)}
                  style={[
                    styles.optionCard,
                    {
                      backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                      borderColor: isSelected ? colors.primary : colors.line,
                    },
                  ]}>
                  <Text style={[TextPresets.label, { color: isSelected ? colors.primary : colors.text }]}>{option.label}</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{option.help}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.ruleSection}>
            <View style={styles.ruleSectionHeader}>
              <View style={styles.ruleSectionCopy}>
                <Text style={[TextPresets.label, { color: colors.text }]}>Reach time</Text>
                <Text style={[TextPresets.body, { color: colors.muted }]}>
                  How long you have to reach the checkpoint after it goes live.
                </Text>
              </View>
              <StatusPill
                label={selectedGracePreset ? selectedGracePreset.label : `${gracePreviewSeconds || '--'} sec`}
                tone={selectedGracePreset?.value === 120 ? 'success' : 'default'}
              />
            </View>

            <View style={styles.gracePresetGrid}>
              {GRACE_PRESET_OPTIONS.map((option) => {
                const isSelected = !isCustomGraceExpanded && selectedGracePreset?.value === option.value;

                return (
                  <Pressable
                    accessibilityHint={`Sets the reach time to ${option.value} seconds.`}
                    accessibilityLabel={`${option.label} reach time`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={option.value}
                    onPress={() => {
                      setGracePeriodSeconds(String(option.value));
                      setIsCustomGraceExpanded(false);
                      setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
                    }}
                    style={[
                      styles.compactOptionCard,
                      {
                        backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                        borderColor: isSelected ? colors.primary : colors.line,
                      },
                    ]}>
                    <Text style={[TextPresets.label, { color: isSelected ? colors.primary : colors.text }]}>{option.label}</Text>
                    <Text style={[TextPresets.body, { color: colors.muted }]}>{option.help}</Text>
                  </Pressable>
                );
              })}

              <Pressable
                accessibilityHint="Lets you type a custom reach time in seconds."
                accessibilityLabel="Custom reach time"
                accessibilityRole="button"
                accessibilityState={{ selected: isCustomGraceExpanded }}
                onPress={() => setIsCustomGraceExpanded(true)}
                style={[
                  styles.compactOptionCard,
                  {
                    backgroundColor: isCustomGraceExpanded ? colors.primarySurface : colors.elevated,
                    borderColor: isCustomGraceExpanded ? colors.primary : colors.line,
                  },
                ]}>
                <Text style={[TextPresets.label, { color: isCustomGraceExpanded ? colors.primary : colors.text }]}>
                  Custom
                </Text>
                <Text style={[TextPresets.body, { color: colors.muted }]}>Type your own seconds</Text>
              </Pressable>
            </View>

            {isCustomGraceExpanded ? (
              <AppInput
                error={errors.gracePeriodSeconds}
                helper="Use 15 seconds or more."
                keyboardType="number-pad"
                label="Custom reach time in seconds"
                onChangeText={(nextValue) => {
                  setGracePeriodSeconds(nextValue);
                  setErrors((currentErrors) => ({ ...currentErrors, gracePeriodSeconds: undefined }));
                }}
                placeholder="120"
                value={gracePeriodSeconds}
              />
            ) : null}
          </View>
        </AppCard>
      ) : null}

      {activeStep === 3 ? (
        <AppCard elevated tone="canvas">
          <SectionHeader
            kicker="Step 3"
            title="Keep it private or share it"
            description="Sharing is optional."
            action={<StatusPill label="Optional" tone="default" />}
          />

          {!configured ? (
            <SocialInfoCard
              actionLabel="Open account"
              colors={colors}
              copy="Connect your account first if you want circle accountability."
              onPress={() => router.push('/account')}
              title="Social sync is unavailable"
            />
          ) : !user || !isProfileComplete ? (
            <SocialInfoCard
              actionLabel="Finish account"
              colors={colors}
              copy="Finish your profile before attaching this checkpoint to a circle."
              onPress={() => router.push('/account')}
              title="Profile required"
            />
          ) : isSocialOptionsLoading ? (
            <Text style={[TextPresets.body, { color: colors.muted }]}>Loading your circles...</Text>
          ) : (
            <>
              <View
                style={[
                  styles.socialSummaryCard,
                  {
                    backgroundColor: selectedCircleId ? colors.primarySurface : colors.elevated,
                    borderColor: selectedCircleId ? colors.primary : colors.line,
                  },
                ]}>
                <View style={styles.socialSummaryCopy}>
                  <View style={styles.socialSummaryHeader}>
                    <Text style={[TextPresets.label, { color: colors.text }]}>
                      {selectedCircle ? selectedCircle.name : 'Private checkpoint'}
                    </Text>
                    <StatusPill
                      label={!selectedCircleId ? 'Private' : socialShareCount > 0 ? 'Sharing on' : 'Circle linked'}
                      tone={!selectedCircleId ? 'default' : socialShareCount > 0 ? 'primary' : 'warning'}
                    />
                  </View>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    {!selectedCircleId
                      ? 'Nothing is shared unless you attach this checkpoint to a circle.'
                      : socialShareCount === 0
                        ? `This checkpoint is linked to ${selectedCircle?.name ?? 'your circle'}, but sharing is still off.`
                        : setupSummary}
                  </Text>
                </View>
              </View>

              {isSocialExpanded ? (
                <>
                  <View style={styles.selectionList}>
                    <Pressable
                      accessibilityHint="Keeps this checkpoint private and turns off social sharing."
                      accessibilityLabel="Private checkpoint option"
                      accessibilityRole="button"
                      accessibilityState={{ selected: !selectedCircleId }}
                      onPress={() => {
                        setSelectedCircleId('');
                        setShareSuccesses(false);
                        setShareMisses(false);
                      }}
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: !selectedCircleId ? colors.primarySurface : colors.elevated,
                          borderColor: !selectedCircleId ? colors.primary : colors.line,
                        },
                      ]}>
                      <Text style={[TextPresets.label, { color: !selectedCircleId ? colors.primary : colors.text }]}>
                        Private checkpoint
                      </Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>Nothing is shared.</Text>
                    </Pressable>

                    {availableCircles.map((circle) => {
                      const isSelected = selectedCircleId === circle.id;

                      return (
                        <Pressable
                          key={circle.id}
                          accessibilityHint={`Shares this checkpoint with ${circle.memberCount} ${
                            circle.memberCount === 1 ? 'member' : 'members'
                          } in ${circle.name}.`}
                          accessibilityLabel={`Circle option ${circle.name}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => setSelectedCircleId(circle.id)}
                          style={[
                            styles.optionCard,
                            {
                              backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                              borderColor: isSelected ? colors.primary : colors.line,
                            },
                          ]}>
                          <Text style={[TextPresets.label, { color: isSelected ? colors.primary : colors.text }]}>
                            {circle.name}
                          </Text>
                          <Text style={[TextPresets.body, { color: colors.muted }]}>
                            {circle.memberCount} member{circle.memberCount === 1 ? '' : 's'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {availableCircles.length === 0 ? (
                    <AppButton
                      label="Create or join a circle"
                      onPress={() => router.push('/circles')}
                      size="compact"
                      variant="secondary"
                    />
                  ) : (
                    <>
                      <View style={[styles.preferenceRow, { borderColor: colors.line }]}>
                        <View style={styles.preferenceCopy}>
                          <Text style={[TextPresets.label, { color: colors.text }]}>Share clears</Text>
                          <Text style={[TextPresets.body, { color: colors.muted }]}>
                            Let your circle see when you cleared it.
                          </Text>
                        </View>
                        <Switch
                          disabled={!selectedCircleId}
                          onValueChange={setShareSuccesses}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          value={selectedCircleId ? shareSuccesses : false}
                        />
                      </View>

                      <View style={[styles.preferenceRow, { borderColor: colors.line }]}>
                        <View style={styles.preferenceCopy}>
                          <Text style={[TextPresets.label, { color: colors.text }]}>Share misses</Text>
                          <Text style={[TextPresets.body, { color: colors.muted }]}>
                            Let your circle see when you missed it.
                          </Text>
                        </View>
                        <Switch
                          disabled={!selectedCircleId}
                          onValueChange={setShareMisses}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          value={selectedCircleId ? shareMisses : false}
                        />
                      </View>
                    </>
                  )}
                </>
              ) : null}
            </>
          )}
        </AppCard>
      ) : null}
    </AppScreen>
  );
}

function SocialInfoCard({
  title,
  copy,
  actionLabel,
  onPress,
  colors,
}: {
  title: string;
  copy: string;
  actionLabel: string;
  onPress: () => void;
  colors: ReturnType<typeof getAppColors>;
}) {
  return (
    <View style={styles.socialInfo}>
      <Text style={[TextPresets.title, { color: colors.text }]}>{title}</Text>
      <Text style={[TextPresets.body, { color: colors.muted }]}>{copy}</Text>
      <AppButton label={actionLabel} onPress={onPress} style={styles.socialAction} variant="secondary" />
    </View>
  );
}

function alertNotificationPermission() {
  Alert.alert(
    'Notification permission needed',
    'Notifications are required so the checkpoint can go live on time.'
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    gap: Spacing.sm,
  },
  summaryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  summaryCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  summaryTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  stepRail: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stepCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flex: 1,
    gap: Spacing.sm,
    minHeight: 56,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.sm + 2,
  },
  stepNumberBadge: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  stepNumber: {
    ...TextPresets.label,
    fontSize: 15,
    lineHeight: 18,
    textAlign: 'center',
  },
  stepLabel: {
    ...TextPresets.label,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  selectionList: {
    gap: Spacing.sm,
  },
  socialSummaryCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  socialSummaryCopy: {
    gap: Spacing.sm,
  },
  socialSummaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  timePanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  templateSection: {
    gap: Spacing.md,
  },
  templateSectionCopy: {
    gap: Spacing.xs,
  },
  templateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  templateCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    gap: Spacing.sm,
    minHeight: 132,
    padding: Spacing.md,
  },
  templateCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  timeCopy: {
    gap: Spacing.xs,
  },
  timeValue: {
    fontFamily: Fonts.rounded,
    fontSize: 42,
    fontWeight: '800',
    lineHeight: 46,
  },
  scanCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  inlineSection: {
    borderTopWidth: 1,
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  inlineSectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  inlineSectionCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  inlinePresetCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: 160,
    flexGrow: 1,
    gap: Spacing.xs,
    minHeight: 64,
    padding: Spacing.md,
  },
  scanHeader: {
    gap: Spacing.sm,
  },
  scanCopy: {
    gap: Spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  actionFill: {
    flexBasis: 180,
    flexGrow: 1,
  },
  scannerSection: {
    gap: Spacing.sm,
  },
  camera: {
    borderRadius: Radius.lg,
    height: 260,
    overflow: 'hidden',
    width: '100%',
  },
  repeatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  ruleSection: {
    gap: Spacing.md,
  },
  ruleSectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  ruleSectionCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  gracePresetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  compactOptionCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: 140,
    flexGrow: 1,
    gap: Spacing.xs,
    minHeight: 64,
    padding: Spacing.md,
  },
  optionCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexGrow: 1,
    gap: Spacing.xs,
    minHeight: 56,
    minWidth: 148,
    padding: Spacing.md,
  },
  preferenceRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  preferenceCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  socialInfo: {
    gap: Spacing.md,
  },
  socialAction: {
    alignSelf: 'flex-start',
  },
  bottomActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  bottomAction: {
    flexBasis: 180,
    flexGrow: 1,
  },
});
