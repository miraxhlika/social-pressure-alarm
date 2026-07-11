import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowFooterButton,
  FlowListRow,
  FlowPanel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ALARM_RUNTIME_CACHE_MAX_AGE_MS,
  formatAlarmRuntimeTime,
  hydrateAlarmRuntimeForCurrentUser,
} from '@/lib/alarms';
import {
  formatSocialTimestamp,
  getAlarmPhaseLabel,
  getPrimaryAlarm,
  getSocialStatusLabel,
  getSocialStatusTone,
} from '@/lib/dashboard';
import { getNotificationPermissionState, isNotificationPermissionEnabled } from '@/lib/notifications';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { SOCIAL_CIRCLES_CACHE_MAX_AGE_MS, listMySocialCircles } from '@/lib/social/circles';
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
  notificationsEnabled: boolean;
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

function normalizeTimelineTimestampKey(timestamp?: string) {
  if (!timestamp) {
    return undefined;
  }

  const timestampMs = new Date(timestamp).getTime();

  return Number.isNaN(timestampMs) ? timestamp.trim() : new Date(timestampMs).toISOString();
}

function getTimelineOccurrenceKey(
  alarmId: string,
  scheduledFor: string | undefined,
  outcome: 'confirmed' | 'missed',
  resolvedAt: string
) {
  return `${alarmId}::${normalizeTimelineTimestampKey(scheduledFor) ?? `resolved:${normalizeTimelineTimestampKey(resolvedAt) ?? 'unknown'}`}::${outcome}`;
}

function shouldPreferTimelineEntry(existingResolvedAt: string, incomingResolvedAt: string) {
  return new Date(incomingResolvedAt).getTime() < new Date(existingResolvedAt).getTime();
}

function getUniqueTodayClears(successHistory: SuccessHistoryEntry[]) {
  const entriesByKey = new Map<string, SuccessHistoryEntry>();

  for (const entry of getTodayClears(successHistory)) {
    const key = getTimelineOccurrenceKey(entry.alarmId, entry.scheduledFor, 'confirmed', entry.confirmedAt);
    const existingEntry = entriesByKey.get(key);

    if (!existingEntry || shouldPreferTimelineEntry(existingEntry.confirmedAt, entry.confirmedAt)) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()];
}

function getUniqueTodayMisses(failureHistory: FailureHistoryEntry[]) {
  const entriesByKey = new Map<string, FailureHistoryEntry>();

  for (const entry of getTodayMisses(failureHistory)) {
    const key = getTimelineOccurrenceKey(entry.alarmId, entry.scheduledFor, 'missed', entry.failedAt);
    const existingEntry = entriesByKey.get(key);

    if (!existingEntry || shouldPreferTimelineEntry(existingEntry.failedAt, entry.failedAt)) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()];
}

