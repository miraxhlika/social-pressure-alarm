import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowIconBadge,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import {
  FlowBarcodePreview,
  FlowCodePreview,
  FlowInfoLine,
  FlowProgressBar,
} from '@/components/ui/flow-visuals';
import { LoadingBlock } from '@/components/ui/loading-block';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteAlarm,
  formatAlarmTime,
  formatRepeatSchedule,
  getAlarmById,
  getAlarmPhase,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  rescheduleAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { getUseCaseLabel } from '@/lib/checkpoint-templates';
import { cancelAlarmNotificationAsync } from '@/lib/notifications';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { getCheckpointSocialDescription } from '@/lib/social/settings';
import { Alarm, AlarmProofCodeType, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type CheckpointDetailsState = {
  alarm: Alarm | null;
  progressSummary: ProgressSummary | null;
  successes: SuccessHistoryEntry[];
  failures: FailureHistoryEntry[];
  currentStreak: number;
  longestStreak: number;
};

function getPhaseCopy(alarm: Alarm | null) {
  if (!alarm) {
    return { label: 'Unavailable', tone: 'warning' as const };
  }

  const phase = getAlarmPhase(alarm);

  switch (phase) {
    case 'ringing':
      return { label: 'Scan now', tone: 'warning' as const };
    case 'missed':
      return { label: 'Missed', tone: 'danger' as const };
    case 'inactive':
      return { label: 'Paused', tone: 'default' as const };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'primary' as const };
    default:
      return { label: 'Draft', tone: 'default' as const };
  }
}

function getProofPreview(payload: string) {
  if (payload.length <= 18) {
    return payload;
  }

  return `${payload.slice(0, 8)}...${payload.slice(-7)}`;
}

function getSavedCodeId(payload: string) {
  let hash = 0;

  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }

  return `ID: WF-PRW-${hash.toString(16).toUpperCase().padStart(3, '0').slice(0, 3)}`;
}

function getProofCodeType(alarm: Alarm): AlarmProofCodeType {
  if (alarm.proofCodeType) {
    return alarm.proofCodeType;
  }

  const payload = alarm.expectedQrPayload.trim();

  if (/^[0-9]{8,14}$/.test(payload) || /^[A-Z0-9 -]{8,32}$/.test(payload)) {
    return 'barcode';
  }

  return 'qr';
}

