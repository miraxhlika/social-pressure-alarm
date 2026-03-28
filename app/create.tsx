import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import { readAlarmStore, saveNewAlarm, updateAlarm } from '@/lib/alarms';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm, CheckpointPreset, FREE_ALARM_LIMIT, RepeatSchedule } from '@/types/alarm';

const REPEAT_OPTIONS: { value: RepeatSchedule; label: string; help: string }[] = [
  { value: 'once', label: 'Once', help: 'One scheduled run' },
  { value: 'daily', label: 'Daily', help: 'Every day' },
  { value: 'weekdays', label: 'Weekdays', help: 'Mon to Fri' },
];

function createInitialTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string; mode?: string }>();
  const colors = getAppColors(useColorScheme());
  const [time, setTime] = useState(createInitialTime);
  const [label, setLabel] = useState('');
  const [expectedQrPayload, setExpectedQrPayload] = useState('');
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>('once');
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState('120');
  const [isSaving, setIsSaving] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const [savedPresets, setSavedPresets] = useState<CheckpointPreset[]>([]);
  const [sourceAlarm, setSourceAlarm] = useState<Alarm | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditMode = params.mode === 'edit' && typeof params.alarmId === 'string';
  const isReuseMode = params.mode === 'reuse' && typeof params.alarmId === 'string';

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

  useEffect(() => {
    const loadFormData = async () => {
      const store = await readAlarmStore();
      setSavedPresets(store.checkpointPresets);

      if (!params.alarmId || (!isEditMode && !isReuseMode)) {
        setSourceAlarm(null);
        return;
      }

      const alarm = store.alarms.find((candidate) => candidate.id === params.alarmId) ?? null;

      if (!alarm) {
        setSourceAlarm(null);
        return;
      }

      const nextTime = createInitialTime();
      nextTime.setHours(alarm.hour, alarm.minute, 0, 0);

      setSourceAlarm(alarm);
      setTime(nextTime);
      setLabel(alarm.label);
      setExpectedQrPayload(alarm.expectedQrPayload);
      setRepeatSchedule(alarm.repeatSchedule);
      setGracePeriodSeconds(String(alarm.gracePeriodSeconds));
    };

    void loadFormData();
  }, [isEditMode, isReuseMode, params.alarmId]);

  useEffect(() => {
    return () => {
      if (scannerTimeoutRef.current) {
        clearTimeout(scannerTimeoutRef.current);
      }
    };
  }, []);

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

  const screenTitle = isEditMode
    ? 'Edit checkpoint alarm'
    : isReuseMode
      ? 'Reuse checkpoint alarm'
      : 'Create checkpoint alarm';
  const screenSubtitle = isEditMode
    ? 'Update the schedule, checkpoint, and repeat pattern without rebuilding the alarm from scratch.'
    : isReuseMode
      ? 'Start from an existing alarm, then tweak the time or checkpoint before saving a new copy.'
      : "Set a wake-up time, then enter the exact QR payload for a code you'll place in another room.";
  const primaryActionLabel = isEditMode ? 'Save changes' : 'Save Checkpoint Alarm';

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    const trimmedExpectedQrPayload = expectedQrPayload.trim();
    const gracePeriod = Number.parseInt(gracePeriodSeconds, 10);

    if (!trimmedLabel) {
      Alert.alert('Checkpoint label required', 'Give this alarm a label so it is easy to recognize.');
      return;
    }

    if (!trimmedExpectedQrPayload) {
      Alert.alert(
        'QR payload required',
        'Enter the exact QR payload that must be scanned when the alarm rings.'
      );
      return;
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      Alert.alert('Grace period required', 'Set a grace period of at least 15 seconds.');
      return;
    }

    const store = await readAlarmStore();

    if (!isEditMode && store.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      router.replace('/paywall');
      return;
    }

    setIsSaving(true);

    let scheduledNotificationIds: string[] | undefined;

    try {
      const hasNotificationPermission = await ensureNotificationPermissionsAsync();

      if (!hasNotificationPermission) {
        Alert.alert(
          'Notification permission needed',
          'This MVP relies on local notifications to trigger the alarm confirmation flow.'
        );
        return;
      }

      const alarmId = isEditMode && sourceAlarm ? sourceAlarm.id : `${Date.now()}`;
      const baseAlarm: Alarm = {
        id: alarmId,
        hour: time.getHours(),
        minute: time.getMinutes(),
        label: trimmedLabel,
        expectedQrPayload: trimmedExpectedQrPayload,
        repeatSchedule,
        gracePeriodSeconds: gracePeriod,
        isActive: true,
        createdAt: isEditMode && sourceAlarm ? sourceAlarm.createdAt : new Date().toISOString(),
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
      };

      if (isEditMode && sourceAlarm) {
        await updateAlarm(nextAlarm);
      } else {
        await saveNewAlarm(nextAlarm);
      }

      router.replace('/');
    } catch (error) {
      if (scheduledNotificationIds) {
        await cancelAlarmNotificationAsync(scheduledNotificationIds);
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
          <Text style={[styles.title, { color: colors.text }]}>{screenTitle}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{screenSubtitle}</Text>
        </View>

        {savedPresets.length ? (
          <View
            style={[
              styles.section,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.label, { color: colors.text }]}>Saved checkpoints</Text>
            <Text style={[styles.helperText, { color: colors.muted }]}>
              Reuse a checkpoint preset to skip manual entry.
            </Text>
            <View style={styles.presetList}>
              {savedPresets.map((preset) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setLabel(preset.label);
                    setExpectedQrPayload(preset.expectedQrPayload);
                    setScannerMessage(`Loaded the ${preset.label} checkpoint preset.`);
                  }}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: `${colors.primary}14`,
                    },
                  ]}>
                  <Text style={[styles.presetLabel, { color: colors.primary }]}>{preset.label}</Text>
                  <Text style={[styles.presetPayload, { color: colors.muted }]}>
                    {preset.expectedQrPayload}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

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
          <Text style={[styles.label, { color: colors.text }]}>Checkpoint label</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setLabel}
            placeholder="Bathroom sink"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={label}
          />

          <Text style={[styles.label, { color: colors.text }]}>Expected QR payload</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setExpectedQrPayload}
            placeholder="bathroom-checkpoint"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={expectedQrPayload}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handleOpenScanner();
            }}
            style={[
              styles.scanButton,
              {
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.scanButtonText, { color: colors.text }]}>
              {expectedQrPayload ? 'Rescan QR code' : 'Scan QR code'}
            </Text>
          </Pressable>

          {isScannerVisible && permission?.granted ? (
            <View style={styles.scannerSection}>
              <CameraView
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={isScannerEnabled ? handleBarcodeScanned : undefined}
                style={styles.camera}
              />
              <Text style={[styles.scannerHint, { color: colors.muted }]}>
                Scan the QR code you want this alarm to require.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsScannerVisible(false)}
                style={[
                  styles.hideScannerButton,
                  {
                    borderColor: colors.border,
                  },
                ]}>
                <Text style={[styles.hideScannerButtonText, { color: colors.text }]}>
                  Hide scanner
                </Text>
              </Pressable>
            </View>
          ) : null}

          {scannerMessage ? (
            <Text
              style={[
                styles.helperText,
                {
                  color: permission?.granted === false ? colors.danger : colors.muted,
                },
              ]}>
              {scannerMessage}
            </Text>
          ) : null}

          <Text style={[styles.helperText, { color: colors.muted }]}>
            Use the exact string encoded inside the QR code. The alarm only clears when that scan
            matches perfectly.
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>Repeat</Text>
          <View style={styles.repeatRow}>
            {REPEAT_OPTIONS.map((option) => {
              const isSelected = repeatSchedule === option.value;

              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  onPress={() => setRepeatSchedule(option.value)}
                  style={[
                    styles.repeatButton,
                    {
                      backgroundColor: isSelected ? `${colors.primary}14` : 'transparent',
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.repeatButtonLabel,
                      {
                        color: isSelected ? colors.primary : colors.text,
                      },
                    ]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.repeatButtonHelp, { color: colors.muted }]}>
                    {option.help}
                  </Text>
                </Pressable>
              );
            })}
          </View>

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
            This version schedules the alarm, supports recurring daily routines, and gives you a
            short window to scan the matching QR checkpoint before each run is marked as missed.
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
            {isSaving ? 'Saving...' : primaryActionLabel}
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
  scanButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
  },
  scanButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  presetList: {
    gap: 10,
  },
  presetChip: {
    borderRadius: 16,
    gap: 4,
    padding: 14,
  },
  presetLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  presetPayload: {
    fontSize: 13,
    lineHeight: 18,
  },
  scannerSection: {
    gap: 10,
  },
  camera: {
    borderRadius: 18,
    height: 240,
    overflow: 'hidden',
    width: '100%',
  },
  scannerHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  hideScannerButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
  },
  hideScannerButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
  },
  repeatRow: {
    gap: 10,
  },
  repeatButton: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 2,
    padding: 14,
  },
  repeatButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  repeatButtonHelp: {
    fontSize: 13,
    lineHeight: 18,
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
