import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  createNextAlarmDateForSchedule,
  getAlarmById,
  getAlarmDeadlineTimestamp,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  resolveAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { getCheckpointLiveCopy } from '@/lib/checkpoint-templates';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { useAppDialog } from '@/providers/app-dialog-provider';
import { Alarm } from '@/types/alarm';

type CountdownTone = 'primary' | 'warning' | 'danger';

type CameraBarcodeTypes = NonNullable<
  NonNullable<ComponentProps<typeof CameraView>['barcodeScannerSettings']>['barcodeTypes']
>;

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
const PRACTICE_TO_FIRST_REMINDER_BUFFER_MS = 15 * 60 * 1000;
const TIMER_RING_SIZE = 252;
const TIMER_RING_SEGMENT_COUNT = 72;
const TIMER_RING_SEGMENT_RADIUS = 122;
const TIMER_BURST_PARTICLE_ANGLES = Array.from({ length: 10 }, (_, index) => (index * 360) / 10);

async function scheduleNextRecurringAlarm(alarm: Alarm) {
  const now = new Date();
  const normalNextDate = createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule, now);
  const nextDate = alarm.isPracticeRun
    ? createNextAlarmDateForSchedule(
        alarm.hour,
        alarm.minute,
        alarm.repeatSchedule,
        new Date(now.getTime() + PRACTICE_TO_FIRST_REMINDER_BUFFER_MS)
      )
    : normalNextDate;
  const nextScheduled = await scheduleAlarmNotificationAsync(alarm, {
    scheduledFor: nextDate.toISOString(),
  });

  try {
    await updateAlarm({
      ...alarm,
      isPracticeRun: undefined,
      isActive: true,
      notificationIds: nextScheduled.notificationIds,
      notificationRegistrations: nextScheduled.notificationRegistrations,
      scheduledFor: nextScheduled.scheduledFor,
      notificationStrategyKey: nextScheduled.strategyKey,
    });
  } catch (error) {
    await cancelAlarmNotificationAsync(nextScheduled.notificationIds).catch(() => null);
    throw error;
  }

  return {
    deferredAfterPractice: alarm.isPracticeRun === true && nextDate.getTime() !== normalNextDate.getTime(),
    scheduledFor: nextScheduled.scheduledFor,
  };
}

function getCriticalThreshold(gracePeriodSeconds: number) {
  return Math.min(15, Math.ceil(gracePeriodSeconds * 0.2));
}

function getCountdownTone(remainingSeconds: number | null, gracePeriodSeconds: number): CountdownTone {
  if (remainingSeconds === null) {
    return 'warning';
  }

  if (remainingSeconds <= getCriticalThreshold(gracePeriodSeconds)) {
    return 'danger';
  }

  if (remainingSeconds <= Math.ceil(gracePeriodSeconds * 0.5)) {
    return 'warning';
  }

  return 'primary';
}