function getTodayTimeline(successHistory: SuccessHistoryEntry[], failureHistory: FailureHistoryEntry[], alarms: Alarm[]) {
  const todayClears = getUniqueTodayClears(successHistory);
  const todayMisses = getUniqueTodayMisses(failureHistory);
  const resolvedAlarmIds = new Set([
    ...todayClears.map((entry) => entry.alarmId),
    ...todayMisses.map((entry) => entry.alarmId),
  ]);
  const clearedItems = todayClears.map<TimelineItem>((entry) => ({
    id: `success-${entry.alarmId}-${entry.confirmedAt}`,
    title: entry.label,
    detail: `Checked in · ${entry.timeToScanSeconds}s`,
    statusLabel: 'Done',
    tone: 'success',
    sortAt: new Date(entry.scheduledFor ?? entry.confirmedAt).getTime(),
    timeLabel: formatTimelineTime(entry.scheduledFor ?? entry.confirmedAt),
  }));
  const missedItems = todayMisses.map<TimelineItem>((entry) => ({
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
  const [loadError, setLoadError] = useState('');
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
    notificationsEnabled: true,
  });

  const loadHome = useCallback(async () => {
    const requestId = loadHomeRequestRef.current + 1;
    loadHomeRequestRef.current = requestId;
    const shouldLoadCircles = Boolean(configured && user?.id);

    if (!hasLoadedHomeRef.current) {
      setIsLoading(true);
    }

    try {
      const [store, socialRuntime, circles, notificationPermissionState] = await Promise.all([
        hydrateAlarmRuntimeForCurrentUser({ maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS }),
        getSocialRuntimeSnapshot(),
        shouldLoadCircles
          ? listMySocialCircles({ maxAgeMs: SOCIAL_CIRCLES_CACHE_MAX_AGE_MS }).catch(() => [])
          : Promise.resolve([]),
        getNotificationPermissionState(),
      ]);

      if (loadHomeRequestRef.current === requestId) {
        setLoadError('');
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
          notificationsEnabled: isNotificationPermissionEnabled(notificationPermissionState),
        });
      }
    } catch (error) {
      if (loadHomeRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : 'Today could not be loaded right now.');
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
  const todayClears = useMemo(() => getUniqueTodayClears(state.successHistory), [state.successHistory]);
  const todayMisses = useMemo(() => getUniqueTodayMisses(state.failureHistory), [state.failureHistory]);
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
        isLoading || loadError ? null : (
          <View style={styles.createCtaFooter}>
            <FlowFooterButton label="Create Checkpoint" onPress={handleCreateCheckpoint} />
          </View>
        )
      }>
      <FlowTopBar
        subtitle={formatTodayTitleDate()}
        title="Today"
      />

      {!isLoading && !loadError && state.alarms.length > 0 && !state.notificationsEnabled ? (
        <FlowListRow
          description="Active checkpoints cannot remind you until notifications are enabled in device settings."
          leading={<Ionicons color={colors.danger} name="notifications-off-outline" size={20} />}
          onPress={() => router.push('/account')}
          statusLabel="Fix"
          statusTone="danger"
          title="Checkpoint reminders are off"
        />
      ) : null}

      {isLoading ? (
        <LoadingBlock
          description="Checking your next checkpoint and latest proof."
          layout="hero"
          style={styles.loadingHero}
          title="Loading today"
          tone="canvas"
        />
      ) : loadError ? (
        <EmptyState
          actionLabel="Try again"
          description={loadError}
          icon="alert-circle-outline"
          onAction={() => void loadHome()}
          title="Today could not be loaded"
          tone="danger"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create your first checkpoint"
          description="Start with one checkpoint tied to something real: waking up, study, training, or leaving on time."
          eyebrow="Today"
          icon="scan-outline"
          onAction={() => router.push({ pathname: '/create', params: { returnTo: '/' } })}
          title="No checkpoint scheduled"
          tone="primary"
        />
      ) : (
        <>
          <FlowPanel style={styles.heroPanel}>
            <View style={styles.heroHeader}>
              <Text style={[styles.dueKicker, { color: colors.primary }]}>
                {primaryPhaseLabel === 'Scan now'
                  ? 'READY TO CHECK IN'
                  : primaryPhaseLabel === 'Cleared'
                    ? 'COMPLETED'
                    : 'UP NEXT'}
              </Text>
              <View
                style={[
                  styles.heroStatus,
                  {
                    backgroundColor:
                      primaryPhaseLabel === 'Cleared' ? colors.successSurface : colors.primarySurface,
                  },
                ]}>
                <View
                  style={[
                    styles.heroStatusDot,
                    { backgroundColor: primaryPhaseLabel === 'Cleared' ? colors.success : colors.primary },
                  ]}
                />
                <Text
                  style={[
                    styles.heroStatusText,
                    { color: primaryPhaseLabel === 'Cleared' ? colors.success : colors.primary },
                  ]}>
                  {primaryPhaseLabel}
                </Text>
              </View>
            </View>

            <Text style={[styles.heroTime, { color: colors.text }]}>
              {primaryAlarm ? formatAlarmRuntimeTime(primaryAlarm) : '—'}
            </Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              {primaryAlarm ? primaryAlarm.label : 'Create checkpoint'}
            </Text>
            <Text style={[styles.heroBody, { color: colors.textSoft }]}>
              {primaryPhaseLabel === 'Cleared' ? 'You completed this checkpoint today.' : formatDueWindow(primaryAlarm)}
            </Text>

            <Pressable
              accessibilityLabel={primaryPhaseLabel === 'Scan now' ? 'Check in now' : 'Open checkpoint'}
              accessibilityRole="button"
              onPress={handlePrimaryPress}
              style={({ pressed }) => [
                styles.checkInButton,
                { backgroundColor: primaryPhaseLabel === 'Scan now' ? colors.text : colors.panelMuted },
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.checkInLabel,
                  { color: primaryPhaseLabel === 'Scan now' ? colors.elevated : colors.text },
                ]}>
                {primaryPhaseLabel === 'Scan now' ? 'Check in now' : 'View checkpoint'}
              </Text>
              <Ionicons
                color={primaryPhaseLabel === 'Scan now' ? colors.elevated : colors.text}
                name="arrow-forward"
                size={16}
              />
            </Pressable>
          </FlowPanel>

          <View style={styles.todaySection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Today&apos;s plan</Text>
              <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
                {todayTimeline.length} {todayTimeline.length === 1 ? 'checkpoint' : 'checkpoints'}
              </Text>
            </View>
            <View style={styles.timelineList}>
              {todayTimeline.length > 0 ? (
                todayTimeline.map((item, index) => (
                  <TimelineRow item={item} key={item.id} showLine={index < todayTimeline.length - 1} />
                ))
              ) : (
                <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>Proof events will appear here as the day unfolds.</Text>
              )}
            </View>
          </View>

          <Pressable
            accessibilityLabel="Open progress history"
            accessibilityRole="button"
            onPress={() => router.push('/history')}
            style={({ pressed }) => [
              styles.progressStrip,
              { backgroundColor: colors.panelMuted },
              pressed && styles.pressed,
            ]}>
            <View style={styles.progressItem}>
              <Text style={[styles.progressValue, { color: colors.primary }]}>{weeklyReliability.value}</Text>
              <Text style={[styles.progressLabel, { color: colors.textSoft }]}>this week</Text>
            </View>
            <View style={[styles.progressDivider, { backgroundColor: colors.line }]} />
            <View style={styles.progressItem}>
              <Text style={[styles.progressValue, { color: colors.text }]}>🔥 {currentRun.value}</Text>
              <Text style={[styles.progressLabel, { color: colors.textSoft }]}>
                day streak
              </Text>
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={17} />
          </Pressable>

          {upcomingAlarms.length > 0 ? (
            <View style={styles.todaySection}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Coming up</Text>
              <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
                  {upcomingAlarms.length} next
              </Text>
              </View>
              <View style={styles.upcomingList}>
                {upcomingAlarms.slice(0, 2).map((alarm) => (
                  <UpcomingCheckpointCard
                    alarm={alarm}
                    key={alarm.id}
                    onPress={() => router.push(`/checkpoint/${alarm.id}`)}
                  />
                ))}
              </View>
            </View>
          ) : null}

        </>
      )}
    </AppScreen>
  );
}

function UpcomingCheckpointCard({ alarm, onPress }: { alarm: Alarm; onPress: () => void }) {
  const colors = getAppColors(useColorScheme());
  const dateLabel = alarm.scheduledFor
    ? new Date(alarm.scheduledFor).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        weekday: 'short',
      })
    : 'Next run';

  return (
    <Pressable
      accessibilityLabel={`${alarm.label}. ${dateLabel} at ${formatAlarmRuntimeTime(alarm)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.upcomingCard,
        { backgroundColor: colors.panelMuted },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.upcomingIcon, { backgroundColor: colors.primarySurface }]}>
        <Ionicons color={colors.primary} name="alarm-outline" size={19} />
      </View>
      <View style={styles.upcomingCopy}>
        <Text numberOfLines={1} style={[styles.upcomingTitle, { color: colors.text }]}>{alarm.label}</Text>
        <View style={styles.upcomingMeta}>
          <View style={[styles.upcomingDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.upcomingDate, { color: colors.textSoft }]}>{dateLabel}</Text>
        </View>
      </View>
      <View style={styles.upcomingTimeWrap}>
        <Text style={[styles.upcomingTime, { color: colors.text }]}>{formatAlarmRuntimeTime(alarm)}</Text>
        <Ionicons color={colors.muted} name="chevron-forward" size={16} />
      </View>
    </Pressable>
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
    gap: Spacing.xl,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  createCtaFooter: {
    marginBottom: 68,
  },
  loadingHero: {
    minHeight: 188,
  },
  heroPanel: {
    borderRadius: Radius.lg,
    gap: Spacing.xs,
    padding: Spacing.lg,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  heroStatus: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroStatusDot: {
    borderRadius: Radius.pill,
    height: 6,
    width: 6,
  },
  heroStatusText: {
    ...TextPresets.eyebrow,
    fontSize: 9,
    lineHeight: 12,
  },
  dueKicker: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 13,
  },
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 46,
  },
  heroTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.25,
    lineHeight: 26,
  },
  heroBody: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  checkInButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'center',
    marginTop: Spacing.md,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
  },
  checkInLabel: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  timelineList: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  todaySection: {
    gap: Spacing.md,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  upcomingList: {
    gap: Spacing.sm,
  },
  upcomingCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 76,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  upcomingIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  upcomingCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  upcomingTitle: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
  },
  upcomingMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  upcomingDot: {
    borderRadius: Radius.pill,
    height: 5,
    width: 5,
  },
  upcomingDate: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  upcomingTimeWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  upcomingTime: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  timelineRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 42,
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
  progressStrip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.lg,
    minHeight: 72,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  progressItem: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  progressDivider: {
    height: 32,
    width: 1,
  },
  progressValue: {
    fontFamily: Fonts.rounded,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  progressLabel: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
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
