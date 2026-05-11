import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowFooterButton,
  FlowIconBadge,
  FlowListRow,
  FlowMetricTile,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, formatScheduledFor, hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import {
  formatSocialTimestamp,
  getAlarmPhaseLabel,
  getPrimaryAlarm,
  getSocialStatusLabel,
  getSocialStatusTone,
} from '@/lib/dashboard';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { listMySocialCircles } from '@/lib/social/circles';
import { getSocialRuntimeSnapshot } from '@/lib/social/queue';
import { SocialRuntimeSnapshot } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type HomeState = {
  alarms: Alarm[];
  currentStreak: number;
  lifetimeAlarmCreations: number;
  progressSummary: ProgressSummary | null;
  socialRuntime: SocialRuntimeSnapshot | null;
  circleCount: number;
  successHistory: SuccessHistoryEntry[];
  failureHistory: FailureHistoryEntry[];
  latestSuccess: SuccessHistoryEntry | null;
  latestFailure: FailureHistoryEntry | null;
};

type TimelineItem = {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  tone: 'success' | 'danger' | 'warning' | 'primary';
  sortAt: number;
  timeLabel: string;
};

type WeeklyDayStat = {
  key: string;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  completionRate: number;
};

function formatTodayTitleDate(day = new Date()) {
  return day.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatDueWindow(alarm: Alarm | null) {
  if (!alarm) {
    return 'Choose the place or object you will prove.';
  }

  const start = new Date();
  start.setHours(alarm.hour, alarm.minute, 0, 0);

  const end = new Date(start);
  end.setSeconds(end.getSeconds() + alarm.gracePeriodSeconds);

  const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return `Due between ${startLabel} - ${endLabel}`;
}

function formatTimelineTime(timestamp: string | number | Date) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDueDistance(timestamp: string | number | Date, now = new Date()) {
  const distanceMs = new Date(timestamp).getTime() - now.getTime();

  if (distanceMs <= 0) {
    return 'Due now';
  }

  const totalMinutes = Math.max(1, Math.round(distanceMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `Due in ${minutes}m`;
  }

  if (minutes === 0) {
    return `Due in ${hours}h`;
  }

  return `Due in ${hours}h ${minutes}m`;
}

function getScheduledDateForToday(alarm: Alarm, day = new Date()) {
  if (alarm.scheduledFor) {
    return new Date(alarm.scheduledFor);
  }

  const scheduledDate = new Date(day);
  scheduledDate.setHours(alarm.hour, alarm.minute, 0, 0);
  return scheduledDate;
}

function getLatestOutcome(
  success: SuccessHistoryEntry | null,
  failure: FailureHistoryEntry | null
): { tone: 'success' | 'danger'; title: string; detail: string } | null {
  if (!success && !failure) {
    return null;
  }

  const successTime = success ? new Date(success.confirmedAt).getTime() : 0;
  const failureTime = failure ? new Date(failure.failedAt).getTime() : 0;

  if (successTime >= failureTime && success) {
    return {
      tone: 'success',
      title: success.label,
      detail: `Checked in · ${formatSocialTimestamp(success.confirmedAt)}`,
    };
  }

  if (failure) {
    return {
      tone: 'danger',
      title: failure.label,
      detail: `Missed · ${formatSocialTimestamp(failure.failedAt)}`,
    };
  }

  return null;
}

function getCircleSummary(circleCount: number, lastSuccessfulSyncAt?: string | null) {
  if (circleCount === 0) {
    return 'Private until you add a circle.';
  }

  if (!lastSuccessfulSyncAt) {
    return `${circleCount} circle${circleCount === 1 ? '' : 's'} ready`;
  }

  return `${circleCount} circle${circleCount === 1 ? '' : 's'} · ${formatSocialTimestamp(lastSuccessfulSyncAt)}`;
}

function isSameLocalDay(timestamp: string, day = new Date()) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function getTodayClears(successHistory: SuccessHistoryEntry[]) {
  return successHistory.filter((entry) => isSameLocalDay(entry.confirmedAt));
}

function getTodayMisses(failureHistory: FailureHistoryEntry[]) {
  return failureHistory.filter((entry) => isSameLocalDay(entry.failedAt));
}

function getTodayTimeline(successHistory: SuccessHistoryEntry[], failureHistory: FailureHistoryEntry[], alarms: Alarm[]) {
  const resolvedAlarmIds = new Set([
    ...getTodayClears(successHistory).map((entry) => entry.alarmId),
    ...getTodayMisses(failureHistory).map((entry) => entry.alarmId),
  ]);
  const clearedItems = getTodayClears(successHistory).map<TimelineItem>((entry) => ({
    id: `success-${entry.alarmId}-${entry.confirmedAt}`,
    title: entry.label,
    detail: `Checked in · ${entry.timeToScanSeconds}s`,
    statusLabel: 'Done',
    tone: 'success',
    sortAt: new Date(entry.scheduledFor ?? entry.confirmedAt).getTime(),
    timeLabel: formatTimelineTime(entry.scheduledFor ?? entry.confirmedAt),
  }));
  const missedItems = getTodayMisses(failureHistory).map<TimelineItem>((entry) => ({
    id: `miss-${entry.alarmId}-${entry.failedAt}`,
    title: entry.label,
    detail: 'Missed',
    statusLabel: 'Missed',
    tone: 'danger',
    sortAt: new Date(entry.scheduledFor ?? entry.failedAt).getTime(),
    timeLabel: formatTimelineTime(entry.scheduledFor ?? entry.failedAt),
  }));

  const scheduledItems = alarms
    .filter((alarm) => alarm.isActive && !resolvedAlarmIds.has(alarm.id))
    .map((alarm) => {
      const scheduledDate = getScheduledDateForToday(alarm);
      return { alarm, scheduledDate };
    })
    .filter(({ scheduledDate }) => isSameLocalDay(scheduledDate.toISOString()))
    .map<TimelineItem>(({ alarm, scheduledDate }) => ({
      id: `scheduled-${alarm.id}`,
      title: alarm.label,
      detail: formatDueDistance(scheduledDate),
      statusLabel: 'Soon',
      tone: new Date().getTime() >= scheduledDate.getTime() ? 'warning' : 'primary',
      sortAt: scheduledDate.getTime(),
      timeLabel: formatTimelineTime(scheduledDate),
    }));

  return [...clearedItems, ...missedItems, ...scheduledItems].sort((left, right) => left.sortAt - right.sortAt);
}

function getUpcomingAlarms(alarms: Alarm[], primaryAlarmId?: string) {
  const now = Date.now();

  return [...alarms]
    .filter((alarm) => alarm.isActive && alarm.id !== primaryAlarmId)
    .sort((left, right) => {
      const leftTime = left.scheduledFor ? new Date(left.scheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.scheduledFor ? new Date(right.scheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .filter((alarm) => !alarm.scheduledFor || new Date(alarm.scheduledFor).getTime() >= now)
    .slice(0, 3);
}

function getWeeklyReliabilityCopy(progressSummary: ProgressSummary | null) {
  const weeklyStats = progressSummary?.weeklyStats;

  if (!weeklyStats || weeklyStats.attempts === 0) {
    return {
      value: '0%',
      helper: 'No attempts yet',
      progress: 0,
    };
  }

  return {
    value: `${weeklyStats.completionRate}%`,
    helper: `${weeklyStats.successes}/${weeklyStats.attempts} cleared`,
    progress: weeklyStats.completionRate / 100,
  };
}

function getCurrentRunCopy(progressSummary: ProgressSummary | null, currentStreak: number) {
  if (!progressSummary || currentStreak === 0) {
    return {
      value: '0',
      helper: 'No active clear streak',
      progress: 0,
      activeDots: 0,
    };
  }

  return {
    value: `${currentStreak}`,
    helper: `${currentStreak} consecutive clear${currentStreak === 1 ? '' : 's'}`,
    progress: progressSummary.milestoneProgress.progressRatio,
    activeDots: Math.min(5, currentStreak),
  };
}

function getWeekStart(day = new Date()) {
  const weekStart = new Date(day);
  const dayOfWeek = weekStart.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getWeeklyDayStats(successHistory: SuccessHistoryEntry[], failureHistory: FailureHistoryEntry[], day = new Date()) {
  const weekStart = getWeekStart(day);
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return labels.map<WeeklyDayStat>((label, index) => {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() + index);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    const successes = successHistory.filter((entry) => {
      const timestamp = new Date(entry.confirmedAt).getTime();
      return timestamp >= start.getTime() && timestamp < end.getTime();
    }).length;
    const failures = failureHistory.filter((entry) => {
      const timestamp = new Date(entry.failedAt).getTime();
      return timestamp >= start.getTime() && timestamp < end.getTime();
    }).length;
    const attempts = successes + failures;

    return {
      key: start.toISOString(),
      label,
      attempts,
      successes,
      failures,
      completionRate: attempts === 0 ? 0 : successes / attempts,
    };
  });
}

export default function TodayScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const { configured, user } = useSocialSession();
  const hasLoadedHomeRef = useRef(false);
  const loadHomeRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<HomeState>({
    alarms: [],
    currentStreak: 0,
    lifetimeAlarmCreations: 0,
    progressSummary: null,
    socialRuntime: null,
    circleCount: 0,
    successHistory: [],
    failureHistory: [],
    latestSuccess: null,
    latestFailure: null,
  });

  const loadHome = useCallback(async () => {
    const requestId = loadHomeRequestRef.current + 1;
    loadHomeRequestRef.current = requestId;
    const shouldLoadCircles = Boolean(configured && user?.id);

    if (!hasLoadedHomeRef.current) {
      setIsLoading(true);
    }

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);

      const [store, socialRuntime, circles] = await Promise.all([
        readAlarmStore(),
        getSocialRuntimeSnapshot(),
        shouldLoadCircles ? listMySocialCircles().catch(() => []) : Promise.resolve([]),
      ]);

      if (loadHomeRequestRef.current === requestId) {
        setState({
          alarms: store.alarms,
          currentStreak: store.currentStreak,
          lifetimeAlarmCreations: store.lifetimeAlarmCreations,
          progressSummary: getProgressSummary(store),
          socialRuntime,
          circleCount: circles.length,
          successHistory: store.successHistory,
          failureHistory: store.failureHistory,
          latestSuccess: store.successHistory[0] ?? null,
          latestFailure: store.failureHistory[0] ?? null,
        });
      }
    } finally {
      if (loadHomeRequestRef.current === requestId) {
        hasLoadedHomeRef.current = true;
        setIsLoading(false);
      }
    }
  }, [configured, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome])
  );

  const primaryAlarm = useMemo(() => getPrimaryAlarm(state.alarms), [state.alarms]);
  const socialStatusLabel = getSocialStatusLabel(state.socialRuntime);
  const socialStatusTone = getSocialStatusTone(state.socialRuntime);
  const latestOutcome = getLatestOutcome(state.latestSuccess, state.latestFailure);
  const weeklyReliability = getWeeklyReliabilityCopy(state.progressSummary);
  const currentRun = getCurrentRunCopy(state.progressSummary, state.currentStreak);
  const todayClears = useMemo(() => getTodayClears(state.successHistory), [state.successHistory]);
  const todayMisses = useMemo(() => getTodayMisses(state.failureHistory), [state.failureHistory]);
  const todayTimeline = useMemo(
    () => getTodayTimeline(state.successHistory, state.failureHistory, state.alarms),
    [state.alarms, state.failureHistory, state.successHistory]
  );
  const weeklyDayStats = useMemo(
    () => getWeeklyDayStats(state.successHistory, state.failureHistory),
    [state.failureHistory, state.successHistory]
  );
  const upcomingAlarms = useMemo(() => getUpcomingAlarms(state.alarms, primaryAlarm?.id), [primaryAlarm?.id, state.alarms]);
  const primaryPhaseLabel = getAlarmPhaseLabel(primaryAlarm);

  const handlePrimaryPress = useCallback(() => {
    if (primaryAlarm && primaryPhaseLabel === 'Scan now') {
      router.push(`/ringing?alarmId=${primaryAlarm.id}`);
      return;
    }

    if (primaryAlarm) {
      router.push(`/checkpoint/${primaryAlarm.id}`);
      return;
    }

    router.push({ pathname: '/create', params: { returnTo: '/' } });
  }, [primaryAlarm, primaryPhaseLabel, router]);
  const handleCreateCheckpoint = useCallback(() => {
    router.push({ pathname: '/create', params: { returnTo: '/' } });
  }, [router]);

  return (
    <AppScreen
      backgroundColor={colors.elevated}
      contentStyle={styles.screenContent}
      footer={
        isLoading ? null : (
          <View style={styles.createCtaFooter}>
            <FlowFooterButton label="Create Checkpoint" onPress={handleCreateCheckpoint} />
          </View>
        )
      }>
      <FlowTopBar
        onRightPress={() => router.push('/account')}
        rightAccessibilityLabel="Open settings"
        rightIcon="notifications-outline"
        subtitle={formatTodayTitleDate()}
        title="Today"
      />

      {isLoading ? (
        <LoadingBlock
          description="Checking your next checkpoint and latest proof."
          style={styles.loadingHero}
          title="Loading today"
          tone="canvas"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create your first checkpoint"
          description="Start with one checkpoint tied to something real: waking up, medication, study, training, or leaving on time."
          eyebrow="Today"
          icon="scan-outline"
          onAction={() => router.push({ pathname: '/create', params: { returnTo: '/' } })}
          title="No checkpoint scheduled"
          tone="primary"
        />
      ) : (
        <>
          <FlowPanel style={styles.duePanel}>
            <View style={styles.dueRow}>
              <FlowIconBadge icon="bandage-outline" size="large" tone="muted" />
              <View style={styles.dueCopy}>
                <Text style={[styles.dueKicker, { color: colors.primary }]}>
                  {primaryPhaseLabel === 'Scan now' ? 'DUE NOW' : 'NEXT UP'}
                </Text>
                <Text style={[styles.dueTitle, { color: colors.text }]}>
                  {primaryAlarm ? primaryAlarm.label : 'Create checkpoint'}
                </Text>
                <Text style={[styles.dueBody, { color: colors.textSoft }]}>
                  {formatDueWindow(primaryAlarm)}
                </Text>
                <Pressable
                  accessibilityLabel={primaryPhaseLabel === 'Scan now' ? 'Check in now' : 'Open checkpoint'}
                  accessibilityRole="button"
                  onPress={handlePrimaryPress}
                  style={({ pressed }) => [styles.checkInButton, { backgroundColor: colors.text }, pressed && styles.pressed]}>
                  <Text style={[styles.checkInLabel, { color: colors.elevated }]}>
                    {primaryPhaseLabel === 'Scan now' ? 'Check In Now' : 'Open Checkpoint'}
                  </Text>
                  <Ionicons color={colors.elevated} name="chevron-forward" size={16} />
                </Pressable>
              </View>
            </View>
          </FlowPanel>

          <FlowPanel>
            <FlowSectionLabel>TODAY&apos;S TIMELINE</FlowSectionLabel>
            <View style={styles.timelineList}>
              {todayTimeline.length > 0 ? (
                todayTimeline.map((item, index) => (
                  <TimelineRow item={item} key={item.id} showLine={index < todayTimeline.length - 1} />
                ))
              ) : (
                <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>Proof events will appear here as the day unfolds.</Text>
              )}
            </View>
          </FlowPanel>

          <View style={styles.metricGrid}>
            <Pressable
              accessibilityLabel="Open history and analytics"
              accessibilityRole="button"
              onPress={() => router.push('/history')}
              style={({ pressed }) => [styles.metricAction, pressed && styles.pressed]}>
              <FlowMetricTile helper={weeklyReliability.helper} label="WEEKLY RELIABILITY" value={weeklyReliability.value}>
                <WeekBars days={weeklyDayStats} />
              </FlowMetricTile>
            </Pressable>
            <FlowMetricTile helper={currentRun.helper} label="CURRENT STREAK" tone="warning" value={`🔥 ${currentRun.value}`}>
              <StreakDots activeDots={currentRun.activeDots} />
            </FlowMetricTile>
          </View>

          <FlowPanel>
            <View style={styles.compactSectionHeader}>
              <FlowSectionLabel>UPCOMING</FlowSectionLabel>
              <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
                {upcomingAlarms.length} next
              </Text>
            </View>
            {upcomingAlarms.length > 0 ? (
              upcomingAlarms.slice(0, 2).map((alarm) => (
                <FlowListRow
                  description={alarm.scheduledFor ? formatScheduledFor(alarm.scheduledFor) : formatAlarmTime(alarm.hour, alarm.minute)}
                  key={alarm.id}
                  onPress={() => router.push(`/checkpoint/${alarm.id}`)}
                  style={styles.inlineFlowRow}
                  title={alarm.label}
                  trailing={<Text style={[styles.trailingTime, { color: colors.textSoft }]}>{formatAlarmTime(alarm.hour, alarm.minute)}</Text>}
                />
              ))
            ) : (
              <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>No other checkpoints queued.</Text>
            )}
          </FlowPanel>

          <FlowPanel>
            <FlowListRow
              description={`${todayClears.length} checkpoint${todayClears.length === 1 ? '' : 's'} cleared today`}
              onPress={() => router.push('/today-activity')}
              statusLabel={`${todayMisses.length} missed`}
              statusTone={todayMisses.length > 0 ? 'danger' : 'success'}
              style={styles.inlineFlowRow}
              title="Cleared today"
            />
            <FlowListRow
              description={getCircleSummary(state.circleCount, state.socialRuntime?.queue.lastSuccessfulSyncAt)}
              onPress={() => router.push('/circles')}
              statusLabel={socialStatusLabel}
              statusTone={socialStatusTone}
              style={styles.inlineFlowRow}
              title={state.circleCount === 0 ? 'Accountability' : `${state.circleCount} circle${state.circleCount === 1 ? '' : 's'}`}
            />
            <FlowListRow
              description={latestOutcome ? latestOutcome.detail : 'No completed run yet'}
              onPress={() => router.push('/today-activity')}
              statusLabel={latestOutcome ? (latestOutcome.tone === 'success' ? 'Saved' : 'Missed') : 'Waiting'}
              statusTone={latestOutcome ? latestOutcome.tone : 'default'}
              style={styles.inlineFlowRow}
              title={latestOutcome ? latestOutcome.title : 'Latest proof'}
            />
          </FlowPanel>

        </>
      )}
    </AppScreen>
  );
}

function TimelineRow({ item, showLine }: { item: TimelineItem; showLine: boolean }) {
  const colors = getAppColors(useColorScheme());
  const dotColor =
    item.tone === 'success' ? colors.success : item.tone === 'danger' ? colors.danger : item.tone === 'warning' ? colors.warning : colors.primary;
  const isSuccess = item.tone === 'success';

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineTimeColumn}>
        <Text style={[styles.timelineTime, { color: colors.textSoft }]}>{item.timeLabel}</Text>
      </View>
      <View style={styles.timelineMarkerColumn}>
        <View
          style={[
            styles.timelineDot,
            {
              backgroundColor: isSuccess ? dotColor : colors.elevated,
              borderColor: dotColor,
            },
          ]}>
          {isSuccess ? <Ionicons color={colors.successText} name="checkmark" size={9} /> : null}
        </View>
        {showLine ? <View style={[styles.timelineStem, { backgroundColor: colors.line }]} /> : null}
      </View>
      <View style={styles.timelineCopy}>
        <Text style={[styles.timelineTitle, { color: colors.text }]}>{item.title}</Text>
        <Text style={[styles.timelineDetail, { color: colors.textSoft }]}>{item.detail}</Text>
      </View>
    </View>
  );
}