function formatRemainingClock(seconds: number | null, fallbackSeconds: number) {
  const safeSeconds = Math.max(0, seconds ?? fallbackSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainderSeconds = safeSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${remainderSeconds.toString().padStart(2, '0')}`;
}

function CircularTimerRing({
  activeColor,
  progress,
  trackColor,
}: {
  activeColor: string;
  progress: number;
  trackColor: string;
}) {
  const activeSegmentCount = Math.ceil(TIMER_RING_SEGMENT_COUNT * progress);
  const center = TIMER_RING_SIZE / 2;

  return (
    <View style={styles.circularTimerRing}>
      {Array.from({ length: TIMER_RING_SEGMENT_COUNT }).map((_, index) => {
        const angle = -90 + (index * 360) / TIMER_RING_SEGMENT_COUNT;
        const radians = (angle * Math.PI) / 180;

        return (
          <View
            key={index}
            style={[
              styles.timerRingSegment,
              {
                backgroundColor: index < activeSegmentCount ? activeColor : trackColor,
                left: center + Math.cos(radians) * TIMER_RING_SEGMENT_RADIUS - 1,
                top: center + Math.sin(radians) * TIMER_RING_SEGMENT_RADIUS - 4,
                transform: [{ rotate: `${angle + 90}deg` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function TimerTapBurst({
  accentColor,
  progress,
  secondaryColor,
}: {
  accentColor: string;
  progress: Animated.Value;
  secondaryColor: string;
}) {
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.72, 1],
    outputRange: [0, 1, 0.8, 0],
  });
  const ringScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.68, 1.32],
  });

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.timerBurstRing,
          {
            borderColor: accentColor,
            opacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      {TIMER_BURST_PARTICLE_ANGLES.map((angle, index) => {
        const radians = (angle * Math.PI) / 180;
        const distance = 158 + (index % 2) * 12;

        return (
          <Animated.View
            key={angle}
            pointerEvents="none"
            style={[
              styles.timerBurstParticle,
              {
                backgroundColor: index % 3 === 0 ? secondaryColor : accentColor,
                opacity,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, Math.cos(radians) * distance],
                    }),
                  },
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, Math.sin(radians) * distance],
                    }),
                  },
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 0.25, 1],
                      outputRange: [0.3, 1.2, 0.5],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </>
  );
}

async function triggerHaptic(kind: 'warning' | 'error' | 'success') {
  try {
    if (kind === 'success') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }

    if (kind === 'error') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Haptics are best-effort only.
  }
}

export default function RingingScreen() {
  const router = useRouter();
  const { alert } = useAppDialog();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);
  const isDark = colorScheme === 'dark';
  const urgentBackground = colors.canvas;
  const urgentPanel = colors.panel;
  const urgentText = colors.text;
  const urgentTextSoft = colors.textSoft;
  const checkpointAccent = colors.accent;
  const actionForeground = isDark ? '#17191C' : colors.elevated;
  const actionGradient = isDark ? (['#FAF9F5', '#DDE2E4'] as const) : (['#272B30', '#111315'] as const);
  const backdropGradient = isDark
    ? ([colors.canvas, '#151A1F', colors.background] as const)
    : ([colors.canvas, colors.background, colors.cardMuted] as const);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanEnabled, setScanEnabled] = useState(true);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [isTorchEnabled, setIsTorchEnabled] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const hasResolvedRef = useRef(false);
  const hasRequestedPermissionRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScannedPayloadRef = useRef<{ payload: string; scannedAt: number } | null>(null);
  const validScanInFlightRef = useRef(false);
  const criticalHapticFiredRef = useRef(false);
  const glowPulse = useRef(new Animated.Value(0)).current;
  const framePulse = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1)).current;
  const timerPlayScale = useRef(new Animated.Value(1)).current;
  const timerPlayRotation = useRef(new Animated.Value(0)).current;
  const timerPlayBursts = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;
  const errorFlash = useRef(new Animated.Value(0)).current;
  const criticalGlowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const timerPlayAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const timerBurstAnimationsRef = useRef<(Animated.CompositeAnimation | null)[]>(
    Array.from({ length: 4 }, () => null)
  );
  const timerBurstIndexRef = useRef(0);
  const timerPlayDirectionRef = useRef(1);

  useEffect(() => {
    const loadAlarm = async () => {
      if (!params.alarmId) {
        setAlarm(null);
        return;
      }

      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const foundAlarm = await getAlarmById(params.alarmId);
      setAlarm(foundAlarm);
    };

    void loadAlarm();
  }, [params.alarmId]);

  useEffect(() => {
    const frameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(framePulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(framePulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    frameLoop.start();

    return () => {
      frameLoop.stop();
    };
  }, [framePulse]);

  useEffect(() => {
    const timerBurstAnimations = timerBurstAnimationsRef.current;

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      criticalGlowLoopRef.current?.stop();
      timerPlayAnimationRef.current?.stop();
      timerBurstAnimations.forEach((animation) => animation?.stop());
    };
  }, []);

  useEffect(() => {
    hasResolvedRef.current = false;
    hasRequestedPermissionRef.current = false;
    criticalHapticFiredRef.current = false;
    lastScannedPayloadRef.current = null;
    validScanInFlightRef.current = false;
    setScanEnabled(true);
    setScanError('');
    setIsScannerVisible(false);
    setIsTorchEnabled(false);
  }, [alarm?.id]);

  const deadline = useMemo(() => {
    if (!alarm) {
      return null;
    }

    return getAlarmDeadlineTimestamp(alarm);
  }, [alarm]);
  const liveCopy = useMemo(
    () => getCheckpointLiveCopy(alarm?.useCaseType ?? 'custom', alarm?.label ?? ''),
    [alarm?.label, alarm?.useCaseType]
  );
  const placeObjectLabel = alarm?.placeObject?.trim() || alarm?.label || 'the saved place or object';

  useEffect(() => {
    if (!deadline) {
      return;
    }

    const updateRemainingSeconds = () => {
      const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
    };

    updateRemainingSeconds();

    const interval = setInterval(updateRemainingSeconds, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  useEffect(() => {
    if (
      !alarm ||
      !isScannerVisible ||
      !permission ||
      permission.granted ||
      permission.canAskAgain === false ||
      hasRequestedPermissionRef.current
    ) {
      return;
    }

    hasRequestedPermissionRef.current = true;
    void requestPermission();
  }, [alarm, isScannerVisible, permission, requestPermission]);

  useEffect(() => {
    if (permission?.granted) {
      setScanEnabled(true);
      setScanError('');
    }
  }, [permission?.granted]);

  const handleScanSuccess = useCallback(async () => {
    if (!alarm || isSubmitting || hasResolvedRef.current) {
      return;
    }

    hasResolvedRef.current = true;
    setIsSubmitting(true);
    setScanError('');
    await triggerHaptic('success');

    try {
      if (alarm.repeatSchedule === 'once') {
        await cancelAlarmNotificationAsync(alarm.notificationIds);
      }
      const resolvedAlarm = await resolveAlarm(alarm.id, 'confirmed', {
        scheduledFor: alarm.scheduledFor,
        capturedAt: new Date().toISOString(),
      });
      let practiceDeferredUntil: string | undefined;

      if (!resolvedAlarm) {
        router.replace({
          pathname: '/missed',
          params: {
            alarmId: alarm.id,
          },
        });
        return;
      }

      const store = await readAlarmStore();
      const successEntry = store.successHistory.find((entry) => entry.alarmId === alarm.id) ?? null;
      const isFirstClear = store.successHistory.length === 1;
      await trackAnalyticsEvent('checkpoint_cleared', {
        checkpointId: alarm.id,
        useCaseType: alarm.useCaseType,
        repeatSchedule: alarm.repeatSchedule,
        gracePeriodSeconds: alarm.gracePeriodSeconds,
        timeToClearSeconds: successEntry?.timeToScanSeconds,
      });

      if (isFirstClear) {
        await trackAnalyticsEvent('demo_checkpoint_cleared', {
          checkpointId: alarm.id,
          useCaseType: alarm.useCaseType,
          timeToClearSeconds: successEntry?.timeToScanSeconds,
        });
      }

      if (
        alarm.repeatSchedule !== 'once' &&
        resolvedAlarm &&
        (resolvedAlarm.isPracticeRun || !alarm.notificationRegistrations?.length)
      ) {
        const nextRun = await scheduleNextRecurringAlarm(resolvedAlarm).catch(async (error: unknown) => {
          await alert({
            description: error instanceof Error
              ? `This clear was saved, but the next reminder was not scheduled. ${error.message}`
              : 'This clear was saved, but the next reminder could not be scheduled.',
            icon: 'notifications-off-outline',
            title: 'Next checkpoint paused',
            tone: 'warning',
          });
          return null;
        });

        if (nextRun?.deferredAfterPractice) {
          practiceDeferredUntil = nextRun.scheduledFor;
        }
      }

      router.replace({
        pathname: '/success',
        params: {
          alarmId: alarm.id,
          label: alarm.label,
          ...(practiceDeferredUntil ? { practiceDeferredUntil } : {}),
        },
      });
    } catch (error) {
      hasResolvedRef.current = false;
      validScanInFlightRef.current = false;
      setScanEnabled(true);

      const errorMessage =
        error instanceof Error ? error.message : 'The checkpoint could not be confirmed.';

      await alert({
        description: errorMessage,
        icon: 'alert-circle-outline',
        title: 'Unable to confirm checkpoint',
        tone: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, alert, isSubmitting, router]);

  const handleMissedAlarm = useCallback(async () => {
    if (!alarm || isSubmitting || hasResolvedRef.current) {
      return;
    }

    hasResolvedRef.current = true;
    setIsSubmitting(true);

    try {
      if (alarm.repeatSchedule === 'once') {
        await cancelAlarmNotificationAsync(alarm.notificationIds);
      }
      const resolvedAlarm = await resolveAlarm(alarm.id, 'missed', {
        scheduledFor: alarm.scheduledFor,
        capturedAt: new Date().toISOString(),
      });
      const store = await readAlarmStore();
      await trackAnalyticsEvent('checkpoint_missed', {
        checkpointId: alarm.id,
        useCaseType: alarm.useCaseType,
        repeatSchedule: alarm.repeatSchedule,
        gracePeriodSeconds: alarm.gracePeriodSeconds,
        failureCount: store.failureHistory.length,
      });

      if (store.failureHistory.length === 1) {
        await trackAnalyticsEvent('first_miss', {
          checkpointId: alarm.id,
          useCaseType: alarm.useCaseType,
          repeatSchedule: alarm.repeatSchedule,
          gracePeriodSeconds: alarm.gracePeriodSeconds,
        });
      }

      if (
        alarm.repeatSchedule !== 'once' &&
        resolvedAlarm &&
        (resolvedAlarm.isPracticeRun || !alarm.notificationRegistrations?.length)
      ) {
        await scheduleNextRecurringAlarm(resolvedAlarm).catch(async (error: unknown) => {
          await alert({
            description: error instanceof Error
              ? `This miss was saved, but the next reminder was not scheduled. ${error.message}`
              : 'This miss was saved, but the next reminder could not be scheduled.',
            icon: 'notifications-off-outline',
            title: 'Next checkpoint paused',
            tone: 'warning',
          });
        });
      }

      router.replace({
        pathname: '/missed',
        params: {
          alarmId: alarm.id,
        },
      });
    } catch (error) {
      hasResolvedRef.current = false;

      const errorMessage =
        error instanceof Error ? error.message : 'The missed checkpoint could not be recorded.';

      await alert({
        description: errorMessage,
        icon: 'alert-circle-outline',
        title: 'Unable to record missed checkpoint',
        tone: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, alert, isSubmitting, router]);

  const handleStartScanner = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    setIsScannerVisible(true);
    setScanError('');
    lastScannedPayloadRef.current = null;

    if (permission?.granted) {
      setScanEnabled(true);
      return;
    }

    if (permission?.canAskAgain === false) {
      setScanEnabled(false);
      await Linking.openSettings().catch(() => null);
      return;
    }

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScanEnabled(false);
        setScanError('Camera access is required so you can scan the checkpoint and clear the live run.');
        return;
      }
    }

    setScanEnabled(true);
  }, [isSubmitting, permission?.canAskAgain, permission?.granted, requestPermission]);

  const handleRetryScan = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    setScanError('');
    lastScannedPayloadRef.current = null;
    setIsScannerVisible(true);
    setScanEnabled(true);
  }, []);

  const handleToggleTorch = useCallback(() => {
    setIsTorchEnabled((currentValue) => !currentValue);
  }, []);

  const handleTimerPlay = useCallback(() => {
    timerPlayAnimationRef.current?.stop();
    timerPlayDirectionRef.current *= -1;
    const rotationDirection = timerPlayDirectionRef.current;
    const burstIndex = timerBurstIndexRef.current;
    const burstValue = timerPlayBursts[burstIndex];
    timerBurstIndexRef.current = (burstIndex + 1) % timerPlayBursts.length;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);

    const animation = Animated.parallel([
      Animated.sequence([
        Animated.spring(timerPlayScale, {
          toValue: 1.1,
          friction: 5,
          tension: 240,
          useNativeDriver: true,
        }),
        Animated.spring(timerPlayScale, {
          toValue: 1,
          friction: 5,
          tension: 150,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.spring(timerPlayRotation, {
          toValue: rotationDirection,
          friction: 5,
          tension: 220,
          useNativeDriver: true,
        }),
        Animated.spring(timerPlayRotation, {
          toValue: 0,
          friction: 5,
          tension: 130,
          useNativeDriver: true,
        }),
      ]),
    ]);
    timerBurstAnimationsRef.current[burstIndex]?.stop();
    burstValue.setValue(0);
    const burstAnimation = Animated.timing(burstValue, {
      toValue: 1,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    timerPlayAnimationRef.current = animation;
    timerBurstAnimationsRef.current[burstIndex] = burstAnimation;
    animation.start(({ finished }) => {
      if (finished && timerPlayAnimationRef.current === animation) {
        timerPlayAnimationRef.current = null;
      }
    });
    burstAnimation.start(({ finished }) => {
      if (finished && timerBurstAnimationsRef.current[burstIndex] === burstAnimation) {
        burstValue.setValue(0);
        timerBurstAnimationsRef.current[burstIndex] = null;
      }
    });
  }, [timerPlayBursts, timerPlayRotation, timerPlayScale]);

  const handleBarcodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (!alarm || !scanEnabled || isSubmitting || hasResolvedRef.current) {
        return;
      }

      const scannedAt = Date.now();
      const previousScan = lastScannedPayloadRef.current;

      if (previousScan && previousScan.payload === data && scannedAt - previousScan.scannedAt < SCAN_DEDUPE_WINDOW_MS) {
        lastScannedPayloadRef.current = { ...previousScan, scannedAt };
        return;
      }

      lastScannedPayloadRef.current = { payload: data, scannedAt };
      setScanEnabled(false);

      if (data !== alarm.expectedQrPayload) {
        setScanError(liveCopy.wrongCodeDescription);
        await triggerHaptic('error');

        Animated.sequence([
          Animated.timing(errorFlash, {
            toValue: 1,
            duration: 110,
            useNativeDriver: true,
          }),
          Animated.timing(errorFlash, {
            toValue: 0,
            duration: 240,
            useNativeDriver: true,
          }),
        ]).start();

        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        retryTimeoutRef.current = null;

        return;
      }

      validScanInFlightRef.current = true;
      await handleScanSuccess();
    },
    [alarm, errorFlash, handleScanSuccess, isSubmitting, liveCopy.wrongCodeDescription, scanEnabled]
  );

  useEffect(() => {
    if (alarm && remainingSeconds === 0 && !isSubmitting && !validScanInFlightRef.current) {
      void handleMissedAlarm();
    }
  }, [alarm, handleMissedAlarm, isSubmitting, remainingSeconds]);

  const gracePeriodSeconds = alarm?.gracePeriodSeconds ?? 60;
  const countdownTone = getCountdownTone(remainingSeconds, gracePeriodSeconds);
  const countdownProgressRatio = Math.max(
    0,
    Math.min(1, (remainingSeconds ?? gracePeriodSeconds) / gracePeriodSeconds)
  );
  const scannerFrameBorderColor = scanError.length > 0 ? colors.danger : '#F8FAFC';
  const isCameraReady = permission?.granted === true;
  const cameraStatusLabel = !isCameraReady ? 'Camera needed' : scanEnabled ? 'Ready to scan' : 'Reading';
  const permissionMessage =
    permission?.canAskAgain === false
      ? `${liveCopy.permissionDescription} Turn it on in Settings to continue.`
      : liveCopy.permissionDescription;

  useEffect(() => {
    if (!alarm) {
      return;
    }

    Animated.sequence([
      Animated.timing(countdownScale, {
        toValue: countdownTone === 'danger' ? 1.08 : 1.04,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(countdownScale, {
        toValue: 1,
        friction: 5,
        tension: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [alarm, countdownScale, countdownTone, remainingSeconds]);

  useEffect(() => {
    criticalGlowLoopRef.current?.stop();

    if (!alarm || countdownTone !== 'danger' || remainingSeconds === 0) {
      glowPulse.stopAnimation();
      glowPulse.setValue(0);
      return;
    }

    criticalGlowLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    criticalGlowLoopRef.current.start();

    return () => {
      criticalGlowLoopRef.current?.stop();
    };
  }, [alarm, countdownTone, glowPulse, remainingSeconds]);

  useEffect(() => {
    if (!alarm) {
      return;
    }

    if (
      countdownTone === 'danger' &&
      remainingSeconds !== null &&
      remainingSeconds > 0 &&
      !criticalHapticFiredRef.current
    ) {
      criticalHapticFiredRef.current = true;
      void triggerHaptic('warning');
    }

    if (countdownTone !== 'danger') {
      criticalHapticFiredRef.current = false;
    }
  }, [alarm, countdownTone, remainingSeconds]);

  const frameScale = framePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1.015],
  });
  const frameOpacity = framePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.62, 1],
  });
  const timerPlayRotate = timerPlayRotation.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-4deg', '0deg', '4deg'],
  });
  const timerRingScale = Animated.multiply(Animated.multiply(frameScale, countdownScale), timerPlayScale);

  if (!alarm) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
        <View style={styles.emptyWrap}>
          <AppCard elevated style={styles.emptyCard}>
            <Text style={[TextPresets.title, { color: colors.text }]}>Checkpoint not found</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              This checkpoint may have been deleted or already resolved.
            </Text>
            <AppButton label="Back to checkpoints" onPress={() => router.replace('/alarms')} />
          </AppCard>
        </View>
      </SafeAreaView>
    );
  }

  if (!isScannerVisible) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: urgentBackground }]}>
        <StatusBar animated style={isDark ? 'light' : 'dark'} />
        <View style={styles.activeScreen}>
          <LinearGradient colors={backdropGradient} style={StyleSheet.absoluteFillObject} />
          <View
            pointerEvents="none"
            style={[styles.ambientGlow, { backgroundColor: withAlpha(checkpointAccent, isDark ? '16' : '12') }]}
          />
          <View style={styles.activeContent}>
            <View style={styles.activeHeader}>
              <View style={[styles.livePill, { borderColor: colors.border, backgroundColor: withAlpha(colors.panel, 'D9') }]}>
                <View style={[styles.liveDot, { backgroundColor: checkpointAccent }]} />
                <Text style={[styles.livePillText, { color: urgentText }]}>CHECKPOINT LIVE</Text>
              </View>
              <View style={styles.windowPill}>
                <Ionicons color={urgentTextSoft} name="timer-outline" size={14} />
                <Text style={[styles.windowPillText, { color: urgentTextSoft }]}>
                  {Math.ceil(gracePeriodSeconds / 60)} MIN WINDOW
                </Text>
              </View>
            </View>

            <View style={styles.activeHeroCopy}>
              <Text style={[styles.activeEyebrow, { color: checkpointAccent }]}>TIME TO CHECK IN</Text>
              <Text style={[styles.activeTitle, { color: urgentText }]}>{alarm.label}</Text>
              <Text style={[styles.activeDescription, { color: urgentTextSoft }]}>
                Go to the checkpoint and scan its saved code before time runs out.
              </Text>
            </View>

            <Pressable
              accessibilityHint="Plays a celebration animation"
              accessibilityLabel="Animate countdown"
              accessibilityRole="button"
              onPress={handleTimerPlay}
              style={styles.timerPressable}>
              <View style={styles.timerStage}>
                {timerPlayBursts.map((burst, index) => (
                  <TimerTapBurst
                    key={index}
                    accentColor={checkpointAccent}
                    progress={burst}
                    secondaryColor={urgentText}
                  />
                ))}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.timerAura,
                    {
                      opacity: frameOpacity,
                      transform: [{ scale: timerRingScale }, { rotate: timerPlayRotate }],
                    },
                  ]}>
                  <CircularTimerRing
                    activeColor={countdownTone === 'danger' ? colors.danger : checkpointAccent}
                    progress={countdownProgressRatio}
                    trackColor={colors.border}
                  />
                </Animated.View>
                <View style={styles.timerOrb}>
                  <LinearGradient
                    colors={isDark ? (['#20262C', '#12161A'] as const) : ([colors.elevated, colors.cardMuted] as const)}
                    style={[styles.timerOrbInner, { borderColor: colors.border }]}>
                    <Text style={[styles.timerLabel, { color: urgentTextSoft }]}>TIME REMAINING</Text>
                    <Animated.Text
                      accessibilityLabel={`${remainingSeconds ?? alarm.gracePeriodSeconds} seconds left`}
                      accessibilityLiveRegion="assertive"
                      style={[
                        styles.activeTime,
                        {
                          color: countdownTone === 'danger' ? colors.danger : urgentText,
                        },
                      ]}>
                      {formatRemainingClock(remainingSeconds, alarm.gracePeriodSeconds)}
                    </Animated.Text>
                  </LinearGradient>
                </View>
              </View>
            </Pressable>

            <View style={styles.activeActions}>
              <Pressable
                accessibilityLabel="Scan proof code"
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => {
                  void handleStartScanner();
                }}
                style={({ pressed }) => [
                  styles.activePrimaryButton,
                  { opacity: isSubmitting ? 0.55 : 1 },
                  pressed && styles.pressed,
                ]}>
                <LinearGradient colors={actionGradient} style={StyleSheet.absoluteFillObject} />
                <View style={styles.scanButtonIcon}>
                  <Ionicons color={actionForeground} name="scan-outline" size={22} />
                </View>
                <Text style={[styles.activePrimaryButtonText, { color: actionForeground }]}>Scan proof code</Text>
              </Pressable>

              <View style={styles.activeLockRow}>
                <Ionicons color={urgentTextSoft} name="lock-closed-outline" size={13} />
                <Text style={[styles.activeLockText, { color: urgentTextSoft }]}>
                  Only the linked code can clear this checkpoint
                </Text>
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: urgentBackground }]}>
      <StatusBar animated style="light" />
      <View style={styles.scannerScreen}>
        {isCameraReady ? (
          <CameraView
            barcodeScannerSettings={{
              barcodeTypes: PROOF_CODE_BARCODE_TYPES,
            }}
            enableTorch={isTorchEnabled}
            onBarcodeScanned={scanEnabled ? handleBarcodeScanned : undefined}
            style={styles.camera}
          />
        ) : (
          <View style={[styles.permissionState, { backgroundColor: urgentPanel }]}>
            <Text style={[styles.permissionTitle, { color: urgentText }]}>{liveCopy.permissionTitle}</Text>
            <Text style={[styles.permissionDescription, { color: urgentTextSoft }]}>{permissionMessage}</Text>
            <AppButton
              disabled={isSubmitting}
              label={permission?.canAskAgain === false ? 'Open settings' : 'Allow camera'}
              onPress={() => {
                void handleStartScanner();
              }}
              textStyle={styles.primaryButtonText}
            />
          </View>
        )}

        <View style={styles.scannerTopBar}>
          <Pressable
            accessibilityLabel="Close scanner"
            accessibilityRole="button"
            onPress={() => {
              setIsScannerVisible(false);
              setScanError('');
              setScanEnabled(true);
            }}
            style={({ pressed }) => [styles.scannerIconButton, pressed && styles.pressed]}>
            <Ionicons color="#F7FAFC" name="close" size={26} />
          </Pressable>
          <View style={styles.scannerTitleWrap}>
            <Text style={styles.scannerTitle}>Scan proof code</Text>
            <Text style={styles.scannerSubtitle}>{cameraStatusLabel}</Text>
          </View>
          <Pressable
            accessibilityLabel={isTorchEnabled ? 'Turn flash off' : 'Turn flash on'}
            accessibilityRole="button"
            accessibilityState={{ selected: isTorchEnabled }}
            disabled={!isCameraReady}
            onPress={handleToggleTorch}
            style={({ pressed }) => [styles.scannerIconButton, !isCameraReady && styles.disabledIcon, pressed && styles.pressed]}>
            <Ionicons color={isTorchEnabled ? colors.primary : '#F7FAFC'} name={isTorchEnabled ? 'flash' : 'flash-outline'} size={22} />
          </Pressable>
        </View>

        {isCameraReady ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flowScannerFrame,
              {
                opacity: frameOpacity,
                transform: [{ scale: frameScale }],
              },
            ]}>
            <View style={[styles.flowFrameCorner, styles.flowFrameCornerTopLeft, { borderColor: scannerFrameBorderColor }]} />
            <View style={[styles.flowFrameCorner, styles.flowFrameCornerTopRight, { borderColor: scannerFrameBorderColor }]} />
            <View style={[styles.flowFrameCorner, styles.flowFrameCornerBottomLeft, { borderColor: scannerFrameBorderColor }]} />
            <View style={[styles.flowFrameCorner, styles.flowFrameCornerBottomRight, { borderColor: scannerFrameBorderColor }]} />
          </Animated.View>
        ) : null}

        {scanError ? (
          <View style={[styles.wrongCodeSheet, { borderColor: withAlpha(colors.danger, '2E') }]}>
            <View style={styles.wrongCodeHeader}>
              <View style={[styles.wrongCodeIcon, { backgroundColor: colors.danger }]}>
                <Text style={styles.wrongCodeIconText}>!</Text>
              </View>
              <View style={styles.wrongCodeCopy}>
                <Text style={[styles.wrongCodeTitle, { color: '#8E2424' }]}>Wrong code</Text>
                <Text style={[styles.wrongCodeBody, { color: '#6E4242' }]}>
                  This code does not match the required checkpoint.
                </Text>
              </View>
            </View>

            <View style={[styles.requiredCard, { borderColor: '#F0D9D6', backgroundColor: '#FFF8F5' }]}>
              <View style={styles.requiredLeading}>
                <Ionicons color="#8E706B" name="location-outline" size={20} />
              </View>
              <View style={styles.requiredCopy}>
                <Text style={[styles.requiredLabel, { color: '#8E706B' }]}>Required:</Text>
                <Text numberOfLines={1} style={[styles.requiredValue, { color: '#2D2321' }]}>
                  {placeObjectLabel}
                </Text>
                <Text style={[styles.requiredHint, { color: '#8E706B' }]}>Please use the linked object for this checkpoint.</Text>
              </View>
              <Ionicons color="#B89991" name="chevron-forward" size={17} />
            </View>

            <Pressable
              accessibilityLabel="Try scanning again"
              accessibilityRole="button"
              onPress={handleRetryScan}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Ionicons color="#F7FAFC" name="refresh" size={21} />
            </Pressable>
          </View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.errorOverlay,
            {
              backgroundColor: colors.danger,
              opacity: errorFlash,
            },
          ]}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  activeScreen: {
    backgroundColor: 'transparent',
    flex: 1,
    overflow: 'hidden',
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    position: 'relative',
  },
  ambientGlow: {
    borderRadius: 260,
    height: 420,
    left: 26,
    position: 'absolute',
    top: 185,
    transform: [{ scaleX: 1.28 }],
    width: 420,
  },
  activeContent: {
    flex: 1,
    gap: 12,
    width: '100%',
  },
  activeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 38,
  },
  livePill: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  liveDot: {
    borderRadius: Radius.pill,
    height: 7,
    width: 7,
  },
  livePillText: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    lineHeight: 13,
  },
  windowPill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  windowPillText: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    lineHeight: 13,
  },
  activeHeroCopy: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingTop: 2,
  },
  activeEyebrow: {
    fontFamily: Fonts.rounded,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    lineHeight: 15,
  },
  activeTitle: {
    fontFamily: Fonts.serif,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.9,
    lineHeight: 42,
    textAlign: 'center',
  },
  activeTime: {
    fontFamily: Fonts.rounded,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 58,
    textAlign: 'center',
  },
  activeDescription: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 300,
    textAlign: 'center',
  },
  timerPressable: {
    alignItems: 'center',
  },
  timerStage: {
    alignItems: 'center',
    height: 270,
    justifyContent: 'center',
    position: 'relative',
  },
  timerBurstRing: {
    borderRadius: TIMER_RING_SIZE / 2,
    borderWidth: 2,
    height: TIMER_RING_SIZE,
    position: 'absolute',
    top: 9,
    width: TIMER_RING_SIZE,
  },
  timerBurstParticle: {
    borderRadius: Radius.pill,
    height: 8,
    left: '50%',
    marginLeft: -4,
    marginTop: -4,
    position: 'absolute',
    top: '50%',
    width: 8,
  },
  timerAura: {
    height: 252,
    position: 'absolute',
    top: 9,
    width: 252,
  },
  circularTimerRing: {
    height: TIMER_RING_SIZE,
    position: 'relative',
    width: TIMER_RING_SIZE,
  },
  timerRingSegment: {
    borderRadius: Radius.pill,
    height: 8,
    position: 'absolute',
    width: 2,
  },
  timerOrb: {
    borderRadius: 116,
    height: 226,
    overflow: 'hidden',
    width: 226,
  },
  timerOrbInner: {
    alignItems: 'center',
    borderRadius: 116,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  timerLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.25,
    lineHeight: 14,
  },
  timerTrack: {
    borderRadius: Radius.pill,
    height: 4,
    marginTop: 14,
    overflow: 'hidden',
    width: 174,
  },
  timerProgress: {
    borderRadius: Radius.pill,
    height: '100%',
  },
  destinationCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 90,
    paddingHorizontal: 18,
    paddingVertical: 14,
    width: '100%',
  },
  destinationCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  destinationEyebrow: {
    fontFamily: Fonts.rounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    lineHeight: 13,
  },
  destinationTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  destinationBody: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  activeActions: {
    gap: 11,
    marginTop: 'auto',
    width: '100%',
  },
  activePrimaryButton: {
    alignItems: 'center',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 72,
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  activePrimaryButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
  scanButtonIcon: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  activeLockRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  activeLockText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  scannerScreen: {
    backgroundColor: '#0D1726',
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  scannerTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: Spacing.lg,
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.md,
  },
  scannerIconButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  disabledIcon: {
    opacity: 0.35,
  },
  scannerTitleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  scannerTitle: {
    color: '#F7FAFC',
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
  },
  scannerSubtitle: {
    color: '#C6CED8',
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    textAlign: 'center',
  },
  flowScannerFrame: {
    bottom: 228,
    left: 40,
    position: 'absolute',
    right: 40,
    top: 150,
  },
  flowFrameCorner: {
    borderRadius: Radius.sm,
    borderWidth: 4,
    height: 48,
    position: 'absolute',
    width: 48,
  },
  flowFrameCornerTopLeft: {
    borderBottomWidth: 0,
    borderRightWidth: 0,
    left: 0,
    top: 0,
  },
  flowFrameCornerTopRight: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    right: 0,
    top: 0,
  },
  flowFrameCornerBottomLeft: {
    borderRightWidth: 0,
    borderTopWidth: 0,
    bottom: 0,
    left: 0,
  },
  flowFrameCornerBottomRight: {
    borderLeftWidth: 0,
    borderTopWidth: 0,
    bottom: 0,
    right: 0,
  },
  wrongCodeSheet: {
    backgroundColor: '#FFF0EF',
    borderRadius: 24,
    borderWidth: 1,
    bottom: Spacing.lg,
    gap: Spacing.md,
    left: Spacing.lg,
    padding: Spacing.lg,
    position: 'absolute',
    right: Spacing.lg,
  },
  wrongCodeHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  wrongCodeIcon: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 34,
    justifyContent: 'center',
    marginTop: 1,
    width: 34,
  },
  wrongCodeIconText: {
    color: '#FFFFFF',
    fontFamily: Fonts.rounded,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 24,
  },
  wrongCodeCopy: {
    flex: 1,
    gap: 2,
  },
  wrongCodeTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 23,
  },
  wrongCodeBody: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  requiredCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  requiredLeading: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  requiredCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  requiredHint: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#0C1420',
    borderRadius: 14,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  screenShell: {
    flex: 1,
    overflow: 'hidden',
    padding: Spacing.lg,
    position: 'relative',
  },
  screen: {
    flex: 1,
  },
  backdropOrb: {
    borderRadius: 180,
    height: 220,
    opacity: 0.13,
    position: 'absolute',
    width: 220,
  },
  backdropTop: {
    right: -40,
    top: 40,
  },
  backdropBottom: {
    bottom: 110,
    left: -50,
  },
  criticalGlow: {
    alignSelf: 'center',
    borderRadius: 280,
    height: 280,
    position: 'absolute',
    top: 150,
    width: 280,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyCard: {
    gap: Spacing.md,
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  subtleTime: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  stageCard: {
    flex: 1,
    overflow: 'hidden',
  },
  stageContent: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  stageTopShade: {
    backgroundColor: '#05070AC2',
    height: 240,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cameraFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B0D10',
  },
  stageTopOverlay: {
    gap: Spacing.md,
    left: Spacing.lg,
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.lg,
  },
  stageMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  stageMetaGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: Spacing.sm,
  },
  stageControlGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: Spacing.sm,
  },
  torchButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  torchLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  stageTopCopy: {
    gap: 2,
  },
  liveTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  stageInstruction: {
    ...TextPresets.body,
    fontSize: 15,
    lineHeight: 22,
  },
  focusCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  focusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  focusWindow: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  focusTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  focusBody: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  focusNote: {
    ...TextPresets.body,
    borderTopColor: '#FFFFFF1A',
    borderTopWidth: 1,
    fontSize: 13,
    lineHeight: 19,
    paddingTop: Spacing.xs,
  },
  permissionState: {
    alignItems: 'flex-start',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  permissionTitle: {
    ...TextPresets.title,
  },
  permissionDescription: {
    ...TextPresets.body,
    maxWidth: 320,
  },
  countdownValue: {
    fontFamily: Fonts.rounded,
    fontSize: 68,
    fontWeight: '800',
    letterSpacing: -1.4,
    lineHeight: 72,
    textShadowColor: '#05070ACC',
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 18,
  },
  countdownOverlay: {
    bottom: Spacing.lg,
    gap: Spacing.md,
    left: Spacing.lg,
    position: 'absolute',
    right: Spacing.lg,
  },
  countdownLabel: {
    ...TextPresets.eyebrow,
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scannerFrame: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 2,
    bottom: 168,
    justifyContent: 'flex-end',
    left: 28,
    position: 'absolute',
    right: 28,
    top: 244,
  },
  frameCorner: {
    borderRadius: Radius.sm,
    borderWidth: 4,
    height: 32,
    position: 'absolute',
    width: 32,
  },
  frameCornerTopLeft: {
    borderBottomWidth: 0,
    borderRightWidth: 0,
    left: 14,
    top: 14,
  },
  frameCornerTopRight: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    right: 14,
    top: 14,
  },
  frameCornerBottomLeft: {
    borderRightWidth: 0,
    borderTopWidth: 0,
    bottom: 14,
    left: 14,
  },
  frameCornerBottomRight: {
    borderLeftWidth: 0,
    borderTopWidth: 0,
    bottom: 14,
    right: 14,
  },
  inlineError: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 2,
    left: Spacing.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    right: Spacing.lg,
    top: 260,
  },
  inlineErrorTitle: {
    ...TextPresets.label,
  },
  inlineErrorText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  requiredRow: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  requiredLabel: {
    ...TextPresets.eyebrow,
  },
  requiredValue: {
    ...TextPresets.label,
    flex: 1,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  primaryButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