function formatDueWindow(alarm: Alarm) {
  const start = new Date();
  start.setHours(alarm.hour, alarm.minute, 0, 0);

  const end = new Date(start);
  end.setSeconds(end.getSeconds() + alarm.gracePeriodSeconds);

  return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatScheduleLine(alarm: Alarm) {
  const time = formatAlarmTime(alarm.hour, alarm.minute);

  if (alarm.repeatSchedule === 'weekdays') {
    return `Mon - Fri · ${time}`;
  }

  if (alarm.repeatSchedule === 'daily') {
    return `Every day · ${time}`;
  }

  return alarm.scheduledFor ? formatScheduledForCompact(alarm.scheduledFor) : `One-time · ${time}`;
}

function formatScheduledForCompact(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CheckpointDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const colors = getAppColors(useColorScheme());
  const loadedDetailsIdRef = useRef<string | null>(null);
  const loadDetailsRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<CheckpointDetailsState>({
    alarm: null,
    progressSummary: null,
    successes: [],
    failures: [],
    currentStreak: 0,
    longestStreak: 0,
  });

  const loadDetails = useCallback(async () => {
    const requestId = loadDetailsRequestRef.current + 1;
    loadDetailsRequestRef.current = requestId;

    const checkpointId = params.id;

    if (!checkpointId) {
      loadedDetailsIdRef.current = null;
      setState({
        alarm: null,
        progressSummary: null,
        successes: [],
        failures: [],
        currentStreak: 0,
        longestStreak: 0,
      });
      setIsLoading(false);
      return;
    }

    if (loadedDetailsIdRef.current !== checkpointId) {
      setIsLoading(true);
    }

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const [store, alarm] = await Promise.all([readAlarmStore(), getAlarmById(checkpointId)]);

      if (loadDetailsRequestRef.current === requestId) {
        setState({
          alarm,
          progressSummary: getProgressSummary(store),
          successes: store.successHistory.filter((entry) => entry.alarmId === checkpointId),
          failures: store.failureHistory.filter((entry) => entry.alarmId === checkpointId),
          currentStreak: store.currentStreak,
          longestStreak: store.longestStreak,
        });
      }
    } finally {
      if (loadDetailsRequestRef.current === requestId) {
        loadedDetailsIdRef.current = checkpointId;
        setIsLoading(false);
      }
    }
  }, [params.id]);

  useFocusEffect(
    useCallback(() => {
      void loadDetails();
    }, [loadDetails])
  );

  const alarm = state.alarm;
  const phase = useMemo(() => getPhaseCopy(alarm), [alarm]);
  const proofCodeType = alarm ? getProofCodeType(alarm) : 'qr';
  const proofCodeLabel = proofCodeType === 'barcode' ? 'Barcode' : 'QR Code';
  const attemptCount = state.successes.length + state.failures.length;
  const clearRateValue = attemptCount === 0 ? 0 : Math.round((state.successes.length / attemptCount) * 100);
  const weeklyRate = state.progressSummary?.weeklyStats.completionRate ?? clearRateValue;

  const handlePause = useCallback(() => {
    if (!alarm) {
      return;
    }

    Alert.alert('Pause checkpoint?', `${alarm.label} will stay saved, but no future notifications will fire.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pause',
        onPress: async () => {
          await cancelAlarmNotificationAsync(alarm.notificationIds);
          await updateAlarm({ ...alarm, isActive: false, notificationIds: undefined, scheduledFor: undefined });
          await loadDetails();
        },
      },
    ]);
  }, [alarm, loadDetails]);

  const handleDelete = useCallback(() => {
    if (!alarm) {
      return;
    }

    Alert.alert('Delete checkpoint?', `Remove ${alarm.label}? This does not erase past history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelAlarmNotificationAsync(alarm.notificationIds);
          await deleteAlarm(alarm.id);
          router.replace('/(tabs)/alarms');
        },
      },
    ]);
  }, [alarm, router]);

  const handleEdit = useCallback(
    (recoveryFocus?: 'time' | 'code') => {
      if (!alarm) {
        return;
      }

      router.push({
        pathname: '/create',
        params: {
          alarmId: alarm.id,
          mode: 'edit',
          recoveryFocus,
          returnTo: `/checkpoint/${alarm.id}`,
        },
      });
    },
    [alarm, router]
  );

  const handleReschedule = useCallback(async () => {
    if (!alarm) {
      return;
    }

    await rescheduleAlarm(alarm);
    await loadDetails();
  }, [alarm, loadDetails]);

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock title="Loading checkpoint" description="Fetching schedule, proof setup, and history." />
      </AppScreen>
    );
  }

  if (!alarm) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <FlowTopBar
          leftAccessibilityLabel="Go back"
          leftIcon="chevron-back"
          onLeftPress={() => router.back()}
          title="Checkpoint Details"
        />
        <EmptyState
          actionLabel="Back to checkpoints"
          description="This checkpoint is no longer saved on this device."
          onAction={() => router.replace('/(tabs)/alarms')}
          title="Checkpoint not found"
          tone="primary"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
      <FlowTopBar
        leftAccessibilityLabel="Go back"
        leftIcon="chevron-back"
        onLeftPress={() => router.back()}
        rightAccessibilityLabel="More checkpoint actions"
        rightIcon="ellipsis-vertical"
        onRightPress={() => handleEdit()}
        title="Checkpoint Details"
      />

      <FlowPanel style={styles.identityPanel}>
        <View style={styles.identityRow}>
          <FlowIconBadge icon="fitness-outline" size="large" tone="muted" />
          <View style={styles.identityCopy}>
            <Text style={[styles.checkpointTitle, { color: colors.text }]}>{alarm.label}</Text>
            <Text style={[styles.checkpointSubtitle, { color: colors.textSoft }]}>{getUseCaseLabel(alarm.useCaseType)}</Text>
          </View>
          <StatusPill label={phase.label} tone={phase.tone} />
        </View>
      </FlowPanel>

      <FlowPanel style={styles.tightPanel}>
        <FlowInfoLine icon="calendar-outline" label="Schedule" value={formatScheduleLine(alarm)} />
        <FlowInfoLine icon="repeat-outline" label="Recurrence" value={formatRepeatSchedule(alarm.repeatSchedule)} />
        <FlowInfoLine icon="time-outline" label="Due window" value={formatDueWindow(alarm)} />
      </FlowPanel>

      <FlowPanel style={styles.linkedCodePanel}>
        <FlowSectionLabel>LINKED CODE</FlowSectionLabel>
        <View style={styles.codeRow}>
          {proofCodeType === 'barcode' ? <FlowBarcodePreview /> : <FlowCodePreview />}
          <View style={styles.codeCopy}>
            <Text style={[styles.codeTitle, { color: colors.text }]}>{proofCodeLabel}</Text>
            <Text style={[styles.codeSubtitle, { color: colors.textSoft }]}>{getSavedCodeId(alarm.expectedQrPayload)}</Text>
            <Text numberOfLines={1} style={[styles.codePreviewText, { color: colors.muted }]}>
              {getProofPreview(alarm.expectedQrPayload)}
            </Text>
          </View>
        </View>
      </FlowPanel>

      <FlowPanel style={styles.placePanel}>
        <FlowInfoLine icon="location-outline" label="Place / Object" value={alarm.placeObject || alarm.label} />
        <FlowInfoLine
          icon="people-outline"
          label="Accountability"
          value={getCheckpointSocialDescription(alarm.socialSettings)}
        />
      </FlowPanel>

      <View style={styles.streakGrid}>
        <MiniStat
          icon="flame"
          label="Current streak"
          tone="warning"
          value={`${state.currentStreak} day${state.currentStreak === 1 ? '' : 's'}`}
        />
        <MiniStat
          icon="trophy"
          label="Best streak"
          tone="warning"
          value={`${state.longestStreak} day${state.longestStreak === 1 ? '' : 's'}`}
        />
      </View>

      <FlowPanel style={styles.reliabilityPanel}>
        <View style={styles.reliabilityHeader}>
          <Text style={[styles.reliabilityTitle, { color: colors.text }]}>Weekly reliability</Text>
          <Text style={[styles.reliabilityValue, { color: colors.text }]}>{weeklyRate}%</Text>
        </View>
        <FlowProgressBar progress={weeklyRate / 100} tone="success" />
      </FlowPanel>

      <FlowPanel style={styles.notesPanel}>
        <FlowSectionLabel>NOTES</FlowSectionLabel>
        <Text style={[styles.notesText, { color: colors.textSoft }]}>
          {alarm.notes || 'Scan before every workout to stay consistent and build momentum.'}
        </Text>
      </FlowPanel>

      <View style={styles.buttonGrid}>
        <DetailButton icon="create-outline" label="Edit" onPress={() => handleEdit()} />
        <DetailButton icon="pause" label="Pause" onPress={handlePause} />
        <DetailButton icon="qr-code-outline" label="Relink code" onPress={() => handleEdit('code')} />
        <DetailButton destructive icon="trash-outline" label="Delete" onPress={handleDelete} />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={getAlarmPhase(alarm) === 'ringing' ? () => router.push(`/ringing?alarmId=${alarm.id}`) : handleReschedule}
        style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.text }, pressed && styles.pressed]}>
        <Text style={[styles.primaryActionText, { color: colors.elevated }]}>
          {getAlarmPhase(alarm) === 'ringing' ? 'Open live run' : alarm.isActive ? 'Reschedule next run' : 'Resume checkpoint'}
        </Text>
      </Pressable>
    </AppScreen>
  );
}