function WeekBars({ days }: { days: WeeklyDayStat[] }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.weekBars}>
      {days.map((day) => {
        const hasAttempts = day.attempts > 0;
        const barColor = !hasAttempts
          ? colors.line
          : day.failures > 0 && day.successes === 0
            ? colors.danger
            : day.failures > 0
              ? colors.warning
              : colors.success;
        const barHeight = hasAttempts ? 12 + Math.round(day.completionRate * 18) : 8;

        return (
        <View key={day.key} style={styles.weekBarWrap}>
          <View
            style={[
              styles.weekBar,
              {
                backgroundColor: barColor,
                height: barHeight,
                opacity: hasAttempts ? 1 : 0.65,
              },
            ]}
          />
          <Text style={[styles.weekLabel, { color: colors.muted }]}>{day.label}</Text>
        </View>
        );
      })}
    </View>
  );
}

function StreakDots({ activeDots }: { activeDots: number }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.streakDots}>
      {Array.from({ length: 5 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.streakDot,
            {
              backgroundColor: index < activeDots ? colors.success : colors.line,
            },
          ]}>
          {index < activeDots ? <Ionicons color={colors.successText} name="checkmark" size={10} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 10,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  createCtaFooter: {
    marginBottom: 56,
  },
  loadingHero: {
    minHeight: 188,
  },
  duePanel: {
    padding: 12,
  },
  dueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  dueCopy: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  dueKicker: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 13,
  },
  dueTitle: {
    ...TextPresets.title,
    fontSize: 16,
    lineHeight: 20,
  },
  dueBody: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  checkInButton: {
    alignItems: 'center',
    borderRadius: 7,
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'center',
    marginTop: Spacing.xs,
    minHeight: 34,
    paddingHorizontal: Spacing.md,
  },
  checkInLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  timelineList: {
    gap: Spacing.sm,
  },
  timelineRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 44,
  },
  timelineTimeColumn: {
    alignItems: 'flex-end',
    minWidth: 48,
  },
  timelineTime: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 16,
  },
  timelineMarkerColumn: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingTop: 1,
    width: 14,
  },
  timelineStem: {
    borderRadius: Radius.pill,
    flex: 1,
    marginTop: 3,
    minHeight: 18,
    width: 1,
  },
  timelineDot: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 14,
    justifyContent: 'center',
    marginTop: 1,
    width: 14,
  },
  timelineCopy: {
    flex: 1,
    minWidth: 0,
  },
  timelineTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  timelineDetail: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  metricAction: {
    flex: 1,
    minWidth: 0,
  },
  inlineFlowRow: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 0,
    paddingHorizontal: 2,
  },
  weekBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingTop: Spacing.xs,
  },
  weekBarWrap: {
    alignItems: 'center',
    gap: 3,
  },
  weekBar: {
    borderRadius: Radius.pill,
    width: 6,
  },
  weekLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 10,
  },
  streakDots: {
    flexDirection: 'row',
    gap: 5,
    paddingTop: Spacing.xs,
  },
  streakDot: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  compactSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionCount: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  trailingTime: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyCopy: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 19,
  },
});
