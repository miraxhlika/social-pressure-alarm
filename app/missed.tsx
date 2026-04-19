import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  formatScheduledFor,
  formatAlarmTime,
  getAlarmById,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  rescheduleAlarm,
} from '@/lib/alarms';
import { formatGracePeriodLabel, getCheckpointRoutineCopy, getUseCaseLabel } from '@/lib/checkpoint-templates';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { Alarm, FailureHistoryEntry } from '@/types/alarm';

const QUICK_RETRY_MINUTES = 15;

type MissedScreenState = {
  alarm: Alarm | null;
  latestFailure: FailureHistoryEntry | null;
  progressSummary: ProgressSummary | null;
};

type RecoveryAction = 'retry' | 'reschedule' | 'edit';

function getShareStatus(alarm: Alarm | null) {
  if (!alarm?.socialSettings?.circleId) {
    return {
      title: 'Private',
      detail: 'This miss stays on your device only.',
      tone: 'default' as const,
    };
  }

  if (alarm.socialSettings.shareMisses) {
    return {
      title: 'Miss sharing on',
      detail: 'Your circle can see this miss. Recovery actions still stay in your control.',
      tone: 'primary' as const,
    };
  }

  if (alarm.socialSettings.shareSuccesses) {
    return {
      title: 'Successes only',
      detail: 'Clears can be shared, but misses stay private unless you change the rule.',
      tone: 'warning' as const,
    };
  }

  return {
    title: 'Circle linked',
    detail: 'A circle is attached, but sharing is currently off.',
    tone: 'default' as const,
  };
}

function ActionCard({
  kicker,
  title,
  description,
  helper,
  onPress,
  disabled,
}: {
  kicker: string;
  title: string;
  description: string;
  helper: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCard,
        {
          backgroundColor: colors.elevated,
          borderColor: colors.line,
          opacity: disabled ? 0.45 : pressed ? 0.92 : 1,
        },
      ]}>
      <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{kicker}</Text>
      <Text style={[styles.actionTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[TextPresets.body, { color: colors.textSoft }]}>{description}</Text>
      <Text style={[styles.actionHelper, { color: colors.muted }]}>{helper}</Text>
    </Pressable>
  );
}

