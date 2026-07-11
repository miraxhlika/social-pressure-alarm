import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowIconBadge,
  FlowPanel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import {
  FlowProgressBar,
} from '@/components/ui/flow-visuals';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getFailureOccurrenceTimestamp,
  getSuccessOccurrenceTimestamp,
} from '@/lib/alarm-history';
import { ALARM_RUNTIME_CACHE_MAX_AGE_MS, hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { getUseCaseLabel } from '@/lib/checkpoint-templates';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { AlarmStore, UseCaseType } from '@/types/alarm';

type HistoryState = {
  store: AlarmStore | null;
  summary: ProgressSummary | null;
};

type AnalyticPeriod = 'thisWeek' | 'lastWeek' | 'thisMonth';
type PeriodRange = {
  start: Date;
  end: Date;
  bucketCount: number;
  comparisonLabel: string;
};
type PeriodStats = {
  attempts: number;
  successes: number;
  failures: number;
  completionRate: number;
  clearPoints: number[];
  missPoints: number[];
};
type PeriodCategory = {
  attempts: number;
  completionRate: number;
  label: string;
  successes: number;
  useCaseType: UseCaseType;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ANALYTIC_PERIOD_LABELS: Record<AnalyticPeriod, string> = {
  lastWeek: 'Last Week',
  thisMonth: 'This Month',
  thisWeek: 'This Week',
};
const ANALYTIC_PERIOD_OPTIONS: AnalyticPeriod[] = ['thisWeek', 'lastWeek', 'thisMonth'];
const EMPTY_PERIOD_STATS: PeriodStats = {
  attempts: 0,
  clearPoints: [0, 0, 0, 0, 0, 0, 0],
  completionRate: 0,
  failures: 0,
  missPoints: [0, 0, 0, 0, 0, 0, 0],
  successes: 0,
};

function startOfLocalDay(day: Date) {
  const nextDate = new Date(day);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(day: Date, amount: number) {
  const nextDate = new Date(day);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function addMonths(day: Date, amount: number) {
  const nextDate = new Date(day);
  nextDate.setMonth(nextDate.getMonth() + amount);
  return nextDate;
}

function getStartOfWeek(day = new Date()) {
  const weekStart = startOfLocalDay(day);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return weekStart;
}

function getStartOfMonth(day = new Date()) {
  const monthStart = startOfLocalDay(day);
  monthStart.setDate(1);
  return monthStart;
}

function getAnalyticPeriodRange(period: AnalyticPeriod, day = new Date()): PeriodRange {
  const thisWeekStart = getStartOfWeek(day);
  const thisMonthStart = getStartOfMonth(day);

  switch (period) {
    case 'lastWeek': {
      const start = addDays(thisWeekStart, -7);
      return {
        bucketCount: 7,
        comparisonLabel: 'the week before',
        end: thisWeekStart,
        start,
      };
    }
    case 'thisMonth':
      return {
        bucketCount: 7,
        comparisonLabel: 'last month',
        end: addMonths(thisMonthStart, 1),
        start: thisMonthStart,
      };
    default:
      return {
        bucketCount: 7,
        comparisonLabel: 'last week',
        end: addDays(thisWeekStart, 7),
        start: thisWeekStart,
      };
  }
}

function getPreviousPeriodRange(range: PeriodRange): PeriodRange {
  const duration = range.end.getTime() - range.start.getTime();

  return {
    ...range,
    end: new Date(range.start),
    start: new Date(range.start.getTime() - duration),
  };
}

function isInRange(timestamp: string, range: PeriodRange) {
  const time = new Date(timestamp).getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

function getBucketIndex(timestamp: string, range: PeriodRange) {
  const time = new Date(timestamp).getTime();
  const duration = range.end.getTime() - range.start.getTime();
  const bucketDuration = duration / range.bucketCount;
  return Math.max(0, Math.min(range.bucketCount - 1, Math.floor((time - range.start.getTime()) / bucketDuration)));
}

function getPeriodStats(store: AlarmStore, range: PeriodRange): PeriodStats {
  const successes = store.successHistory.filter((entry) => isInRange(getSuccessOccurrenceTimestamp(entry), range));
  const failures = store.failureHistory.filter((entry) => isInRange(getFailureOccurrenceTimestamp(entry), range));
  const clearPoints = Array.from({ length: range.bucketCount }, () => 0);
  const missPoints = Array.from({ length: range.bucketCount }, () => 0);

  successes.forEach((entry) => {
    clearPoints[getBucketIndex(getSuccessOccurrenceTimestamp(entry), range)] += 1;
  });
  failures.forEach((entry) => {
    missPoints[getBucketIndex(getFailureOccurrenceTimestamp(entry), range)] += 1;
  });

  return {
    attempts: successes.length + failures.length,
    clearPoints,
    completionRate: successes.length + failures.length === 0 ? 0 : Math.round((successes.length / (successes.length + failures.length)) * 100),
    failures: failures.length,
    missPoints,
    successes: successes.length,
  };
}

function getPeriodCategories(store: AlarmStore, range: PeriodRange): PeriodCategory[] {
  const alarmTypes = new Map(store.alarms.map((alarm) => [alarm.id, alarm.useCaseType]));
  const groups = new Map<UseCaseType, { attempts: number; successes: number }>();

  const recordAttempt = (alarmId: string, didSucceed: boolean) => {
    const useCaseType = alarmTypes.get(alarmId) ?? 'custom';
    const current = groups.get(useCaseType) ?? { attempts: 0, successes: 0 };
    groups.set(useCaseType, {
      attempts: current.attempts + 1,
      successes: current.successes + (didSucceed ? 1 : 0),
    });
  };

  store.successHistory
    .filter((entry) => isInRange(getSuccessOccurrenceTimestamp(entry), range))
    .forEach((entry) => recordAttempt(entry.alarmId, true));
  store.failureHistory
    .filter((entry) => isInRange(getFailureOccurrenceTimestamp(entry), range))
    .forEach((entry) => recordAttempt(entry.alarmId, false));

  return [...groups.entries()]
    .map(([useCaseType, stats]) => ({
      ...stats,
      completionRate: Math.round((stats.successes / stats.attempts) * 100),
      label: getUseCaseLabel(useCaseType),
      useCaseType,
    }))
    .sort((left, right) => right.attempts - left.attempts || left.completionRate - right.completionRate)
    .slice(0, 4);
}

function getInsight(summary: ProgressSummary | null) {
  if (!summary) {
    return 'Keep one checkpoint simple until the app has enough history to spot a pattern.';
  }

  if (summary.weeklyReview.strongestUseCase) {
    return `You're most consistent with ${summary.weeklyReview.strongestUseCase.label.toLowerCase()}. Keep building that momentum.`;
  }

  return summary.weeklyReview.body;
}

function getReliabilityDelta(current: PeriodStats, previous: PeriodStats, comparisonLabel: string) {
  if (previous.attempts === 0) {
    return {
      tone: 'warning' as const,
      value: current.attempts === 0 ? 'No scans in this period yet' : 'First baseline for this period',
    };
  }

  const delta = current.completionRate - previous.completionRate;

  if (delta === 0) {
    return { tone: 'warning' as const, value: `No change vs ${comparisonLabel}` };
  }

  return {
    tone: delta > 0 ? ('success' as const) : ('danger' as const),
    value: `${Math.abs(delta)}% ${delta > 0 ? 'higher' : 'lower'} than ${comparisonLabel}`,
  };
}

export default function HistoryScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const hasLoadedHistoryRef = useRef(false);
  const loadHistoryRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [analyticPeriod, setAnalyticPeriod] = useState<AnalyticPeriod>('thisWeek');
  const [state, setState] = useState<HistoryState>({ store: null, summary: null });

  const loadHistory = useCallback(async () => {
    const requestId = loadHistoryRequestRef.current + 1;
    loadHistoryRequestRef.current = requestId;

    if (!hasLoadedHistoryRef.current) {
      setIsLoading(true);
    }

    try {
      const store = await hydrateAlarmRuntimeForCurrentUser({
        maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS,
      }).catch(() => readAlarmStore());
      if (loadHistoryRequestRef.current === requestId) {
        setState({ store, summary: getProgressSummary(store) });
      }
    } finally {
      if (loadHistoryRequestRef.current === requestId) {
        hasLoadedHistoryRef.current = true;
        setIsLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory])
  );

  const periodRange = useMemo(() => getAnalyticPeriodRange(analyticPeriod), [analyticPeriod]);
  const previousPeriodRange = useMemo(() => getPreviousPeriodRange(periodRange), [periodRange]);
  const periodStats = useMemo(
    () => (state.store ? getPeriodStats(state.store, periodRange) : EMPTY_PERIOD_STATS),
    [periodRange, state.store]
  );
  const previousPeriodStats = useMemo(
    () => (state.store ? getPeriodStats(state.store, previousPeriodRange) : EMPTY_PERIOD_STATS),
    [previousPeriodRange, state.store]
  );
  const periodCategories = useMemo(
    () => (state.store ? getPeriodCategories(state.store, periodRange) : []),
    [periodRange, state.store]
  );
  const reliability = periodStats.completionRate;
  const clears = periodStats.successes;
  const misses = periodStats.failures;
  const reliabilityDelta = getReliabilityDelta(periodStats, previousPeriodStats, periodRange.comparisonLabel);
  const averageClearSeconds = useMemo(() => {
    if (!state.store) {
      return null;
    }

    const clearTimes = state.store.successHistory
      .filter((entry) => isInRange(getSuccessOccurrenceTimestamp(entry), periodRange))
      .map((entry) => entry.timeToScanSeconds);

    return clearTimes.length === 0
      ? null
      : Math.round(clearTimes.reduce((total, value) => total + value, 0) / clearTimes.length);
  }, [periodRange, state.store]);
  const recoveryCategory = analyticPeriod === 'thisWeek' ? state.summary?.weeklyReview.recoveryUseCase ?? null : null;

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock
          description="Building your clears, misses, and weekly review."
          layout="analytics"
          title="Loading history"
        />
      </AppScreen>
    );
  }

  if (!state.store || (state.store.successHistory.length === 0 && state.store.failureHistory.length === 0)) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <FlowTopBar
          leftAccessibilityLabel="Go back"
          leftIcon="chevron-back"
          onLeftPress={() => router.back()}
          title="Progress"
        />
        <EmptyState
          actionLabel="Back to today"
          description="Create or run a checkpoint to start building proof history."
          onAction={() => router.replace('/')}
          title="History starts after the first live run"
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
        title="Progress"
      />

      <View style={[styles.periodTabs, { backgroundColor: colors.panelMuted }]}>
        {ANALYTIC_PERIOD_OPTIONS.map((period) => {
          const isSelected = period === analyticPeriod;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={period}
              onPress={() => setAnalyticPeriod(period)}
              style={({ pressed }) => [
                styles.periodTab,
                isSelected && { backgroundColor: colors.elevated },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.periodTabLabel, { color: isSelected ? colors.text : colors.textSoft }]}>
                {ANALYTIC_PERIOD_LABELS[period]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlowPanel style={styles.progressHero}>
        <Text style={[styles.heroEyebrow, { color: colors.textSoft }]}>COMPLETION RATE</Text>
        <View style={styles.heroMetricRow}>
          <Text style={[styles.reliabilityValue, { color: colors.text }]}>{reliability}%</Text>
          <View style={styles.heroSummary}>
            <View style={styles.summaryLine}>
              <View style={[styles.summaryDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.summaryText, { color: colors.textSoft }]}>{clears} completed</Text>
            </View>
            <View style={styles.summaryLine}>
              <View style={[styles.summaryDot, { backgroundColor: misses > 0 ? colors.danger : colors.line }]} />
              <Text style={[styles.summaryText, { color: colors.textSoft }]}>{misses} missed</Text>
            </View>
          </View>
        </View>
        <FlowProgressBar progress={reliability / 100} tone={reliability >= 70 ? 'success' : 'warning'} />
        <View style={styles.trendRow}>
          <Ionicons
            color={
              reliabilityDelta.tone === 'success'
                ? colors.success
                : reliabilityDelta.tone === 'danger'
                  ? colors.danger
                  : colors.warning
            }
            name={
              reliabilityDelta.tone === 'success'
                ? 'trending-up'
                : reliabilityDelta.tone === 'danger'
                  ? 'trending-down'
                  : 'remove'
            }
            size={15}
          />
          <Text
            style={[
              styles.trendText,
              {
                color:
                  reliabilityDelta.tone === 'success'
                    ? colors.success
                    : reliabilityDelta.tone === 'danger'
                      ? colors.danger
                      : colors.textSoft,
              },
            ]}>
            {reliabilityDelta.value}
          </Text>
        </View>
        <Text style={[styles.heroMessage, { color: colors.textSoft }]}>
          {periodStats.attempts === 0
            ? 'Complete a checkpoint to start tracking this period.'
            : reliability === 100
              ? 'Every checkpoint completed. Keep the rhythm going.'
              : `${clears} of ${periodStats.attempts} checkpoints completed this period.`}
        </Text>
      </FlowPanel>

      <View style={styles.activitySection}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your rhythm</Text>
          <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
            {analyticPeriod === 'thisMonth' ? 'This month' : '7-day view'}
          </Text>
        </View>
        <FlowPanel style={styles.rhythmPanel}>
          <RhythmChart
            clearPoints={periodStats.clearPoints}
            missPoints={periodStats.missPoints}
            period={analyticPeriod}
          />
          <View style={styles.rhythmLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.legendLabel, { color: colors.textSoft }]}>Completed</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
              <Text style={[styles.legendLabel, { color: colors.textSoft }]}>Missed</Text>
            </View>
          </View>
        </FlowPanel>
      </View>

      <View style={styles.metricGrid}>
        <ProgressStat
          helper={state.store.currentStreak === 1 ? 'consecutive clear' : 'consecutive clears'}
          icon="flame-outline"
          label="Current streak"
          value={`${state.store.currentStreak}`}
        />
        <ProgressStat
          helper={averageClearSeconds === null ? 'Complete one to measure' : 'average completion time'}
          icon="timer-outline"
          label="Clear speed"
          value={averageClearSeconds === null ? '—' : `${averageClearSeconds}s`}
        />
      </View>

      <Pressable
        accessibilityLabel="Review checkpoints based on this insight"
        accessibilityRole="button"
        onPress={() => router.push('/alarms')}
        style={({ pressed }) => [
          styles.insightPanel,
          {
            backgroundColor: colors.primarySurface,
            borderColor: colors.ring,
          },
          pressed && styles.pressed,
        ]}>
        <FlowIconBadge icon={recoveryCategory ? 'build-outline' : 'sparkles-outline'} size="small" tone="primary" />
        <View style={styles.insightCopy}>
          <Text style={[styles.insightTitle, { color: colors.text }]}>
            {recoveryCategory ? `${recoveryCategory.label} needs attention` : 'Pattern spotted'}
          </Text>
          <Text style={[styles.insightBody, { color: colors.textSoft }]}>
            {recoveryCategory
              ? `${recoveryCategory.failures} of ${recoveryCategory.attempts} attempts were missed. Review its time or proof setup.`
              : analyticPeriod === 'thisWeek'
                ? getInsight(state.summary)
                : reliabilityDelta.value}
          </Text>
        </View>
        <Ionicons color={colors.primary} name="chevron-forward" size={18} />
      </Pressable>

      {periodCategories.length > 1 ? (
        <View style={styles.activitySection}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>By category</Text>
            <Text style={[styles.sectionCount, { color: colors.textSoft }]}>Most active</Text>
          </View>
          <View style={styles.categoryGrid}>
            {periodCategories.map((entry) => (
              <CategoryTile entry={entry} key={entry.useCaseType} />
            ))}
          </View>
        </View>
      ) : null}

    </AppScreen>
  );
}

function RhythmChart({
  clearPoints,
  missPoints,
  period,
}: {
  clearPoints: number[];
  missPoints: number[];
  period: AnalyticPeriod;
}) {
  const colors = getAppColors(useColorScheme());
  const totals = clearPoints.map((value, index) => value + (missPoints[index] ?? 0));
  const maximum = Math.max(1, ...totals);
  const range = getAnalyticPeriodRange(period);
  const bucketDuration = (range.end.getTime() - range.start.getTime()) / clearPoints.length;
  const labels =
    period === 'thisMonth'
      ? clearPoints.map((_, index) =>
          new Date(range.start.getTime() + index * bucketDuration).toLocaleDateString([], { day: 'numeric' })
        )
      : WEEKDAY_LABELS;

  return (
    <View
      accessibilityLabel={`${clearPoints.reduce((total, value) => total + value, 0)} completed and ${missPoints.reduce((total, value) => total + value, 0)} missed across this period`}
      style={styles.rhythmChart}>
      {clearPoints.map((clearCount, index) => {
        const missCount = missPoints[index] ?? 0;
        const total = clearCount + missCount;
        const stackHeight = total === 0 ? 4 : Math.max(12, Math.round((total / maximum) * 58));

        return (
          <View
            accessibilityLabel={`${labels[index]}. ${clearCount} completed, ${missCount} missed`}
            key={`${labels[index]}-${index}`}
            style={styles.rhythmColumn}>
            <View style={styles.rhythmTrack}>
              {total === 0 ? (
                <View style={[styles.emptyRhythmBar, { backgroundColor: colors.line }]} />
              ) : (
                <View style={[styles.rhythmStack, { height: stackHeight }]}>
                  {missCount > 0 ? (
                    <View style={{ backgroundColor: colors.danger, flex: missCount }} />
                  ) : null}
                  {clearCount > 0 ? (
                    <View style={{ backgroundColor: colors.success, flex: clearCount }} />
                  ) : null}
                </View>
              )}
            </View>
            <Text style={[styles.rhythmLabel, { color: total > 0 ? colors.text : colors.muted }]}>
              {labels[index]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ProgressStat({
  helper,
  icon,
  label,
  value,
}: {
  helper: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <FlowPanel style={styles.progressStat}>
      <View style={styles.progressStatHeader}>
        <Ionicons color={colors.primary} name={icon} size={17} />
        <Text style={[styles.progressStatLabel, { color: colors.textSoft }]}>{label}</Text>
      </View>
      <Text style={[styles.progressStatValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.progressStatHelper, { color: colors.muted }]}>{helper}</Text>
    </FlowPanel>
  );
}

function getCategoryIcon(useCaseType: UseCaseType): keyof typeof Ionicons.glyphMap {
  switch (useCaseType) {
    case 'wake_up':
      return 'sunny-outline';
    case 'medication':
      return 'medical-outline';
    case 'study_start':
      return 'book-outline';
    case 'deep_work':
      return 'layers-outline';
    case 'leave_home':
      return 'exit-outline';
    case 'workout':
      return 'barbell-outline';
    default:
      return 'shapes-outline';
  }
}

function CategoryTile({ entry }: { entry: PeriodCategory }) {
  const colors = getAppColors(useColorScheme());
  const tone = entry.completionRate >= 70 ? 'success' : entry.completionRate >= 40 ? 'warning' : 'danger';
  const accentColor = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.danger;
  const accentSurface =
    tone === 'success' ? colors.successSurface : tone === 'warning' ? colors.warningSurface : colors.dangerSurface;

  return (
    <FlowPanel style={styles.categoryTile}>
      <View style={styles.categoryTileHeader}>
        <View style={[styles.categoryTileIcon, { backgroundColor: accentSurface }]}>
          <Ionicons color={accentColor} name={getCategoryIcon(entry.useCaseType)} size={18} />
        </View>
        <Text style={[styles.categoryTileValue, { color: accentColor }]}>{entry.completionRate}%</Text>
      </View>
      <View style={styles.categoryTileCopy}>
        <Text numberOfLines={1} style={[styles.categoryTileTitle, { color: colors.text }]}>
          {entry.label}
        </Text>
        <Text style={[styles.categoryTileHelper, { color: colors.textSoft }]}>
          {entry.successes} of {entry.attempts} completed
        </Text>
      </View>
      <FlowProgressBar progress={entry.completionRate / 100} tone={tone} />
    </FlowPanel>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: Spacing.lg,
    paddingBottom: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  periodTabs: {
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  periodTab: {
    alignItems: 'center',
    borderRadius: Radius.md - 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 6,
  },
  periodTabLabel: {
    ...TextPresets.label,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  progressHero: {
    borderRadius: Radius.lg,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  heroEyebrow: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 14,
  },
  heroMetricRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xl,
    justifyContent: 'space-between',
  },
  heroSummary: {
    gap: Spacing.sm,
  },
  summaryLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  summaryDot: {
    borderRadius: Radius.pill,
    height: 7,
    width: 7,
  },
  summaryText: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  heroMessage: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  trendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  trendText: {
    ...TextPresets.label,
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  activitySection: {
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
  sectionCount: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  activityPanel: {
    gap: 0,
    paddingHorizontal: Spacing.md,
    paddingVertical: 0,
  },
  activityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 66,
    paddingVertical: Spacing.sm,
  },
  activityIcon: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  activityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  activityTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  activityDetail: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  activityOutcome: {
    ...TextPresets.label,
    fontSize: 11,
    lineHeight: 15,
  },
  rhythmPanel: {
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  rhythmChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: Spacing.sm,
    height: 86,
    justifyContent: 'space-between',
  },
  rhythmColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 7,
  },
  rhythmTrack: {
    alignItems: 'center',
    height: 62,
    justifyContent: 'flex-end',
  },
  rhythmStack: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
    width: 16,
  },
  emptyRhythmBar: {
    borderRadius: Radius.pill,
    height: 4,
    width: 16,
  },
  rhythmLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  rhythmLegend: {
    flexDirection: 'row',
    gap: Spacing.lg,
    justifyContent: 'center',
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    borderRadius: Radius.pill,
    height: 6,
    width: 6,
  },
  legendLabel: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 14,
  },
  reliabilityPanel: {
    gap: 8,
    position: 'relative',
    zIndex: 2,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerFilter: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 8,
  },
  headerFilterText: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 13,
  },
  reliabilityContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reliabilityCopy: {
    gap: 2,
  },
  reliabilityValue: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 43,
  },
  reliabilityRing: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 9,
    height: 70,
    justifyContent: 'center',
    transform: [{ rotate: '42deg' }],
    width: 70,
  },
  ringHole: {
    borderRadius: Radius.pill,
    height: 38,
    width: 38,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  progressStat: {
    flex: 1,
    gap: 6,
    minWidth: 0,
    padding: Spacing.md,
  },
  progressStatHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  progressStatLabel: {
    ...TextPresets.eyebrow,
    flex: 1,
    fontSize: 9,
    lineHeight: 12,
  },
  progressStatValue: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  progressStatHelper: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 14,
  },
  calendarPanel: {
    gap: 8,
    position: 'relative',
    zIndex: 1,
  },
  dropdownPanelOpen: {
    elevation: 8,
    zIndex: 10,
  },
  periodMenu: {
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
    gap: 2,
    minWidth: 128,
    padding: 4,
    position: 'absolute',
    right: 10,
    shadowColor: '#000000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    top: 38,
    zIndex: 20,
  },
  periodOption: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 32,
    paddingHorizontal: 10,
  },
  periodOptionText: {
    ...TextPresets.body,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  weekdayRow: {
    flexDirection: 'row',
    width: '100%',
  },
  weekdayCell: {
    alignItems: 'center',
    flexBasis: '14.2857%',
    justifyContent: 'center',
  },
  weekdayLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
    textAlign: 'center',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  categoryTile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: Spacing.sm,
    minWidth: 0,
    padding: Spacing.md,
  },
  categoryTileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categoryTileIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  categoryTileValue: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  categoryTileCopy: {
    gap: 1,
  },
  categoryTileTitle: {
    ...TextPresets.label,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  categoryTileHelper: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 14,
  },
  insightPanel: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  insightCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  insightTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  insightBody: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  emptyCopy: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
});
