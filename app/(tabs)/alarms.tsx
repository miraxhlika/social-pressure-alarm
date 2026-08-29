import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AlarmCard } from '@/components/alarm-card';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { FlowFooterButton, FlowTopBar } from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  ALARM_RUNTIME_CACHE_MAX_AGE_MS,
  deleteAlarm,
  formatAlarmRuntimeTime,
  hydrateAlarmRuntimeForCurrentUser,
  rescheduleAlarm,
} from '@/lib/alarms';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { SOCIAL_CIRCLES_CACHE_MAX_AGE_MS, listMySocialCircles } from '@/lib/social/circles';
import { useAppDialog } from '@/providers/app-dialog-provider';
import { Alarm } from '@/types/alarm';

type AlarmScreenState = {
  alarms: Alarm[];
  circleNamesById: Record<string, string>;
  progressSummary: ProgressSummary | null;
};

export default function AlarmsScreen() {
  const router = useRouter();
  const { alert, confirm } = useAppDialog();
  const colors = getAppColors(useColorScheme());
  const hasLoadedAlarmsRef = useRef(false);
  const loadAlarmsRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<AlarmScreenState>({
    alarms: [],
    circleNamesById: {},
    progressSummary: null,
  });

  const loadData = useCallback(async () => {
    const requestId = loadAlarmsRequestRef.current + 1;
    loadAlarmsRequestRef.current = requestId;

    if (!hasLoadedAlarmsRef.current) {
      setIsLoading(true);
    }

    try {
      const store = await hydrateAlarmRuntimeForCurrentUser({ maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS });
      const hasSharedCheckpoints = store.alarms.some((alarm) => alarm.socialSettings?.circleId);
      const circles = hasSharedCheckpoints
        ? await listMySocialCircles({ maxAgeMs: SOCIAL_CIRCLES_CACHE_MAX_AGE_MS }).catch(() => [])
        : [];

      if (loadAlarmsRequestRef.current === requestId) {
        setLoadError('');
        setState({
          alarms: store.alarms,
          circleNamesById: Object.fromEntries(circles.map((circle) => [circle.id, circle.name])),
          progressSummary: getProgressSummary(store),
        });
      }
    } catch (error) {
      if (loadAlarmsRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : 'Checkpoints could not be loaded right now.');
      }
    } finally {
      if (loadAlarmsRequestRef.current === requestId) {
        hasLoadedAlarmsRef.current = true;
        setIsLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const handleCreateAlarmPress = useCallback(() => {
    router.push({ pathname: '/create', params: { returnTo: '/alarms' } });
  }, [router]);

  const handleDeleteAlarm = useCallback(async (alarm: Alarm) => {
    const shouldDelete = await confirm({
      confirmLabel: 'Delete checkpoint',
      description: `Remove ${alarm.label} from your saved checkpoints? Past results will stay in your history.`,
      icon: 'trash-outline',
      title: 'Delete checkpoint?',
      tone: 'danger',
    });

    if (!shouldDelete) {
      return;
    }

    await deleteAlarm(alarm.id);
    await loadData();
  }, [confirm, loadData]);

  const handleEditAlarm = useCallback((alarm: Alarm) => {
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
        returnTo: '/alarms',
      },
    });
  }, [router]);

  const handleReuseAlarm = useCallback((alarm: Alarm) => {
    router.push({
      pathname: '/create',
      params: {
        alarmId: alarm.id,
        mode: 'reuse',
        returnTo: '/alarms',
      },
    });
  }, [router]);

  const handleRescheduleAlarm = useCallback(async (alarm: Alarm) => {
    const scheduleWindow = alarm.repeatSchedule === 'once' ? 'next available time' : 'next repeat window';
    const shouldReschedule = await confirm({
      confirmLabel: 'Reschedule',
      description: `${alarm.label} will keep its current setup and be scheduled for its ${scheduleWindow}.`,
      icon: 'calendar-outline',
      title: 'Schedule another attempt?',
    });

    if (!shouldReschedule) {
      return;
    }

    try {
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
    } catch (error) {
      await alert({
        description: error instanceof Error ? error.message : 'The reminder could not be scheduled right now.',
        icon: 'cloud-offline-outline',
        title: 'Unable to reschedule',
        tone: 'warning',
      });
    }
  }, [alert, confirm, loadData]);

  const handleOpenAlarm = useCallback((alarm: Alarm) => {
    router.push(`/ringing?alarmId=${alarm.id}`);
  }, [router]);

  const handleOpenDetails = useCallback((alarm: Alarm) => {
    router.push(`/checkpoint/${alarm.id}`);
  }, [router]);

  const primaryAlarm = useMemo(() => getPrimaryAlarm(state.alarms), [state.alarms]);
  const weeklyCompletionRate = state.progressSummary?.weeklyStats.attempts
    ? `${state.progressSummary.weeklyStats.completionRate}%`
    : '—';
  const weeklyCompletionHelper = state.progressSummary?.weeklyStats.attempts
    ? state.progressSummary.weeklyStats.averageTimeToClearSeconds === null
      ? `${state.progressSummary.weeklyStats.successes}/${state.progressSummary.weeklyStats.attempts} cleared`
      : `Avg clear ${state.progressSummary.weeklyStats.averageTimeToClearSeconds}s`
    : 'No attempts yet';

  return (
    <AppScreen
      backgroundColor={colors.elevated}
      contentStyle={styles.screenContent}
      footer={
        isLoading || loadError ? null : (
          <View style={styles.createCtaFooter}>
            <FlowFooterButton label="Create Checkpoint" onPress={handleCreateAlarmPress} />
          </View>
        )
      }>
      <FlowTopBar
        subtitle={`${state.alarms.length} saved`}
        title="Checkpoints"
      />

      {isLoading ? (
        <LoadingBlock
          description="Loading your saved checkpoints."
          layout="list"
          style={styles.loadingBlock}
          title="Loading checkpoints"
        />
      ) : loadError ? (
        <EmptyState
          actionLabel="Try again"
          description={loadError}
          icon="alert-circle-outline"
          onAction={() => void loadData()}
          style={styles.emptyCard}
          title="Checkpoints could not be loaded"
          tone="danger"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create checkpoint"
          description="Save a proof setup once, then reuse it whenever that routine needs accountability."
          icon="albums-outline"
          onAction={handleCreateAlarmPress}
          style={styles.emptyCard}
          title="No saved checkpoints"
        />
      ) : (
        <>
          <AppCard tone="muted" style={styles.overviewCard}>
            <View style={styles.overviewItem}>
              <Text style={[styles.overviewLabel, { color: colors.textSoft }]}>THIS WEEK</Text>
              <Text style={[styles.overviewValue, { color: colors.primary }]}>{weeklyCompletionRate}</Text>
              <Text numberOfLines={1} style={[styles.overviewHelper, { color: colors.textSoft }]}>
                {weeklyCompletionHelper}
              </Text>
            </View>
            <View style={[styles.overviewDivider, { backgroundColor: colors.line }]} />
            <View style={styles.overviewItem}>
              <Text style={[styles.overviewLabel, { color: colors.textSoft }]}>NEXT UP</Text>
              <Text style={[styles.overviewValue, { color: colors.text }]}>
                {primaryAlarm ? formatAlarmRuntimeTime(primaryAlarm) : '—'}
              </Text>
              <Text numberOfLines={1} style={[styles.overviewHelper, { color: colors.textSoft }]}>
              {primaryAlarm
                  ? primaryAlarm.label
                  : 'Nothing scheduled'}
              </Text>
            </View>
          </AppCard>

          <View style={styles.listHeader}>
            <Text style={[styles.listTitle, { color: colors.text }]}>Saved checkpoints</Text>
            <Text style={[styles.listCount, { backgroundColor: colors.panelMuted, color: colors.textSoft }]}>
              {state.alarms.length}
            </Text>
          </View>

          <View style={styles.alarmList}>
            {state.alarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                circleName={alarm.socialSettings?.circleId ? state.circleNamesById[alarm.socialSettings.circleId] : undefined}
                onDelete={handleDeleteAlarm}
                onDetails={handleOpenDetails}
                onEdit={handleEditAlarm}
                onOpen={handleOpenAlarm}
                onReschedule={handleRescheduleAlarm}
                onReuse={handleReuseAlarm}
              />
            ))}
          </View>
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  createCtaFooter: {
    marginBottom: 68,
  },
  loadingBlock: {
    minHeight: 180,
  },
  emptyCard: {
    minHeight: 192,
  },
  overviewCard: {
    alignItems: 'stretch',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.lg,
    padding: Spacing.lg,
  },
  overviewItem: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  overviewDivider: {
    width: 1,
  },
  overviewLabel: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 14,
  },
  overviewValue: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 29,
  },
  overviewHelper: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  listHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  listTitle: {
    ...TextPresets.label,
    fontSize: 15,
    lineHeight: 20,
  },
  listCount: {
    borderRadius: Radius.pill,
    fontFamily: Fonts.rounded,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 22,
    minWidth: 22,
    overflow: 'hidden',
    paddingHorizontal: 7,
    textAlign: 'center',
  },
  alarmList: {
    gap: Spacing.md,
  },
});
