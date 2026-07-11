import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowPanel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import {
  FlowProgressBar,
} from '@/components/ui/flow-visuals';
import { LoadingBlock } from '@/components/ui/loading-block';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteAlarm,
  formatAlarmRuntimeTime,
  formatAlarmTime,
  formatRepeatSchedule,
  getAlarmById,
  getAlarmPhase,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  rescheduleAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { formatGracePeriodLabel, getUseCaseLabel } from '@/lib/checkpoint-templates';
import { cancelAlarmNotificationAsync } from '@/lib/notifications';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { getCheckpointSocialDescription } from '@/lib/social/settings';
import { useAppDialog } from '@/providers/app-dialog-provider';
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

  return alarm.isActive && alarm.scheduledFor
    ? formatScheduledForCompact(alarm.scheduledFor)
    : `One-time · ${time}`;
}

function getHeroCategory(phase: ReturnType<typeof getAlarmPhase>) {
  switch (phase) {
    case 'ringing':
      return 'LIVE NOW';
    case 'missed':
      return 'MISSED RUN';
    case 'scheduled':
      return 'NEXT RUN';
    default:
      return 'SAVED TIME';
  }
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
  const { alert, confirm } = useAppDialog();
  const params = useLocalSearchParams<{ id?: string }>();
  const colors = getAppColors(useColorScheme());
  const loadedDetailsIdRef = useRef<string | null>(null);
  const loadDetailsRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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
      setLoadError('');
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
      await hydrateAlarmRuntimeForCurrentUser();
      const [store, alarm] = await Promise.all([readAlarmStore(), getAlarmById(checkpointId)]);

      if (loadDetailsRequestRef.current === requestId) {
        setLoadError('');
        setState({
          alarm,
          progressSummary: getProgressSummary(store),
          successes: store.successHistory.filter((entry) => entry.alarmId === checkpointId),
          failures: store.failureHistory.filter((entry) => entry.alarmId === checkpointId),
          currentStreak: store.currentStreak,
          longestStreak: store.longestStreak,
        });
      }
    } catch (error) {
      if (loadDetailsRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : 'Checkpoint details could not be loaded right now.');
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
  const alarmPhase = alarm ? getAlarmPhase(alarm) : 'unscheduled';

  const handlePause = useCallback(async () => {
    if (!alarm) {
      return;
    }

    const shouldPause = await confirm({
      confirmLabel: 'Pause checkpoint',
      description: `${alarm.label} will stay saved with its history, but future notifications will stop.`,
      icon: 'pause-outline',
      title: 'Pause checkpoint?',
      tone: 'warning',
    });

    if (!shouldPause) {
      return;
    }

    await cancelAlarmNotificationAsync(alarm.notificationIds);
    await updateAlarm({ ...alarm, isActive: false, notificationIds: undefined, scheduledFor: undefined });
    await loadDetails();
  }, [alarm, confirm, loadDetails]);

  const handleDelete = useCallback(async () => {
    if (!alarm) {
      return;
    }

    const shouldDelete = await confirm({
      confirmLabel: 'Delete checkpoint',
      description: `Remove ${alarm.label} from your saved checkpoints? Past results will remain in your history.`,
      icon: 'trash-outline',
      title: 'Delete checkpoint?',
      tone: 'danger',
    });

    if (!shouldDelete) {
      return;
    }

    await cancelAlarmNotificationAsync(alarm.notificationIds);
    await deleteAlarm(alarm.id);
    router.replace('/(tabs)/alarms');
  }, [alarm, confirm, router]);

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

    try {
      await rescheduleAlarm(alarm);
      await loadDetails();
    } catch (error) {
      await alert({
        description: error instanceof Error ? error.message : 'The reminder could not be scheduled right now.',
        icon: 'cloud-offline-outline',
        title: 'Unable to reschedule',
        tone: 'warning',
      });
    }
  }, [alarm, alert, loadDetails]);

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock
          description="Fetching schedule, proof setup, and history."
          layout="detail"
          title="Loading checkpoint"
        />
      </AppScreen>
    );
  }

  if (loadError) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <FlowTopBar
          leftAccessibilityLabel="Go back"
          leftIcon="chevron-back"
          onLeftPress={() => router.back()}
          title="Checkpoint"
        />
        <EmptyState
          actionLabel="Try again"
          description={loadError}
          onAction={() => void loadDetails()}
          title="Checkpoint could not be loaded"
          tone="danger"
        />
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
          title="Checkpoint"
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
        onRightPress={() => handleEdit()}
        rightAccessibilityLabel="Edit checkpoint"
        rightIcon="create-outline"
        subtitle={getUseCaseLabel(alarm.useCaseType)}
        title={alarm.label}
      />

      <View style={[styles.heroPanel, { backgroundColor: colors.panelMuted }]}>
        <View style={styles.heroHeader}>
          <Text style={[styles.heroCategory, { color: colors.textSoft }]}>{getHeroCategory(alarmPhase)}</Text>
          <StatusPill label={phase.label} tone={phase.tone} />
        </View>
        <Text style={[styles.heroTime, { color: colors.text }]}>{formatAlarmRuntimeTime(alarm)}</Text>
        <View style={styles.heroMeta}>
          <Ionicons color={colors.primary} name="repeat-outline" size={15} />
          <Text style={[styles.heroMetaText, { color: colors.textSoft }]}>
            {formatRepeatSchedule(alarm.repeatSchedule)} · {formatGracePeriodLabel(alarm.gracePeriodSeconds)} to complete
          </Text>
        </View>
        {alarmPhase === 'ringing' || alarmPhase === 'missed' || alarmPhase === 'inactive' ? (
          <Pressable
            accessibilityRole="button"
            onPress={alarmPhase === 'ringing' ? () => router.push(`/ringing?alarmId=${alarm.id}`) : handleReschedule}
            style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.text }, pressed && styles.pressed]}>
            <Text style={[styles.primaryActionText, { color: colors.elevated }]}>
              {alarmPhase === 'ringing' ? 'Open live run' : alarmPhase === 'missed' ? 'Reschedule' : 'Resume checkpoint'}
            </Text>
            <Ionicons color={colors.elevated} name="arrow-forward" size={16} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Setup</Text>
        <View style={[styles.setupPanel, { backgroundColor: colors.panelMuted }]}>
          <SetupRow
            icon="calendar-outline"
            label="Schedule"
            value={formatScheduleLine(alarm)}
          />
          <SetupRow
            icon="qr-code-outline"
            label="Proof"
            value={`${proofCodeLabel}${alarm.placeObject && alarm.placeObject !== alarm.label ? ` · ${alarm.placeObject}` : ''}`}
          />
          <SetupRow
            icon="people-outline"
            label="Accountability"
            showDivider={false}
            value={getCheckpointSocialDescription(alarm.socialSettings)}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Results</Text>
        <View style={[styles.reliabilityPanel, { backgroundColor: colors.panelMuted }]}>
          <View style={styles.reliabilityHeader}>
            <View>
              <Text style={[styles.reliabilityValue, { color: colors.text }]}>{clearRateValue}%</Text>
              <Text style={[styles.reliabilityTitle, { color: colors.textSoft }]}>completion rate</Text>
            </View>
            <Text style={[styles.resultCount, { color: colors.textSoft }]}>
              {state.successes.length} of {attemptCount} completed
            </Text>
          </View>
          <FlowProgressBar progress={clearRateValue / 100} tone="success" />
          <Text style={[styles.progressHelper, { color: colors.textSoft }]}>
            {attemptCount === 0
              ? 'Results will appear after the first run.'
              : `${state.failures.length} missed · based on this checkpoint only`}
          </Text>
        </View>
      </View>

      {alarm.notes ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Notes</Text>
          <Text style={[styles.notesText, { color: colors.textSoft }]}>{alarm.notes}</Text>
        </View>
      ) : null}

      <View style={styles.optionsSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Manage checkpoint</Text>
        <View style={[styles.optionsPanel, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
          {alarm.isActive ? (
            <DetailActionRow
              accessibilityHint="Stops scheduled runs until resumed"
              description="Stop future alerts while keeping its setup and history."
              icon="pause-outline"
              label="Pause checkpoint"
              onPress={handlePause}
              showDivider
            />
          ) : null}
          <DetailActionRow
            accessibilityHint="Deletes this checkpoint but keeps its past history"
            description="Remove this checkpoint while preserving past results."
            destructive
            icon="trash-outline"
            label="Delete checkpoint"
            onPress={handleDelete}
          />
        </View>
      </View>
    </AppScreen>
  );
}

function SetupRow({
  icon,
  label,
  showDivider = true,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  showDivider?: boolean;
  value: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.setupRow, showDivider && { borderBottomColor: colors.line, borderBottomWidth: 1 }]}>
      <View style={[styles.setupIcon, { backgroundColor: colors.primarySurface }]}>
        <Ionicons color={colors.primary} name={icon} size={17} />
      </View>
      <View style={styles.setupCopy}>
        <Text style={[styles.setupLabel, { color: colors.textSoft }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.setupValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
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

function DetailActionRow({
  accessibilityHint,
  description,
  destructive,
  icon,
  label,
  onPress,
  showDivider,
}: {
  accessibilityHint?: string;
  description: string;
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const colors = getAppColors(useColorScheme());
  const color = destructive ? colors.danger : colors.text;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.detailActionRow,
        showDivider && { borderBottomColor: colors.line, borderBottomWidth: 1 },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.detailActionIcon, { backgroundColor: destructive ? colors.dangerSurface : colors.elevated }]}>
        <Ionicons color={color} name={icon} size={19} />
      </View>
      <View style={styles.detailActionCopy}>
        <Text style={[styles.detailActionLabel, { color }]}>{label}</Text>
        <Text style={[styles.detailActionDescription, { color: colors.textSoft }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: Spacing.lg,
    paddingBottom: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  heroPanel: {
    borderRadius: Radius.lg,
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  heroCategory: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 14,
  },
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 44,
  },
  heroMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  heroMetaText: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  section: {
    gap: Spacing.md,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
    paddingHorizontal: Spacing.xs,
  },
  setupPanel: {
    borderRadius: Radius.md,
    gap: 0,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
  },
  setupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 66,
    paddingVertical: Spacing.sm,
  },
  setupIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  setupCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  setupLabel: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  setupValue: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
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
    fontFamily: Fonts.rounded,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.35,
    lineHeight: 27,
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
    borderRadius: Radius.md,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  reliabilityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reliabilityTitle: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  reliabilityValue: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  streakSummary: {
    alignItems: 'flex-end',
    gap: 1,
  },
  streakValue: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  streakLabel: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  progressHelper: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  resultCount: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 16,
  },
  notesPanel: {
    gap: 6,
  },
  notesText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 16,
  },
  optionsSection: {
    gap: Spacing.sm,
  },
  optionsPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: Spacing.sm,
  },
  detailActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 68,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  detailActionIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  detailActionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  detailActionLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  detailActionDescription: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  primaryAction: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    marginTop: Spacing.md,
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
