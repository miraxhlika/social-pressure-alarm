import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { ActionRow, ActionRowGlyph } from '@/components/ui/action-row';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteAlarm,
  formatAlarmTime,
  formatRepeatSchedule,
  formatScheduledFor,
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
import { Alarm, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type CheckpointDetailsState = {
  alarm: Alarm | null;
  progressSummary: ProgressSummary | null;
  successes: SuccessHistoryEntry[];
  failures: FailureHistoryEntry[];
};

function getProofPreview(payload: string) {
  if (payload.length <= 20) {
    return payload;
  }

  return `${payload.slice(0, 10)}...${payload.slice(-8)}`;
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
      return { label: 'Cleared', tone: 'success' as const };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'primary' as const };
    default:
      return { label: 'Draft', tone: 'default' as const };
  }
}

export default function CheckpointDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<CheckpointDetailsState>({
    alarm: null,
    progressSummary: null,
    successes: [],
    failures: [],
  });

  const loadDetails = useCallback(async () => {
    if (!params.id) {
      setState({ alarm: null, progressSummary: null, successes: [], failures: [] });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const [store, alarm] = await Promise.all([readAlarmStore(), getAlarmById(params.id)]);

      setState({
        alarm,
        progressSummary: getProgressSummary(store),
        successes: store.successHistory.filter((entry) => entry.alarmId === params.id),
        failures: store.failureHistory.filter((entry) => entry.alarmId === params.id),
      });
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useFocusEffect(
    useCallback(() => {
      void loadDetails();
    }, [loadDetails])
  );

  const alarm = state.alarm;
  const phase = useMemo(() => getPhaseCopy(alarm), [alarm]);
  const attemptCount = state.successes.length + state.failures.length;
  const clearRate = attemptCount === 0 ? '—' : `${Math.round((state.successes.length / attemptCount) * 100)}%`;
  const latestEvent = [...state.successes, ...state.failures]
    .map((entry) =>
      'confirmedAt' in entry
        ? { label: 'Cleared', title: entry.label, at: entry.confirmedAt, tone: 'success' as const }
        : { label: 'Missed', title: entry.label, at: entry.failedAt, tone: 'danger' as const }
    )
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())[0];

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

  if (isLoading) {
    return (
      <AppScreen>
        <LoadingBlock title="Loading checkpoint" description="Fetching schedule, proof setup, and history." />
      </AppScreen>
    );
  }

  if (!alarm) {
    return (
      <AppScreen>
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
    <AppScreen>
      <PageHeader
        action={
          <AppButton
            label="Edit"
            onPress={() =>
              router.push({
                pathname: '/create',
                params: {
                  alarmId: alarm.id,
                  mode: 'edit',
                  returnTo: `/checkpoint/${alarm.id}`,
                },
              })
            }
            size="compact"
          />
        }
        badgeLabel={phase.label}
        badgeTone={phase.tone}
        eyebrow="Checkpoint details"
        title={alarm.label}
        description="Inspect the saved proof, schedule, recovery history, and controls for this checkpoint."
      />

      <AppCard elevated tone="primary" variant="hero" style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroCopy}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next run</Text>
            <Text style={[styles.heroTime, { color: colors.text }]}>{formatAlarmTime(alarm.hour, alarm.minute)}</Text>
            <Text style={[TextPresets.bodyLg, { color: colors.textSoft }]}>{formatScheduledFor(alarm.scheduledFor)}</Text>
          </View>
          <StatusPill label={getUseCaseLabel(alarm.useCaseType)} tone="primary" />
        </View>

        <View style={styles.statRow}>
          <StatTile
            helper={`${state.successes.length}/${attemptCount} cleared`}
            label="Reliability"
            progress={attemptCount > 0 ? state.successes.length / attemptCount : 0}
            progressLabel={`${alarm.label} reliability progress`}
            tone="primary"
            value={clearRate}
          />
          <StatTile
            helper="Current app streak"
            label="Streak"
            progress={state.progressSummary?.milestoneProgress.progressRatio ?? 0}
            progressLabel="Current streak milestone progress"
            tone="success"
            value={`${state.progressSummary?.milestoneProgress.currentLabel ?? 'Start'}`}
          />
        </View>
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Proof setup</Text>
        <ActionRow
          description={alarm.placeObject || 'No place/object label saved yet.'}
          leading={<ActionRowGlyph label="P" />}
          onPress={() =>
            router.push({
              pathname: '/create',
              params: {
                alarmId: alarm.id,
                mode: 'edit',
                recoveryFocus: 'code',
                returnTo: `/checkpoint/${alarm.id}`,
              },
            })
          }
          statusLabel={alarm.proofStrictness === 'strict' ? 'Strict' : 'Standard'}
          statusTone="primary"
          title="Place / object"
        />
        <ActionRow
          description={getProofPreview(alarm.expectedQrPayload)}
          leading={<ActionRowGlyph label="Q" />}
          onPress={() =>
            router.push({
              pathname: '/create',
              params: {
                alarmId: alarm.id,
                mode: 'edit',
                recoveryFocus: 'code',
                returnTo: `/checkpoint/${alarm.id}`,
              },
            })
          }
          statusLabel="Exact match"
          statusTone="success"
          title="Linked QR / barcode"
        />
        {alarm.notes ? (
          <ActionRow description={alarm.notes} leading={<ActionRowGlyph label="N" />} title="Notes" />
        ) : null}
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Schedule</Text>
        <View style={styles.detailGrid}>
          <DetailTile label="Recurrence" value={formatRepeatSchedule(alarm.repeatSchedule)} />
          <DetailTile label="Reach window" value={formatGracePeriodLabel(alarm.gracePeriodSeconds)} />
          <DetailTile label="Sharing" value={alarm.socialSettings?.circleId ? 'Circle linked' : 'Private'} />
          <DetailTile label="Created" value={new Date(alarm.createdAt).toLocaleDateString()} />
        </View>
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent history</Text>
        {latestEvent ? (
          <ActionRow
            description={new Date(latestEvent.at).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            statusLabel={latestEvent.label}
            statusTone={latestEvent.tone}
            title={latestEvent.title}
          />
        ) : (
          <Text style={[TextPresets.body, { color: colors.textSoft }]}>
            No clears or misses yet. The first live run will create this history.
          </Text>
        )}
        <AppButton label="Open full history" onPress={() => router.push('/history')} variant="secondary" />
      </AppCard>

      <View style={styles.actionRow}>
        {getAlarmPhase(alarm) === 'ringing' ? (
          <AppButton label="Open live run" onPress={() => router.push(`/ringing?alarmId=${alarm.id}`)} style={styles.flexAction} />
        ) : (
          <AppButton
            label={alarm.isActive ? 'Reschedule' : 'Resume'}
            onPress={async () => {
              await rescheduleAlarm(alarm);
              await loadDetails();
            }}
            style={styles.flexAction}
          />
        )}
        <AppButton label="Pause" onPress={handlePause} style={styles.flexAction} variant="secondary" />
      </View>
      <AppButton label="Delete checkpoint" onPress={handleDelete} variant="danger" />
    </AppScreen>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.detailTile, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: 46,
    fontWeight: '800',
    lineHeight: 50,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  sectionCard: {
    gap: Spacing.md,
  },
  sectionTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  detailTile: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  detailValue: {
    ...TextPresets.label,
    fontSize: 16,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  flexAction: {
    flex: 1,
    minWidth: 140,
  },
});