export default function MissedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [processingAction, setProcessingAction] = useState<RecoveryAction | null>(null);
  const [state, setState] = useState<MissedScreenState>({
    alarm: null,
    latestFailure: null,
    progressSummary: null,
  });

  const loadScreen = useCallback(async () => {
    if (!params.alarmId) {
      setState({
        alarm: null,
        latestFailure: null,
        progressSummary: null,
      });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const [store, alarm] = await Promise.all([readAlarmStore(), getAlarmById(params.alarmId)]);
      const latestFailure = store.failureHistory.find((entry) => entry.alarmId === params.alarmId) ?? null;

      setState({
        alarm,
        latestFailure,
        progressSummary: getProgressSummary(store),
      });
    } finally {
      setIsLoading(false);
    }
  }, [params.alarmId]);

  useFocusEffect(
    useCallback(() => {
      void loadScreen();
    }, [loadScreen])
  );

  const retryAt = useMemo(() => {
    const nextRetryAt = new Date(Date.now() + QUICK_RETRY_MINUTES * 60 * 1000);
    nextRetryAt.setSeconds(0, 0);
    return nextRetryAt;
  }, []);

  const shareStatus = useMemo(() => getShareStatus(state.alarm), [state.alarm]);
  const weeklyStats = state.progressSummary?.weeklyStats;
  const nextRunLabel =
    state.alarm?.isActive && state.alarm.scheduledFor ? formatScheduledFor(state.alarm.scheduledFor) : 'Not scheduled';
  const missedAtLabel = state.latestFailure
    ? state.latestFailure.scheduledFor
      ? formatScheduledFor(state.latestFailure.scheduledFor)
      : new Date(state.latestFailure.failedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
    : 'recently';
  const recoveryRoutine = getCheckpointRoutineCopy(state.alarm?.useCaseType);
  const retryLabel = `Retry at ${retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const rescheduleLabel =
    state.alarm?.repeatSchedule === 'once' ? 'Reschedule the next run' : 'Refresh the next scheduled run';

  const handleRecoveryAction = useCallback(
    async (action: RecoveryAction, runAction: () => Promise<void>) => {
      if (!state.alarm || processingAction) {
        return;
      }

      setProcessingAction(action);

      try {
        await runAction();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The recovery action could not be completed right now.';

        Alert.alert('Unable to update checkpoint', message);
      } finally {
        setProcessingAction(null);
      }
    },
    [processingAction, state.alarm]
  );

  const handleRetryLater = useCallback(() => {
    void handleRecoveryAction('retry', async () => {
      if (!state.alarm) {
        return;
      }

      const nextAlarm = await rescheduleAlarm(state.alarm, {
        scheduledFor: retryAt.toISOString(),
      });

      if (!nextAlarm) {
        throw new Error('Checkpoint not found.');
      }

      await trackAnalyticsEvent('miss_recovery_action', {
        checkpointId: state.alarm.id,
        useCaseType: state.alarm.useCaseType,
        repeatSchedule: state.alarm.repeatSchedule,
        gracePeriodSeconds: state.alarm.gracePeriodSeconds,
        action: 'retry',
      });

      router.replace('/');
    });
  }, [handleRecoveryAction, retryAt, router, state.alarm]);

  const handleReschedule = useCallback(() => {
    void handleRecoveryAction('reschedule', async () => {
      if (!state.alarm) {
        return;
      }

      const nextAlarm = await rescheduleAlarm(state.alarm);

      if (!nextAlarm) {
        throw new Error('Checkpoint not found.');
      }

      await trackAnalyticsEvent('miss_recovery_action', {
        checkpointId: state.alarm.id,
        useCaseType: state.alarm.useCaseType,
        repeatSchedule: state.alarm.repeatSchedule,
        gracePeriodSeconds: state.alarm.gracePeriodSeconds,
        action: 'reschedule',
      });

      router.replace('/');
    });
  }, [handleRecoveryAction, router, state.alarm]);

  const handleEdit = useCallback(
    (recoveryFocus: 'grace' | 'time') => {
      void handleRecoveryAction('edit', async () => {
        if (!state.alarm) {
          return;
        }

        await trackAnalyticsEvent('miss_recovery_action', {
          checkpointId: state.alarm.id,
          useCaseType: state.alarm.useCaseType,
          repeatSchedule: state.alarm.repeatSchedule,
          gracePeriodSeconds: state.alarm.gracePeriodSeconds,
          action: 'edit',
        });

        router.push({
          pathname: '/create',
          params: {
            alarmId: state.alarm.id,
            mode: 'edit',
            recoveryFocus,
          },
        });
      });
    },
    [handleRecoveryAction, router, state.alarm]
  );

  if (isLoading) {
    return (
      <AppScreen>
        <LoadingBlock
          description="Loading the missed checkpoint and the next recovery options."
          style={styles.loadingBlock}
          title="Preparing recovery"
          tone="canvas"
        />
      </AppScreen>
    );
  }

  if (!state.alarm) {
    return (
      <AppScreen>
        <PageHeader
          eyebrow="Recovery"
          badgeLabel="Unavailable"
          badgeTone="warning"
          title="Checkpoint not found"
          description="The missed run was recorded, but the checkpoint itself is no longer available."
        />
        <AppCard elevated tone="canvas">
          <Text style={[TextPresets.body, { color: colors.textSoft }]}>
            Return to Today or the checkpoint library to set up the next commitment.
          </Text>
          <AppButton label="Back to today" onPress={() => router.replace('/')} />
        </AppCard>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <PageHeader
        eyebrow="Recovery"
        badgeLabel="Miss recorded"
        badgeTone="danger"
        title="Recover the setup, not your mood."
        description="The miss is already logged. Pick the smallest change that gives this checkpoint a better chance next time."
      />

      <AppCard elevated tone="danger" variant="hero" style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroCopy}>
            <Text style={[TextPresets.eyebrow, { color: colors.danger }]}>Missed checkpoint</Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>{state.alarm.label}</Text>
            <Text style={[TextPresets.bodyLg, { color: colors.textSoft }]}>
              Missed around {missedAtLabel}. The goal now is protecting your next {recoveryRoutine}, not pretending this one did not happen.
            </Text>
          </View>
          <StatusPill label={getUseCaseLabel(state.alarm.useCaseType)} tone="danger" />
        </View>

        <View style={styles.metricRow}>
          <StatTile
            helper={formatGracePeriodLabel(state.alarm.gracePeriodSeconds)}
            label="Reach window"
            tone="danger"
            value={formatAlarmTime(state.alarm.hour, state.alarm.minute)}
          />
          <StatTile
            helper={weeklyStats?.attempts ? `${weeklyStats.successes}/${weeklyStats.attempts} cleared` : 'No weekly baseline yet'}
            label="This week"
            tone="primary"
            value={weeklyStats?.attempts ? `${weeklyStats.completionRate}%` : '—'}
          />
        </View>
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={styles.statusBlock}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next run</Text>
            <Text style={[styles.statusValue, { color: colors.text }]}>{nextRunLabel}</Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              {state.alarm.isActive
                ? 'A future run is already on the calendar. You can keep it, move it, or retry sooner.'
                : 'No future run is active yet. Choose whether to retry soon or reschedule the checkpoint.'}
            </Text>
          </View>

          <View style={[styles.accountabilityCard, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Accountability</Text>
            <View style={styles.accountabilityHeader}>
              <Text style={[styles.accountabilityTitle, { color: colors.text }]}>{shareStatus.title}</Text>
              <StatusPill label={shareStatus.title} tone={shareStatus.tone} />
            </View>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>{shareStatus.detail}</Text>
          </View>
        </View>
      </AppCard>

      <View style={styles.actionsGrid}>
        <ActionCard
          disabled={processingAction !== null}
          description="Keep the same code and try again soon while the routine is still top of mind."
          helper={processingAction === 'retry' ? 'Scheduling...' : retryLabel}
          kicker="Fast recovery"
          onPress={handleRetryLater}
          title={`Retry in ${QUICK_RETRY_MINUTES} minutes`}
        />
        <ActionCard
          disabled={processingAction !== null}
          description="Put the checkpoint back on the calendar and protect the next full attempt."
          helper={processingAction === 'reschedule' ? 'Updating schedule...' : nextRunLabel}
          kicker="Reschedule"
          onPress={handleReschedule}
          title={rescheduleLabel}
        />
        <ActionCard
          disabled={processingAction !== null}
          description="Move the trigger to a more realistic moment without changing the proof itself."
          helper="Open edit flow on timing"
          kicker="Timing"
          onPress={() => handleEdit('time')}
          title="Adjust the trigger time"
        />
        <ActionCard
          disabled={processingAction !== null}
          description="Give yourself a slightly wider reach window if the setup is too tight in practice."
          helper="Open edit flow on reach time"
          kicker="Reach window"
          onPress={() => handleEdit('grace')}
          title="Adjust the grace period"
        />
      </View>

      <AppButton
        label="Back to today"
        onPress={() => router.replace('/')}
        variant="ghost"
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingBlock: {
    minHeight: 220,
  },
  heroCard: {
    gap: Spacing.lg,
  },
  heroHeader: {
    gap: Spacing.md,
  },
  heroCopy: {
    gap: Spacing.sm,
  },
  heroTitle: {
    ...TextPresets.titleLg,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  statusCard: {
    gap: Spacing.md,
  },
  statusRow: {
    gap: Spacing.md,
  },
  statusBlock: {
    gap: Spacing.sm,
  },
  statusValue: {
    fontFamily: Fonts.rounded,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  accountabilityCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  accountabilityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  accountabilityTitle: {
    ...TextPresets.label,
    flex: 1,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  actionCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: Spacing.sm,
    minHeight: 168,
    padding: Spacing.lg,
  },
  actionTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  actionHelper: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 'auto',
  },
});
