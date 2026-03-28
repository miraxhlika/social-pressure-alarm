import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import {
  formatAlarmTime,
  getAlarmById,
  getAlarmDeadlineTimestamp,
  resolveAlarm,
} from '@/lib/alarms';
import { cancelAlarmNotificationAsync } from '@/lib/notifications';
import { openAccountabilitySmsAsync } from '@/lib/sms';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

export default function RingingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colors = getAppColors(useColorScheme());
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadAlarm = async () => {
      if (!params.alarmId) {
        setAlarm(null);
        return;
      }

      const foundAlarm = await getAlarmById(params.alarmId);
      setAlarm(foundAlarm);
    };

    void loadAlarm();
  }, [params.alarmId]);

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

  const handleConfirmedAwake = useCallback(async () => {
    if (!alarm || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await cancelAlarmNotificationAsync(alarm.notificationId);
      await resolveAlarm(alarm.id, 'confirmed');
      router.replace({
        pathname: '/success',
        params: {
          contactName: alarm.contactName,
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, isSubmitting, router]);

  const handleMissedAlarm = useCallback(async () => {
    if (!alarm || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await cancelAlarmNotificationAsync(alarm.notificationId);
      await resolveAlarm(alarm.id, 'missed');
      await openAccountabilitySmsAsync(alarm);

      Alert.alert(
        'Accountability message ready',
        'The SMS composer was opened. Automatic sending is not available in this Expo MVP.'
      );
      router.replace('/');
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'The SMS composer could not be opened on this device.';

      Alert.alert('SMS unavailable', errorMessage);
      router.replace('/');
    } finally {
      setIsSubmitting(false);
    }
  }, [alarm, isSubmitting, router]);

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
          Wake up now or the app will prepare a text to {alarm.contactName}.
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

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={handleConfirmedAwake}
          style={[
            styles.awakeButton,
            {
              backgroundColor: colors.primary,
              opacity: isSubmitting ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.awakeButtonText, { color: colors.primaryText }]}>I&apos;M AWAKE</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={handleMissedAlarm}
          style={[
            styles.secondaryButton,
            {
              borderColor: '#3f3f46',
              opacity: isSubmitting ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.secondaryButtonText, { color: '#ffffff' }]}>
            Open accountability SMS now
          </Text>
        </Pressable>
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
