import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  formatAlarmTime,
  getAlarmById,
  getAlarmDeadlineTimestamp,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  resolveAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { formatGracePeriodLabel, getCheckpointLiveCopy, getUseCaseShortLabel } from '@/lib/checkpoint-templates';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { Alarm } from '@/types/alarm';

type CountdownTone = 'primary' | 'warning' | 'danger';

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

function getUrgencyCopy(
  tone: CountdownTone,
  remainingSeconds: number | null,
  liveCopy: ReturnType<typeof getCheckpointLiveCopy>
) {
  if (tone === 'danger') {
    return {
      badge: 'Critical',
      title: remainingSeconds === 1 ? '1 second left' : `${remainingSeconds ?? 0} seconds left`,
      description: liveCopy.criticalDescription,
    };
  }

  if (tone === 'warning') {
    return {
      badge: 'Move now',
      title: liveCopy.title,
      description: liveCopy.warningDescription,
    };
  }

  return {
    badge: 'Live',
    title: liveCopy.title,
    description: liveCopy.description,
  };
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
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);
  const urgentBackground = '#090B0D';
  const urgentPanel = '#12161B';
  const urgentBorder = '#252D37';
  const urgentText = '#F5F7FA';
  const urgentTextSoft = '#AEB7C3';
  const urgentTrack = '#232B34';
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanEnabled, setScanEnabled] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const hasResolvedRef = useRef(false);
  const hasRequestedPermissionRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const criticalHapticFiredRef = useRef(false);
  const glowPulse = useRef(new Animated.Value(0)).current;
  const framePulse = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1)).current;
  const errorFlash = useRef(new Animated.Value(0)).current;
  const criticalGlowLoopRef = useRef<Animated.CompositeAnimation | null>(null);

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
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      criticalGlowLoopRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    hasResolvedRef.current = false;
    hasRequestedPermissionRef.current = false;
    criticalHapticFiredRef.current = false;
    setScanEnabled(true);
    setScanError('');
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
    if (!alarm || !permission || permission.granted || permission.canAskAgain === false || hasRequestedPermissionRef.current) {
      return;
    }

    hasRequestedPermissionRef.current = true;
    void requestPermission();
  }, [alarm, permission, requestPermission]);

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
      await cancelAlarmNotificationAsync(alarm.notificationIds);
      const resolvedAlarm = await resolveAlarm(alarm.id, 'confirmed');
      const store = await readAlarmStore();
      const successEntry = store.successHistory.find((entry) => entry.alarmId === alarm.id) ?? null;
      await trackAnalyticsEvent('checkpoint_cleared', {
        checkpointId: alarm.id,
        useCaseType: alarm.useCaseType,
        repeatSchedule: alarm.repeatSchedule,
        gracePeriodSeconds: alarm.gracePeriodSeconds,
        timeToClearSeconds: successEntry?.timeToScanSeconds,
      });

      if (alarm.repeatSchedule !== 'once' && resolvedAlarm) {
        const nextScheduled = await scheduleAlarmNotificationAsync(resolvedAlarm);
        await updateAlarm({
          ...resolvedAlarm,
          isActive: true,
          notificationIds: nextScheduled.notificationIds,
          scheduledFor: nextScheduled.scheduledFor,
          notificationStrategyKey: nextScheduled.strategyKey,
        });
      }

      router.replace({
        pathname: '/success',
        params: {
          alarmId: alarm.id,
          label: alarm.label,
        },
      });
    } catch (error) {
      hasResolvedRef.current = false;
      setScanEnabled(true);

      const errorMessage =
        error instanceof Error ? error.message : 'The checkpoint could not be confirmed.';

      Alert.alert('Unable to confirm checkpoint', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, isSubmitting, router]);

  const handleMissedAlarm = useCallback(async () => {
    if (!alarm || isSubmitting || hasResolvedRef.current) {
      return;
    }

    hasResolvedRef.current = true;
    setIsSubmitting(true);

    try {
      await cancelAlarmNotificationAsync(alarm.notificationIds);
      const resolvedAlarm = await resolveAlarm(alarm.id, 'missed');
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

      if (alarm.repeatSchedule !== 'once' && resolvedAlarm) {
        const nextScheduled = await scheduleAlarmNotificationAsync(resolvedAlarm);
        await updateAlarm({
          ...resolvedAlarm,
          isActive: true,
          notificationIds: nextScheduled.notificationIds,
          scheduledFor: nextScheduled.scheduledFor,
          notificationStrategyKey: nextScheduled.strategyKey,
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

      Alert.alert('Unable to record missed checkpoint', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, isSubmitting, router]);

  const handleStartScanner = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    setScanError('');

    if (permission?.granted) {
      setScanEnabled(true);
      return;
    }

    if (permission?.canAskAgain === false) {
      await Linking.openSettings().catch(() => null);
      return;
    }

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScanError('Camera access is required so you can scan the checkpoint and clear the live run.');
        return;
      }
    }

    setScanEnabled(true);
  }, [isSubmitting, permission?.canAskAgain, permission?.granted, requestPermission]);

  const handleBarcodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (!alarm || !scanEnabled || isSubmitting || hasResolvedRef.current) {
        return;
      }

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

        retryTimeoutRef.current = setTimeout(() => {
          setScanEnabled(true);
        }, 1200);

        return;
      }

      await handleScanSuccess();
    },
    [alarm, errorFlash, handleScanSuccess, isSubmitting, liveCopy.wrongCodeDescription, scanEnabled]
  );

  useEffect(() => {
    if (alarm && remainingSeconds === 0 && !isSubmitting) {
      void handleMissedAlarm();
    }
  }, [alarm, handleMissedAlarm, isSubmitting, remainingSeconds]);

  const gracePeriodSeconds = alarm?.gracePeriodSeconds ?? 60;
  const countdownTone = getCountdownTone(remainingSeconds, gracePeriodSeconds);
  const progressRatio = remainingSeconds === null ? 1 : Math.max(0, remainingSeconds / gracePeriodSeconds);
  const urgencyCopy = getUrgencyCopy(countdownTone, remainingSeconds, liveCopy);
  const scannerFrameBorderColor =
    scanError.length > 0
      ? colors.danger
      : countdownTone === 'danger'
        ? colors.danger
        : countdownTone === 'warning'
          ? colors.warning
          : colors.primary;
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

  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.08],
  });
  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.32],
  });
  const frameScale = framePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1.015],
  });
  const frameOpacity = framePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.62, 1],
  });

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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: urgentBackground }]}>
      <StatusBar animated style="light" />
      <View style={styles.screenShell}>
        <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropTop, { backgroundColor: colors.primary }]} />
        <View
          pointerEvents="none"
          style={[styles.backdropOrb, styles.backdropBottom, { backgroundColor: colors.danger }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.criticalGlow,
            {
              backgroundColor: colors.danger,
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />

        <View style={styles.screen}>
          <AppCard padded={false} style={[styles.stageCard, { backgroundColor: urgentPanel, borderColor: urgentBorder }]}>
            <View style={styles.stageContent}>
              {isCameraReady ? (
                <View style={styles.cameraFill}>
                  <CameraView
                    barcodeScannerSettings={{
                      barcodeTypes: ['qr'],
                    }}
                    onBarcodeScanned={scanEnabled ? handleBarcodeScanned : undefined}
                    style={styles.camera}
                  />
                </View>
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

              <View pointerEvents="none" style={styles.stageTopShade} />

              <View style={styles.stageTopOverlay}>
                <View style={styles.stageMetaRow}>
                  <View style={styles.stageMetaGroup}>
                    <StatusPill label={urgencyCopy.badge} tone={countdownTone} />
                    <Text style={[styles.subtleTime, { color: urgentTextSoft }]}>
                      {getUseCaseShortLabel(alarm.useCaseType)} · {formatAlarmTime(alarm.hour, alarm.minute)}
                    </Text>
                  </View>
                  <StatusPill label={cameraStatusLabel} tone={isCameraReady && scanEnabled ? countdownTone : 'warning'} />
                </View>
                <View style={styles.stageTopCopy}>
                  <Text style={[styles.liveTitle, { color: urgentText }]}>{urgencyCopy.title}</Text>
                  <Text numberOfLines={1} style={[styles.label, { color: urgentText }]}>
                    Saved proof: {alarm.label}
                  </Text>
                  <Text style={[styles.stageInstruction, { color: urgentTextSoft }]}>{urgencyCopy.description}</Text>
                </View>
                <View style={[styles.focusCard, { backgroundColor: '#0D1116E0', borderColor: urgentBorder }]}>
                  <View style={styles.focusHeader}>
                    <Text style={[TextPresets.eyebrow, { color: urgentTextSoft }]}>Clear this run</Text>
                    <Text style={[styles.focusWindow, { color: urgentTextSoft }]}>
                      {formatGracePeriodLabel(alarm.gracePeriodSeconds)} window
                    </Text>
                  </View>
                  <Text style={[styles.focusTitle, { color: urgentText }]}>{alarm.label}</Text>
                  <Text style={[styles.focusBody, { color: urgentTextSoft }]}>{liveCopy.focusBody}</Text>
                </View>
              </View>

              {isCameraReady ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.scannerFrame,
                    {
                      borderColor: scannerFrameBorderColor,
                      opacity: frameOpacity,
                      transform: [{ scale: frameScale }],
                    },
                  ]}>
                  <View style={[styles.frameCorner, styles.frameCornerTopLeft, { borderColor: scannerFrameBorderColor }]} />
                  <View style={[styles.frameCorner, styles.frameCornerTopRight, { borderColor: scannerFrameBorderColor }]} />
                  <View style={[styles.frameCorner, styles.frameCornerBottomLeft, { borderColor: scannerFrameBorderColor }]} />
                  <View style={[styles.frameCorner, styles.frameCornerBottomRight, { borderColor: scannerFrameBorderColor }]} />
                </Animated.View>
              ) : null}

              {scanError ? (
                <View style={[styles.inlineError, { backgroundColor: '#2C1010E6', borderColor: withAlpha(colors.danger, '5C') }]}>
                  <Text style={[styles.inlineErrorTitle, { color: colors.danger }]}>{liveCopy.wrongCodeTitle}</Text>
                  <Text numberOfLines={2} style={[styles.inlineErrorText, { color: '#FFD7D7' }]}>
                    {scanError}
                  </Text>
                </View>
              ) : null}

              <View style={styles.countdownOverlay}>
                <Text style={[styles.countdownLabel, { color: urgentTextSoft }]}>Time left</Text>
                <Animated.Text
                  accessibilityLabel={`${remainingSeconds ?? alarm.gracePeriodSeconds} seconds left`}
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.countdownValue,
                    {
                      color: countdownTone === 'danger' ? colors.danger : urgentText,
                      transform: [{ scale: countdownScale }],
                    },
                  ]}>
                  {remainingSeconds ?? alarm.gracePeriodSeconds}s
                </Animated.Text>

                <View style={[styles.progressTrack, { backgroundColor: urgentTrack }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor:
                          countdownTone === 'danger'
                            ? colors.danger
                            : countdownTone === 'warning'
                              ? colors.warning
                              : colors.primary,
                        width: `${Math.max(4, Math.round(progressRatio * 100))}%`,
                      },
                    ]}
                  />
                </View>
              </View>

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
          </AppCard>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
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
    justifyContent: 'space-between',
  },
  stageMetaGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: Spacing.sm,
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
