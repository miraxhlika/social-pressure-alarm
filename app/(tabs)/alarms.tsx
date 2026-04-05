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
import {
  deleteAlarm,
  formatAlarmTime,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  resetAlarmStore,
  updateAlarm,
} from '@/lib/alarms';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { resetSocialSyncState } from '@/lib/social/queue';
import { Alarm, FREE_ALARM_LIMIT } from '@/types/alarm';

type AlarmScreenState = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
};

export default function AlarmsScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<AlarmScreenState>({
    alarms: [],
    lifetimeAlarmCreations: 0,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();

      setState({
        alarms: store.alarms,
        lifetimeAlarmCreations: store.lifetimeAlarmCreations,
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
    <AppScreen>
      <PageHeader
        action={<AppButton label="New" onPress={handleCreateAlarmPress} size="compact" />}
        eyebrow="Alarms"
        title="Saved checkpoints"
        description="Edit fast. Reuse what works."
      />

      {isLoading ? (
        <LoadingBlock
          description="Loading your saved alarms."
          style={styles.loadingBlock}
          title="Loading alarms"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create alarm"
          description="Create one checkpoint alarm, then edit or reuse it here."
          onAction={handleCreateAlarmPress}
          style={styles.emptyCard}
          title="No alarms yet"
        />
      ) : (
        <>
          <AppCard elevated tone="canvas" style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <MiniMetric label="Saved" value={`${state.alarms.length}`} />
              <MiniMetric label="New left" value={`${freeSlotsRemaining}`} />
            </View>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              {primaryAlarm
                ? `Next up: ${formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute)} · ${primaryAlarm.label}`
                : 'No next alarm scheduled yet.'}
            </Text>
          </AppCard>

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
        </>
      )}

      {__DEV__ ? <AppButton label="Reset local data" onPress={handleResetDemoData} size="compact" variant="ghost" /> : null}
    </AppScreen>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.metricCard, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
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
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
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
  alarmList: {
    gap: Spacing.md,
  },
});
