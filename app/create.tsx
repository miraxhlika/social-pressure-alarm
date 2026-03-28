import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import { readAlarmStore, saveNewAlarm } from '@/lib/alarms';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  Alarm,
  DEFAULT_ACCOUNTABILITY_MESSAGE,
  FREE_ALARM_LIMIT,
} from '@/types/alarm';

function createInitialTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

function isValidPhoneNumber(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [time, setTime] = useState(createInitialTime);
  const [contactName, setContactName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState(DEFAULT_ACCOUNTABILITY_MESSAGE);
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState('120');
  const [isSaving, setIsSaving] = useState(false);

  const formattedTime = useMemo(
    () =>
      time.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time]
  );

  const handleTimeChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) {
      return;
    }

    setTime(selectedDate);
  };

  const handleSave = async () => {
    const trimmedName = contactName.trim();
    const trimmedPhoneNumber = phoneNumber.trim();
    const trimmedMessage = message.trim();
    const gracePeriod = Number.parseInt(gracePeriodSeconds, 10);

    if (!trimmedName) {
      Alert.alert('Contact name required', 'Add the person who should keep you accountable.');
      return;
    }

    if (!isValidPhoneNumber(trimmedPhoneNumber)) {
      Alert.alert('Invalid phone number', 'Enter a phone number with 7 to 15 digits.');
      return;
    }

    if (!trimmedMessage) {
      Alert.alert('Message required', 'Add the accountability message that will be prepared.');
      return;
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      Alert.alert('Grace period required', 'Set a grace period of at least 15 seconds.');
      return;
    }

    const store = await readAlarmStore();

    if (store.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      router.replace('/paywall');
      return;
    }

    setIsSaving(true);

    let scheduledNotificationId: string | undefined;

    try {
      const hasNotificationPermission = await ensureNotificationPermissionsAsync();

      if (!hasNotificationPermission) {
        Alert.alert(
          'Notification permission needed',
          'This MVP relies on local notifications to trigger the alarm confirmation flow.'
        );
        return;
      }

      const alarmId = `${Date.now()}`;
      const baseAlarm: Alarm = {
        id: alarmId,
        hour: time.getHours(),
        minute: time.getMinutes(),
        contactName: trimmedName,
        phoneNumber: trimmedPhoneNumber,
        message: trimmedMessage,
        gracePeriodSeconds: gracePeriod,
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      const scheduled = await scheduleAlarmNotificationAsync(baseAlarm);
      scheduledNotificationId = scheduled.notificationId;

      await saveNewAlarm({
        ...baseAlarm,
        notificationId: scheduled.notificationId,
        scheduledFor: scheduled.scheduledFor,
      });

      router.replace('/');
    } catch (error) {
      if (scheduledNotificationId) {
        await cancelAlarmNotificationAsync(scheduledNotificationId);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'The alarm could not be saved right now.';

      Alert.alert('Unable to save alarm', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Create alarm</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Pick a time, pick a person, and define how long you get to prove you&apos;re awake.
          </Text>
        </View>

        <View
          style={[
            styles.section,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.label, { color: colors.text }]}>Alarm time</Text>
          <Text style={[styles.timePreview, { color: colors.primary }]}>{formattedTime}</Text>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            mode="time"
            onChange={handleTimeChange}
            value={time}
          />
        </View>

        <View
          style={[
            styles.section,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.label, { color: colors.text }]}>Contact name</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setContactName}
            placeholder="Jamie"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={contactName}
          />

          <Text style={[styles.label, { color: colors.text }]}>Phone number</Text>
          <TextInput
            keyboardType="phone-pad"
            onChangeText={setPhoneNumber}
            placeholder="+1 555 123 4567"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={phoneNumber}
          />

          <Text style={[styles.label, { color: colors.text }]}>Accountability message</Text>
          <TextInput
            multiline
            onChangeText={setMessage}
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              styles.messageInput,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={message}
          />

          <Text style={[styles.label, { color: colors.text }]}>Grace period in seconds</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setGracePeriodSeconds}
            placeholder="120"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={gracePeriodSeconds}
          />
        </View>

        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>How the MVP alarm works</Text>
          <Text style={[styles.infoText, { color: colors.muted }]}>
            This version asks for notification permission, schedules a local notification, and then
            routes to the ringing screen when the app receives the notification or the user reopens
            the app after the scheduled time.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={handleSave}
          style={[
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: isSaving ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
            {isSaving ? 'Saving...' : 'Save Alarm'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
  timePreview: {
    fontSize: 28,
    fontWeight: '800',
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  infoCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