function MiniStat({
  icon,
  label,
  tone,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: 'warning' | 'success';
  value: string;
}) {
  const colors = getAppColors(useColorScheme());
  const iconColor = tone === 'success' ? colors.success : colors.warning;

  return (
    <FlowPanel style={styles.miniStatPanel}>
      <View style={styles.miniStatRow}>
        <Ionicons color={iconColor} name={icon} size={19} />
        <View style={styles.miniStatCopy}>
          <Text style={[styles.miniStatLabel, { color: colors.textSoft }]}>{label}</Text>
          <Text style={[styles.miniStatValue, { color: colors.text }]}>{value}</Text>
        </View>
      </View>
    </FlowPanel>
  );
}

function DetailButton({
  destructive,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const colors = getAppColors(useColorScheme());
  const color = destructive ? colors.danger : colors.text;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.detailButton,
        {
          backgroundColor: colors.elevated,
          borderColor: destructive ? withAlpha(colors.danger, '35') : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <Ionicons color={color} name={icon} size={15} />
      <Text style={[styles.detailButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 8,
    paddingBottom: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  identityPanel: {
    padding: 10,
  },
  identityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  identityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  checkpointTitle: {
    fontFamily: Fonts.serif,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  checkpointSubtitle: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  tightPanel: {
    gap: 0,
    paddingBottom: 3,
    paddingHorizontal: 10,
    paddingTop: 3,
  },
  linkedCodePanel: {
    gap: 8,
  },
  codeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  codeCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  codeTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  codeSubtitle: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  codePreviewText: {
    ...TextPresets.body,
    fontSize: 9,
    lineHeight: 12,
  },
  placePanel: {
    gap: 0,
    paddingBottom: 3,
    paddingHorizontal: 10,
    paddingTop: 3,
  },
  streakGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  miniStatPanel: {
    flex: 1,
    padding: 10,
  },
  miniStatRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  miniStatCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  miniStatLabel: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 13,
  },
  miniStatValue: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  reliabilityPanel: {
    gap: 7,
  },
  reliabilityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reliabilityTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  reliabilityValue: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  notesPanel: {
    gap: 6,
  },
  notesText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 16,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  detailButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 138,
    flexDirection: 'row',
    flexGrow: 1,
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  detailButtonText: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 15,
  },
  primaryAction: {
    alignItems: 'center',
    borderRadius: Radius.md,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryActionText: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
});
