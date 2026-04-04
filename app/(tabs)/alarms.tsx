import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { AlarmCard } from '@/components/alarm-card';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteAlarm,
  formatAlarmTime,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  resetAlarmStore,
  updateAlarm,
} from '@/lib/alarms';
import { getAlarmPhaseLabel, getAlarmPhaseTone, getPrimaryAlarm } from '@/lib/dashboard';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { resetSocialSyncState } from '@/lib/social/queue';
import { Alarm, FailureHistoryEntry, FREE_ALARM_LIMIT, SuccessHistoryEntry } from '@/types/alarm';

type AlarmScreenState = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
  progressSummary: ProgressSummary | null;
  successHistory: SuccessHistoryEntry[];
  failureHistory: FailureHistoryEntry[];
};

function formatFailureTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSuccessTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AlarmsScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [state, setState] = useState<AlarmScreenState>({
    alarms: [],
    lifetimeAlarmCreations: 0,
    progressSummary: null,
    successHistory: [],
    failureHistory: [],
  });

  const loadData = useCallback(async () => {
    await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
    const store = await readAlarmStore();

    setState({
      alarms: store.alarms,
      lifetimeAlarmCreations: store.lifetimeAlarmCreations,
      progressSummary: getProgressSummary(store),
      successHistory: store.successHistory.slice(0, 3),
      failureHistory: store.failureHistory.slice(0, 3),
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const handleCreateAlarmPress = () => {
    if (state.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      router.push('/paywall');
      return;
    }

    router.push('/create');
  };

  const handleDeleteAlarm = (alarm: Alarm) => {
    Alert.alert('Delete alarm?', `Remove the ${alarm.label} checkpoint alarm?`, [
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
      'Reschedule alarm?',
      `Schedule the ${alarm.label} alarm for its next ${alarm.repeatSchedule === 'once' ? 'available slot' : 'repeat window'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reschedule',
          onPress: async () => {
            const scheduled = await scheduleAlarmNotificationAsync(alarm);
            await cancelAlarmNotificationAsync(alarm.notificationIds);
            await updateAlarm({
              ...alarm,
              isActive: true,
              lastOutcome: undefined,
              notificationIds: scheduled.notificationIds,
              scheduledFor: scheduled.scheduledFor,
            });
            await loadData();
          },
        },
      ]
    );
  };

  const handleResetDemoData = () => {
    Alert.alert(
      'Reset local data?',
      'This clears alarms, resets the free limit, and cancels scheduled notifications on this device.',
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <PageHeader
          eyebrow="Alarms"
          title="Manage your alarms"
          description="Create, edit, reuse, or remove."
          action={<AppButton label="New" onPress={handleCreateAlarmPress} size="compact" />}
        />

        <AppCard elevated tone="muted" style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryCopy}>
              <Text style={[TextPresets.label, { color: colors.text }]}>Next scheduled</Text>
              <Text style={[styles.summaryTime, { color: colors.text }]}>
                {primaryAlarm ? formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute) : 'No alarm'}
              </Text>
              <Text style={[TextPresets.body, { color: colors.muted }]}>
                {primaryAlarm ? primaryAlarm.label : 'Create your first alarm to get started.'}
              </Text>
            </View>
            <StatusPill label={getAlarmPhaseLabel(primaryAlarm)} tone={getAlarmPhaseTone(primaryAlarm)} />
          </View>

          <View style={styles.summaryStats}>
            <MiniMetric label="Alarms" value={`${state.alarms.length}`} />
            <MiniMetric label="Free left" value={`${freeSlotsRemaining}`} />
            <MiniMetric label="Week" value={`${state.progressSummary?.weeklyStats.completionRate ?? 0}%`} />
          </View>
        </AppCard>

        <SectionHeader
          kicker="Library"
          title="Your alarms"
          description="All saved alarms in one place."
        />

        {state.alarms.length === 0 ? (
          <AppCard elevated style={styles.emptyCard}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No alarms yet</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              Create one alarm and refine it later.
            </Text>
            <AppButton label="Create alarm" onPress={handleCreateAlarmPress} />
          </AppCard>
        ) : (
          <View style={styles.alarmList}>
            {state.alarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                onDelete={handleDeleteAlarm}
                onEdit={handleEditAlarm}
                onReschedule={handleRescheduleAlarm}
                onReuse={handleReuseAlarm}
              />
            ))}
          </View>
        )}

        <SectionHeader
          kicker="Recent"
          title="Outcomes"
          description="Recent wins and misses."
        />

        <View style={styles.resultsGrid}>
          <AppCard elevated style={styles.resultsCard}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Wins</Text>
            {state.successHistory.length === 0 ? (
              <Text style={[TextPresets.body, { color: colors.muted }]}>No successful clears recorded yet.</Text>
            ) : (
              state.successHistory.map((success) => (
                <View
                  key={`${success.alarmId}-${success.confirmedAt}`}
                  style={[styles.resultItem, { borderTopColor: colors.border }]}>
                  <View style={styles.resultRow}>
                    <Text style={[TextPresets.label, { color: colors.text }]}>{success.label}</Text>
                    <Text style={[TextPresets.label, { color: colors.success }]}>{success.timeToScanSeconds}s</Text>
                  </View>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    {formatSuccessTimestamp(success.confirmedAt)}
                  </Text>
                </View>
              ))
            )}
          </AppCard>

          <AppCard elevated style={styles.resultsCard}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Misses</Text>
            {state.failureHistory.length === 0 ? (
              <Text style={[TextPresets.body, { color: colors.muted }]}>No misses recorded yet.</Text>
            ) : (
              state.failureHistory.map((failure) => (
                <View
                  key={`${failure.alarmId}-${failure.failedAt}`}
                  style={[styles.resultItem, { borderTopColor: colors.border }]}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>{failure.label}</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    {formatFailureTimestamp(failure.failedAt)}
                  </Text>
                </View>
              ))
            )}
          </AppCard>
        </View>

        {__DEV__ ? (
          <AppButton label="Reset local data" onPress={handleResetDemoData} size="compact" variant="ghost" />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.metricCard, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: 128,
  },
  summaryCard: {
    gap: Spacing.lg,
  },
  summaryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  summaryCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  summaryTime: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  summaryStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  metricCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  emptyCard: {
    gap: Spacing.md,
  },
  emptyTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 28,
  },
  alarmList: {
    gap: Spacing.md,
  },
  resultsGrid: {
    gap: Spacing.md,
  },
  resultsCard: {
    gap: Spacing.sm,
  },
  resultItem: {
    borderTopWidth: 1,
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
