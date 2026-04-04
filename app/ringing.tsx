import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Radius, Spacing, TextPresets, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  formatAlarmTime,
  getAlarmById,
  getAlarmDeadlineTimestamp,
  hydrateAlarmRuntimeForCurrentUser,
  resolveAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { Alarm } from '@/types/alarm';

function getCountdownTone(remainingSeconds: number | null, gracePeriodSeconds: number) {
  if (remainingSeconds === null) {
    return 'warning' as const;
  }

  if (remainingSeconds <= Math.min(15, Math.ceil(gracePeriodSeconds * 0.2))) {
    return 'danger' as const;
  }

  if (remainingSeconds <= Math.ceil(gracePeriodSeconds * 0.5)) {
    return 'warning' as const;
  }

  return 'primary' as const;
}

export default function RingingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);
  const urgentBackground = colorScheme === 'dark' ? '#09111F' : '#0F172A';
  const urgentPanel = colorScheme === 'dark' ? '#142036' : '#172554';
  const urgentBorder = colorScheme === 'dark' ? '#24385D' : '#274690';
  const urgentText = '#F8FAFC';
  const urgentTextSoft = colorScheme === 'dark' ? '#C9D6F2' : '#DCE6FF';
  const urgentTrack = colorScheme === 'dark' ? '#1F3152' : '#2B4C93';
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanEnabled, setScanEnabled] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const hasResolvedRef = useRef(false);
  const hasAutoOpenedScannerRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const deadline = useMemo(() => {
    if (!alarm) {
      return null;
    }

    return getAlarmDeadlineTimestamp(alarm);
  }, [alarm]);

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
    if (alarm && permission?.granted && !isScannerVisible && !hasAutoOpenedScannerRef.current) {
      hasAutoOpenedScannerRef.current = true;
      setScanEnabled(true);
      setIsScannerVisible(true);
    }
  }, [alarm, isScannerVisible, permission?.granted]);

  const handleScanSuccess = useCallback(async () => {
    if (!alarm || isSubmitting || hasResolvedRef.current) {
      return;
    }

    hasResolvedRef.current = true;
    setIsSubmitting(true);
    setScanError('');

    try {
      await cancelAlarmNotificationAsync(alarm.notificationIds);
      const resolvedAlarm = await resolveAlarm(alarm.id, 'confirmed');

      if (alarm.repeatSchedule !== 'once' && resolvedAlarm) {
        const nextScheduled = await scheduleAlarmNotificationAsync(resolvedAlarm);
        await updateAlarm({
          ...resolvedAlarm,
          isActive: true,
          notificationIds: nextScheduled.notificationIds,
          scheduledFor: nextScheduled.scheduledFor,
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
        error instanceof Error ? error.message : 'The QR checkpoint could not be confirmed.';

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

      if (alarm.repeatSchedule !== 'once' && resolvedAlarm) {
        const nextScheduled = await scheduleAlarmNotificationAsync(resolvedAlarm);
        await updateAlarm({
          ...resolvedAlarm,
          isActive: true,
          notificationIds: nextScheduled.notificationIds,
          scheduledFor: nextScheduled.scheduledFor,
        });
      }

      router.replace('/');
    } catch (error) {
      hasResolvedRef.current = false;

      const errorMessage =
        error instanceof Error ? error.message : 'The missed checkpoint could not be recorded.';

      Alert.alert('Unable to record missed alarm', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, isSubmitting, router]);

  const handleStartScanner = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    setScanError('');

    if (!permission?.granted) {
      const response = await requestPermission();

      if (!response.granted) {
        setScanError('Camera access is required to scan your QR checkpoint.');
        return;
      }
    }

    setScanEnabled(true);
    setIsScannerVisible(true);
  }, [isSubmitting, permission?.granted, requestPermission]);

  const handleBarcodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (!alarm || !scanEnabled || isSubmitting || hasResolvedRef.current) {
        return;
      }

      setScanEnabled(false);

      if (data !== alarm.expectedQrPayload) {
        setScanError('That QR code does not match this checkpoint. Keep scanning for the correct one.');

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
    [alarm, handleScanSuccess, isSubmitting, scanEnabled]
  );

  useEffect(() => {
    if (alarm && remainingSeconds === 0 && !isSubmitting) {
      void handleMissedAlarm();
    }
  }, [alarm, handleMissedAlarm, isSubmitting, remainingSeconds]);

  if (!alarm) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
        <View style={styles.emptyWrap}>
          <AppCard elevated style={styles.emptyCard}>
            <Text style={[TextPresets.title, { color: colors.text }]}>Alarm not found</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              This alarm may have been deleted or already resolved.
            </Text>
            <AppButton label="Back to alarms" onPress={() => router.replace('/alarms')} />
          </AppCard>
        </View>
      </SafeAreaView>
    );
  }

  const countdownTone = getCountdownTone(remainingSeconds, alarm.gracePeriodSeconds);
  const progressRatio = remainingSeconds === null ? 1 : Math.max(0, remainingSeconds / alarm.gracePeriodSeconds);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: urgentBackground }]}>
      <StatusBar animated style="light" />
      <View style={styles.screen}>
        <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropTop, { backgroundColor: colors.primary }]} />
        <View
          pointerEvents="none"
          style={[styles.backdropOrb, styles.backdropBottom, { backgroundColor: colors.danger }]}
        />
        <View style={styles.topBlock}>
          <StatusPill label="Alarm" tone="danger" />
          <Text style={[styles.time, { color: urgentText }]}>{formatAlarmTime(alarm.hour, alarm.minute)}</Text>
          <Text style={[styles.label, { color: urgentText }]}>{alarm.label}</Text>
          <Text style={[TextPresets.body, styles.centered, { color: urgentTextSoft }]}>
            Scan the saved QR code before time runs out.
          </Text>
        </View>

        <AppCard
          elevated
          tone={countdownTone === 'danger' ? 'danger' : 'default'}
          style={[styles.countdownCard, { backgroundColor: urgentPanel, borderColor: urgentBorder }]}>
          <View style={styles.countdownHeader}>
            <Text style={[TextPresets.label, { color: urgentTextSoft }]}>Time left</Text>
            <StatusPill label={countdownTone === 'danger' ? 'Critical' : countdownTone === 'warning' ? 'Move now' : 'Live'} tone={countdownTone} />
          </View>
          <Text style={[styles.countdownValue, { color: countdownTone === 'danger' ? colors.danger : urgentText }]}>
            {remainingSeconds ?? alarm.gracePeriodSeconds}s
          </Text>
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
          <Text style={[TextPresets.body, { color: urgentTextSoft }]}>
            Required payload: {alarm.expectedQrPayload}
          </Text>
        </AppCard>

        <View style={styles.scannerWrap}>
          {isScannerVisible && permission?.granted ? (
            <View style={styles.scannerSection}>
              <CameraView
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={scanEnabled ? handleBarcodeScanned : undefined}
                style={styles.camera}
              />
              <Text style={[TextPresets.body, styles.centered, { color: colors.muted }]}>
                Hold the camera over the saved QR code.
              </Text>
            </View>
          ) : (
            <AppCard
              tone="muted"
              style={[styles.placeholderCard, { backgroundColor: urgentPanel, borderColor: urgentBorder }]}>
              <Text style={[TextPresets.label, { color: urgentText }]}>Camera</Text>
              <Text style={[TextPresets.body, { color: urgentTextSoft }]}>
                Open the camera and scan the saved code.
              </Text>
            </AppCard>
          )}
        </View>

        {scanError ? (
          <AppCard tone="danger" style={styles.errorCard}>
            <Text style={[TextPresets.label, { color: colors.danger }]}>Wrong QR code</Text>
            <Text style={[TextPresets.body, { color: colors.danger }]}>{scanError}</Text>
          </AppCard>
        ) : null}

        <View style={styles.bottomActions}>
          <AppButton
            disabled={isSubmitting}
            label={isScannerVisible ? 'Scanner active' : 'Open scanner'}
            onPress={handleStartScanner}
            textStyle={styles.primaryButtonText}
            variant="primary"
          />
          {isScannerVisible ? (
            <AppButton disabled={isSubmitting} label="Hide scanner" onPress={() => setIsScannerVisible(false)} variant="secondary" />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    gap: Spacing.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: Spacing.xl,
    position: 'relative',
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
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyCard: {
    gap: Spacing.md,
  },
  topBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  centered: {
    textAlign: 'center',
  },
  time: {
    fontFamily: Fonts.rounded,
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 60,
    textAlign: 'center',
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  countdownCard: {
    gap: Spacing.md,
  },
  countdownHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  countdownValue: {
    fontFamily: Fonts.rounded,
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 50,
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
  },
  scannerWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  scannerSection: {
    gap: Spacing.sm,
  },
  camera: {
    borderRadius: Radius.lg,
    height: 320,
    overflow: 'hidden',
    width: '100%',
  },
  placeholderCard: {
    gap: Spacing.sm,
  },
  errorCard: {
    gap: Spacing.xs,
  },
  bottomActions: {
    gap: Spacing.sm,
  },
  primaryButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
