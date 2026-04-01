import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import {
  formatAlarmTime,
  getAlarmById,
  getAlarmDeadlineTimestamp,
  hydrateAlarmRuntimeForCurrentUser,
  resolveAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

export default function RingingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colors = getAppColors(useColorScheme());
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
        setScanError(
          'That QR code does not match this checkpoint. Keep scanning for the correct one.'
        );

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
        <View style={styles.centeredContent}>
          <Text style={[styles.title, { color: colors.text }]}>Alarm not found</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            This alarm may have been deleted or already resolved.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/')}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
            <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
              Back Home
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.centeredContent}>
        <Text style={[styles.kicker, { color: colors.primary }]}>Alarm ringing</Text>
        <Text style={[styles.title, { color: '#ffffff' }]}>
          {formatAlarmTime(alarm.hour, alarm.minute)}
        </Text>
        <Text style={[styles.subtitle, { color: '#d4d4d8' }]}>
          Scan the {alarm.label} QR checkpoint before time expires. The alarm only clears when the
          scanned payload exactly matches the saved checkpoint value.
        </Text>

        <View
          style={[
            styles.countdownCard,
            {
              backgroundColor: '#18181b',
              borderColor: '#27272a',
            },
          ]}>
          <Text style={[styles.countdownLabel, { color: '#a1a1aa' }]}>Grace period left</Text>
          <Text style={[styles.countdownValue, { color: '#ffffff' }]}>
            {remainingSeconds ?? alarm.gracePeriodSeconds}s
          </Text>
        </View>

        {isScannerVisible && permission?.granted ? (
          <View style={styles.scannerSection}>
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanEnabled ? handleBarcodeScanned : undefined}
              style={styles.camera}
            />
            <Text style={styles.scannerHint}>
              Point the camera at the QR code in the other room.
            </Text>
          </View>
        ) : null}

        {scanError ? <Text style={[styles.errorText, { color: '#fca5a5' }]}>{scanError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={handleStartScanner}
          style={[
            styles.awakeButton,
            {
              backgroundColor: colors.primary,
              opacity: isSubmitting ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.awakeButtonText, { color: colors.primaryText }]}>Scan QR code</Text>
        </Pressable>

        {isScannerVisible ? (
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => setIsScannerVisible(false)}
            style={[
              styles.secondaryButton,
              {
                borderColor: '#3f3f46',
                opacity: isSubmitting ? 0.7 : 1,
              },
            ]}>
            <Text style={[styles.secondaryButtonText, { color: '#ffffff' }]}>Hide scanner</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  kicker: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 52,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    marginTop: 12,
    textAlign: 'center',
  },
  scannerSection: {
    marginTop: 24,
  },
  camera: {
    borderRadius: 24,
    height: 300,
    overflow: 'hidden',
    width: '100%',
  },
  scannerHint: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: 'center',
  },
  countdownCard: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 28,
    padding: 20,
  },
  countdownLabel: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  countdownValue: {
    fontSize: 44,
    fontWeight: '800',
    marginTop: 10,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 18,
    textAlign: 'center',
  },
  awakeButton: {
    alignItems: 'center',
    borderRadius: 24,
    marginTop: 28,
    paddingVertical: 22,
  },
  awakeButtonText: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    paddingVertical: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    marginTop: 24,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
