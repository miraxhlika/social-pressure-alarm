import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AlarmCard } from '@/components/alarm-card';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  deleteAlarm,
  formatAlarmTime,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  rescheduleAlarm,
  resetAlarmStore,
} from '@/lib/alarms';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { cancelAlarmNotificationAsync } from '@/lib/notifications';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { resetSocialSyncState } from '@/lib/social/queue';
import { Alarm, FREE_ALARM_LIMIT } from '@/types/alarm';

type AlarmScreenState = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
  progressSummary: ProgressSummary | null;
};

export default function AlarmsScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<AlarmScreenState>({
    alarms: [],
    lifetimeAlarmCreations: 0,
    progressSummary: null,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();

      setState({
        alarms: store.alarms,
        lifetimeAlarmCreations: store.lifetimeAlarmCreations,
        progressSummary: getProgressSummary(store),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const handleCreateAlarmPress = () => {
    if (state.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      void trackAnalyticsEvent('checkpoint_limit_reached', {
        limit: FREE_ALARM_LIMIT,
        creationCount: state.lifetimeAlarmCreations,
        source: 'checkpoints_tab',
      });
      Alert.alert(
        'Checkpoint limit reached',
        `This preview build currently allows ${FREE_ALARM_LIMIT} saved checkpoints per device. Edit, reuse, or delete one that already works for you.`,
        [
          {
            text: 'Keep browsing',
            style: 'cancel',
          },
        ]
      );
      return;
    }

    router.push('/create');
  };

  const handleDeleteAlarm = (alarm: Alarm) => {
    Alert.alert('Delete checkpoint?', `Remove the ${alarm.label} checkpoint?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelAlarmNotificationAsync(alarm.notificationIds);
          await deleteAlarm(alarm.id);
          await loadData();
        },
      },
    ]);
  };

  const handleEditAlarm = (alarm: Alarm) => {
    if (alarm.lastOutcome === 'missed') {
      void trackAnalyticsEvent('miss_recovery_action', {
        checkpointId: alarm.id,
        useCaseType: alarm.useCaseType,
        repeatSchedule: alarm.repeatSchedule,
        gracePeriodSeconds: alarm.gracePeriodSeconds,
        action: 'edit',
      });
    }

    router.push({
      pathname: '/create',
      params: {
        alarmId: alarm.id,
        mode: 'edit',
      },
    });
  };

  const handleReuseAlarm = (alarm: Alarm) => {
    router.push({
      pathname: '/create',
      params: {
        alarmId: alarm.id,
        mode: 'reuse',
      },
    });
  };

  const handleRescheduleAlarm = (alarm: Alarm) => {
    Alert.alert(
      'Reschedule checkpoint?',
      `Schedule ${alarm.label} for its next ${alarm.repeatSchedule === 'once' ? 'available slot' : 'repeat window'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reschedule',
          onPress: async () => {
            await rescheduleAlarm(alarm);
            if (alarm.lastOutcome === 'missed') {
              await trackAnalyticsEvent('miss_recovery_action', {
                checkpointId: alarm.id,
                useCaseType: alarm.useCaseType,
                repeatSchedule: alarm.repeatSchedule,
                gracePeriodSeconds: alarm.gracePeriodSeconds,
                action: 'reschedule',
              });
            }
            await loadData();
          },
        },
      ]
    );
  };

  const handleOpenAlarm = (alarm: Alarm) => {
    router.push(`/ringing?alarmId=${alarm.id}`);
  };

  const handleResetDemoData = () => {
    Alert.alert(
      'Reset local data?',
      'This clears checkpoints, resets the preview limit, and cancels scheduled notifications on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Promise.all(state.alarms.map((alarm) => cancelAlarmNotificationAsync(alarm.notificationIds)));
            await Promise.all([resetAlarmStore(), resetSocialSyncState()]);
            await loadData();
          },
        },
      ]
    );
  };

  const primaryAlarm = useMemo(() => getPrimaryAlarm(state.alarms), [state.alarms]);
  const freeSlotsRemaining = Math.max(0, FREE_ALARM_LIMIT - state.lifetimeAlarmCreations);
  const uniqueUseCaseCount = new Set(state.alarms.map((alarm) => alarm.useCaseType)).size;
  const weeklyCompletionRate = state.progressSummary?.weeklyStats.attempts
    ? `${state.progressSummary.weeklyStats.completionRate}%`
    : '—';
  const weeklyCompletionHelper = state.progressSummary?.weeklyStats.attempts
    ? state.progressSummary.weeklyStats.averageTimeToClearSeconds === null
      ? `${state.progressSummary.weeklyStats.successes}/${state.progressSummary.weeklyStats.attempts} cleared`
      : `Avg clear ${state.progressSummary.weeklyStats.averageTimeToClearSeconds}s`
    : 'No attempts yet';

  return (
    <AppScreen>
      <PageHeader
        action={<AppButton label="New checkpoint" onPress={handleCreateAlarmPress} size="compact" />}
        eyebrow="Checkpoints"
        title="Checkpoint library"
        description="Keep reusable proof setups for the commitments you repeat."
      />

      {isLoading ? (
        <LoadingBlock
          description="Loading your saved checkpoints."
          style={styles.loadingBlock}
          title="Loading checkpoints"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create checkpoint"
          description="Save one checkpoint for a real commitment, then return here to adjust or reuse it instead of starting over."
          onAction={handleCreateAlarmPress}
          style={styles.emptyCard}
          title="Your library is empty"
        />
      ) : (
        <>
          <AppCard elevated tone="canvas" style={styles.summaryCard}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Reusable setups</Text>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              {state.alarms.length} checkpoint{state.alarms.length === 1 ? '' : 's'} ready to reuse
            </Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              Edit timing, proof, or accountability from any saved checkpoint below.
            </Text>
            <View style={styles.summaryRow}>
              <MiniMetric label="Use cases" value={`${uniqueUseCaseCount}`} />
              <MiniMetric helper={weeklyCompletionHelper} label="This week" value={weeklyCompletionRate} />
            </View>
            <Text style={[styles.summaryFooter, { color: colors.textSoft }]}>
              {primaryAlarm
                ? `Next up: ${formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute)} · ${primaryAlarm.label}`
                : `You can still save ${freeSlotsRemaining} more checkpoint${freeSlotsRemaining === 1 ? '' : 's'} in this preview build.`}
            </Text>
          </AppCard>

          <View style={styles.alarmList}>
            {state.alarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                onDelete={handleDeleteAlarm}
                onEdit={handleEditAlarm}
                onOpen={handleOpenAlarm}
                onReschedule={handleRescheduleAlarm}
                onReuse={handleReuseAlarm}
              />
            ))}
          </View>
        </>
      )}

      {__DEV__ ? <AppButton label="Reset local data" onPress={handleResetDemoData} size="compact" variant="ghost" /> : null}
    </AppScreen>
  );
}

function MiniMetric({ label, value, helper }: { label: string; value: string; helper?: string }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.metricCard, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      {helper ? <Text style={[styles.metricHelper, { color: colors.textSoft }]}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBlock: {
    minHeight: 180,
  },
  emptyCard: {
    minHeight: 192,
  },
  summaryCard: {
    gap: Spacing.md,
  },
  summaryTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryFooter: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  metricCard: {
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  metricValue: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  metricHelper: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  alarmList: {
    gap: Spacing.md,
  },
});
