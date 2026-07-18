import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
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
  ALARM_RUNTIME_CACHE_MAX_AGE_MS,
  deleteAlarm,
  formatAlarmRuntimeTime,
  formatAlarmTime,
  formatRepeatSchedule,
  getAlarmPhase,
  getCachedHydratedAlarmStoreForScope,
  hydrateAlarmRuntimeForCurrentUser,
  rescheduleAlarm,
  updateAlarm,
} from '@/lib/alarms';
import { formatGracePeriodLabel, getUseCaseLabel } from '@/lib/checkpoint-templates';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { getCheckpointSocialDescription } from '@/lib/social/settings';
import { GUEST_STORAGE_SCOPE } from '@/lib/storage';
import { useAppDialog } from '@/providers/app-dialog-provider';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, AlarmProofCodeType, AlarmStore, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type CheckpointDetailsState = {
  alarm: Alarm | null;
  progressSummary: ProgressSummary | null;
  successes: SuccessHistoryEntry[];
  failures: FailureHistoryEntry[];
  currentStreak: number;
  longestStreak: number;
};

function createEmptyCheckpointDetailsState(): CheckpointDetailsState {
  return {
    alarm: null,
    progressSummary: null,
    successes: [],
    failures: [],
    currentStreak: 0,
    longestStreak: 0,
  };
}

function getCheckpointDetailsKey(storageScope: string, checkpointId: string) {
  return `${storageScope}:${checkpointId}`;
}

function getCheckpointDetailsState(store: AlarmStore, checkpointId: string): CheckpointDetailsState {
  return {
    alarm: store.alarms.find((candidate) => candidate.id === checkpointId) ?? null,
    progressSummary: getProgressSummary(store),
    successes: store.successHistory.filter((entry) => entry.alarmId === checkpointId),
    failures: store.failureHistory.filter((entry) => entry.alarmId === checkpointId),
    currentStreak: store.currentStreak,
    longestStreak: store.longestStreak,
  };
}

function getCachedCheckpointDetailsState(checkpointId: string, storageScope: string) {
  const cachedStore = getCachedHydratedAlarmStoreForScope(storageScope);

  return cachedStore ? getCheckpointDetailsState(cachedStore, checkpointId) : null;
}

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
  const { isLoading: isSocialSessionLoading, user } = useSocialSession();
  const checkpointId = typeof params.id === 'string' ? params.id : undefined;
  const storageScope = isSocialSessionLoading ? null : user?.id ?? GUEST_STORAGE_SCOPE;
  const initialDetailsState =
    checkpointId && storageScope ? getCachedCheckpointDetailsState(checkpointId, storageScope) : null;
  const initialDetailsKey =
    checkpointId && storageScope && initialDetailsState ? getCheckpointDetailsKey(storageScope, checkpointId) : null;
  const loadedDetailsKeyRef = useRef<string | null>(initialDetailsKey);
  const loadDetailsRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(!initialDetailsState);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<CheckpointDetailsState>(
    initialDetailsState ?? createEmptyCheckpointDetailsState
  );

  const loadDetails = useCallback(async () => {
    const requestId = loadDetailsRequestRef.current + 1;
    loadDetailsRequestRef.current = requestId;

    if (!checkpointId) {
      loadedDetailsKeyRef.current = null;
      setLoadError('');
      setState(createEmptyCheckpointDetailsState());
      setIsLoading(false);
      return;
    }

    if (!storageScope) {
      setIsLoading(true);
      return;
    }

    const detailsKey = getCheckpointDetailsKey(storageScope, checkpointId);
    const cachedDetailsState = getCachedCheckpointDetailsState(checkpointId, storageScope);
    const hasLoadedDetails = loadedDetailsKeyRef.current === detailsKey;

    if (cachedDetailsState && !hasLoadedDetails) {
      loadedDetailsKeyRef.current = detailsKey;
      setLoadError('');
      setState(cachedDetailsState);
    }

    if (!cachedDetailsState && !hasLoadedDetails) {
      setState(createEmptyCheckpointDetailsState());
      setIsLoading(true);
    } else {
      setIsLoading(false);
    }

    try {
      const store = await hydrateAlarmRuntimeForCurrentUser({ maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS });

      if (loadDetailsRequestRef.current === requestId) {
        setLoadError('');
        setState(getCheckpointDetailsState(store, checkpointId));
      }
    } catch (error) {
      if (loadDetailsRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : 'Checkpoint details could not be loaded right now.');
      }
    } finally {
      if (loadDetailsRequestRef.current === requestId) {
        loadedDetailsKeyRef.current = detailsKey;
        setIsLoading(false);
      }
    }
  }, [checkpointId, storageScope]);

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

    await updateAlarm({
      ...alarm,
      isActive: false,
      notificationIds: undefined,
      notificationRegistrations: undefined,
      notificationStrategyKey: undefined,
      scheduledFor: undefined,
    });
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

  if (isLoading && !alarm) {
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
