import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Radius, Spacing, TextPresets, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore, saveNewAlarm, updateAlarm } from '@/lib/alarms';
import {
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  scheduleAlarmNotificationAsync,
} from '@/lib/notifications';
import { listMySocialCircles } from '@/lib/social/circles';
import { SocialCircleSummary } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
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

function getModeLabel(isEditMode: boolean, isReuseMode: boolean) {
  if (isEditMode) {
    return 'Edit';
  }

  if (isReuseMode) {
    return 'Reuse';
  }

  return 'New';
}

export default function CreateAlarmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string; mode?: string }>();
  const colors = getAppColors(useColorScheme());
  const { configured, isProfileComplete, user } = useSocialSession();
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
  const [availableCircles, setAvailableCircles] = useState<SocialCircleSummary[]>([]);
  const [isSocialOptionsLoading, setIsSocialOptionsLoading] = useState(false);
  const [selectedCircleId, setSelectedCircleId] = useState('');
  const [shareSuccesses, setShareSuccesses] = useState(false);
  const [shareMisses, setShareMisses] = useState(false);
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
  const gracePreviewSeconds = useMemo(() => {
    const parsedValue = Number.parseInt(gracePeriodSeconds, 10);
    return Number.isFinite(parsedValue) ? Math.max(parsedValue, 0) : 0;
  }, [gracePeriodSeconds]);

  const screenTitle = isEditMode
    ? 'Edit alarm'
    : isReuseMode
      ? 'Reuse alarm'
      : 'New alarm';
  const screenSubtitle = isEditMode
    ? 'Update time, checkpoint, or sharing.'
    : isReuseMode
      ? 'Start from an existing setup.'
      : 'Set time, QR code, and rules.';
  const primaryActionLabel = isEditMode ? 'Save changes' : 'Save alarm';
  const socialEnabled = configured && user && isProfileComplete;
  const selectedCircle = availableCircles.find((circle) => circle.id === selectedCircleId) ?? null;
  const setupSummary = selectedCircle ? `Shares with ${selectedCircle.name}` : 'Private by default';

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

      if (!params.alarmId || (!isEditMode && !isReuseMode)) {
        setSourceAlarm(null);
        setSelectedCircleId('');
        setShareSuccesses(false);
        setShareMisses(false);
        return;
      }

      const alarm = store.alarms.find((candidate) => candidate.id === params.alarmId) ?? null;

      if (!alarm) {
        setSourceAlarm(null);
        setSelectedCircleId('');
        setShareSuccesses(false);
        setShareMisses(false);
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
      setSelectedCircleId(alarm.socialSettings?.circleId ?? '');
      setShareSuccesses(alarm.socialSettings?.shareSuccesses ?? false);
      setShareMisses(alarm.socialSettings?.shareMisses ?? false);
    };

    void loadFormData();
  }, [isEditMode, isReuseMode, params.alarmId]);

  useEffect(() => {
    if (!socialEnabled) {
      setAvailableCircles([]);
      setSelectedCircleId('');
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

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    const trimmedExpectedQrPayload = expectedQrPayload.trim();
    const gracePeriod = Number.parseInt(gracePeriodSeconds, 10);

    if (!trimmedLabel) {
      alertLabelRequired();
      return;
    }

    if (!trimmedExpectedQrPayload) {
      alertPayloadRequired();
      return;
    }

    if (Number.isNaN(gracePeriod) || gracePeriod < 15) {
      alertGraceRequired();
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
        alertNotificationPermission();
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
      <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropTop, { backgroundColor: colors.primary }]} />
      <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropBottom, { backgroundColor: colors.accent }]} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AppCard elevated tone="primary" style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Checkpoint builder</Text>
              <Text style={[styles.heroTitle, { color: colors.text }]}>{screenTitle}</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>{screenSubtitle}</Text>
            </View>
            <StatusPill label={getModeLabel(isEditMode, isReuseMode)} tone="primary" />
          </View>

          <View style={[styles.heroPreview, { backgroundColor: colors.elevated, borderColor: colors.ring }]}>
            <Text style={[TextPresets.label, { color: colors.muted }]}>Preview</Text>
            <Text style={[styles.heroTime, { color: colors.text }]}>{formattedTime}</Text>
            <View style={styles.previewStats}>
              <View style={styles.previewMetric}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Repeat</Text>
                <Text style={[TextPresets.label, { color: colors.text }]}>{REPEAT_OPTIONS.find((option) => option.value === repeatSchedule)?.label ?? 'Once'}</Text>
              </View>
              <View style={styles.previewMetric}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Grace</Text>
                <Text style={[TextPresets.label, { color: colors.text }]}>{gracePreviewSeconds || '--'}s</Text>
              </View>
              <View style={styles.previewMetric}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Visibility</Text>
                <Text numberOfLines={1} style={[TextPresets.label, { color: colors.text }]}>{setupSummary}</Text>
              </View>
            </View>
          </View>
        </AppCard>

        {sourceAlarm ? (
          <AppCard tone="muted">
            <Text style={[TextPresets.label, { color: colors.text }]}>Current base alarm</Text>
            <Text style={[styles.sourceTitle, { color: colors.text }]}>{sourceAlarm.label}</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              {isEditMode
                ? 'Editing the current alarm.'
                : 'Creating a new copy from this alarm.'}
            </Text>
          </AppCard>
        ) : null}

        {savedPresets.length > 0 ? (
        <AppCard elevated>
          <SectionHeader
            kicker="Fast path"
            title="Saved checkpoints"
            description="Reuse a saved QR target."
          />
          <View style={styles.selectionList}>
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
                    styles.selectionCard,
                    {
                      backgroundColor: colors.elevated,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>{preset.label}</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{preset.expectedQrPayload}</Text>
                </Pressable>
              ))}
            </View>
          </AppCard>
        ) : null}

        <AppCard elevated>
          <SectionHeader
            kicker="Step 1"
            title="Schedule"
            description="Set the time."
          />
          <View style={styles.timePanel}>
            <Text style={[styles.timeValue, { color: colors.primary }]}>{formattedTime}</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              Pick the actual wake-up time.
            </Text>
          </View>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'compact' : 'default'}
            mode="time"
            onChange={handleTimeChange}
            value={time}
          />
        </AppCard>

        <AppCard elevated>
          <SectionHeader
            kicker="Step 2"
            title="Checkpoint"
            description="Set the label and QR value."
          />

          <AppInput
            autoCapitalize="words"
            label="Checkpoint label"
            onChangeText={setLabel}
            placeholder="Bathroom sink"
            value={label}
          />

          <AppInput
            autoCapitalize="none"
            autoCorrect={false}
            helper="The alarm only clears when the scanned value matches this payload exactly."
            label="Expected QR payload"
            onChangeText={setExpectedQrPayload}
            placeholder="bathroom-checkpoint"
            value={expectedQrPayload}
          />

          <View style={styles.actionRow}>
            <AppButton
              label={expectedQrPayload ? 'Rescan QR code' : 'Scan QR code'}
              onPress={() => {
                void handleOpenScanner();
              }}
              style={styles.actionFill}
              variant="secondary"
            />
            {isScannerVisible ? (
              <AppButton
                label="Hide scanner"
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
              <Text style={[TextPresets.body, { color: colors.muted }]}>
                Scan the QR code this alarm should accept.
              </Text>
            </View>
          ) : null}

          {scannerMessage ? (
            <Text
              style={[
                TextPresets.body,
                {
                  color: permission?.granted === false ? colors.danger : colors.textSoft,
                },
              ]}>
              {scannerMessage}
            </Text>
          ) : null}
        </AppCard>

        <AppCard elevated>
          <SectionHeader
            kicker="Step 3"
            title="Rules"
            description="Repeat and grace period."
          />

          <View style={styles.repeatGrid}>
            {REPEAT_OPTIONS.map((option) => {
              const isSelected = repeatSchedule === option.value;

              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  onPress={() => setRepeatSchedule(option.value)}
                  style={[
                    styles.optionCard,
                    {
                      backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}>
                  <Text
                    style={[
                      TextPresets.label,
                      {
                        color: isSelected ? colors.primary : colors.text,
                      },
                    ]}>
                    {option.label}
                  </Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{option.help}</Text>
                </Pressable>
              );
            })}
          </View>

          <AppInput
            helper="Use at least 15 seconds. Shorter windows make misses far more likely."
            keyboardType="number-pad"
            label="Grace period in seconds"
            onChangeText={setGracePeriodSeconds}
            placeholder="120"
            value={gracePeriodSeconds}
          />
        </AppCard>

        <AppCard elevated>
          <SectionHeader
            kicker="Step 4"
            title="Social accountability"
            description="Private or shared."
          />

          {!configured ? (
            <SocialInfoCard
              actionLabel="Open account"
              colors={colors}
              copy="Connect Supabase first so circles and shared outcomes can sync."
              onPress={() => router.push('/account')}
              title="Social sync is not configured"
            />
          ) : !user || !isProfileComplete ? (
            <SocialInfoCard
              actionLabel="Finish account"
              colors={colors}
              copy="Sign in and finish your profile before attaching alarms to a circle."
              onPress={() => router.push('/account')}
              title="Profile required"
            />
          ) : isSocialOptionsLoading ? (
            <Text style={[TextPresets.body, { color: colors.muted }]}>Loading your circles...</Text>
          ) : (
            <>
              <View style={styles.selectionList}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSelectedCircleId('');
                    setShareSuccesses(false);
                    setShareMisses(false);
                  }}
                  style={[
                    styles.optionCard,
                    {
                      backgroundColor: !selectedCircleId ? colors.primarySurface : colors.elevated,
                      borderColor: !selectedCircleId ? colors.primary : colors.border,
                    },
                  ]}>
                  <Text style={[TextPresets.label, { color: !selectedCircleId ? colors.primary : colors.text }]}>
                    Private alarm
                  </Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    Nothing is shared.
                  </Text>
                </Pressable>

                {availableCircles.map((circle) => {
                  const isSelected = selectedCircleId === circle.id;

                  return (
                    <Pressable
                      key={circle.id}
                      accessibilityRole="button"
                      onPress={() => setSelectedCircleId(circle.id)}
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                          borderColor: isSelected ? colors.primary : colors.border,
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
                <AppButton label="Create or join a circle" onPress={() => router.push('/circles')} variant="secondary" />
              ) : (
                <>
                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Share successful clears</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Share when this alarm is cleared.
                      </Text>
                    </View>
                    <Switch
                      disabled={!selectedCircleId}
                      onValueChange={setShareSuccesses}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={selectedCircleId ? shareSuccesses : false}
                    />
                  </View>

                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Share missed alarms</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Share when this alarm is missed.
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
          )}
        </AppCard>

        <View style={styles.bottomActions}>
          <AppButton
            disabled={isSaving}
            label={isSaving ? 'Saving...' : primaryActionLabel}
            onPress={handleSave}
            style={styles.bottomAction}
          />
          <AppButton label="Cancel" onPress={() => router.back()} style={styles.bottomAction} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
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

function alertLabelRequired() {
  Alert.alert('Checkpoint label required', 'Give this alarm a label so it is easy to recognize.');
}

function alertPayloadRequired() {
  Alert.alert('QR payload required', 'Enter the exact QR payload that must be scanned when the alarm rings.');
}

function alertGraceRequired() {
  Alert.alert('Grace period required', 'Set a grace period of at least 15 seconds.');
}

function alertNotificationPermission() {
  Alert.alert(
    'Notification permission needed',
    'Notifications are required so the alarm can ring on time.'
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  backdropOrb: {
    borderRadius: 220,
    height: 240,
    opacity: 0.1,
    position: 'absolute',
    width: 240,
  },
  backdropTop: {
    right: -70,
    top: 40,
  },
  backdropBottom: {
    bottom: 180,
    left: -90,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  heroCard: {
    gap: Spacing.lg,
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  heroPreview: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  previewStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  previewMetric: {
    flex: 1,
    gap: Spacing.xs,
  },
  sourceTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  selectionList: {
    gap: Spacing.sm,
  },
  selectionCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  timePanel: {
    gap: Spacing.xs,
  },
  timeValue: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 42,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionFill: {
    flex: 1,
  },
  scannerSection: {
    gap: Spacing.sm,
  },
  camera: {
    borderRadius: Radius.lg,
    height: 280,
    overflow: 'hidden',
    width: '100%',
  },
  repeatGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  optionCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  preferenceRow: {
    alignItems: 'center',
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
    gap: Spacing.sm,
  },
  bottomAction: {
    flex: 1,
  },
});
