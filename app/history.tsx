import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowIconBadge,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import {
  FlowCalendarDots,
  FlowDelta,
  FlowLegend,
  FlowMetricCard,
  FlowProgressBar,
  FlowTrendLine,
} from '@/components/ui/flow-visuals';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { getProgressSummary, ProgressSummary, UseCaseReliability } from '@/lib/progress';
import { AlarmStore, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type HistoryState = {
  store: AlarmStore | null;
  summary: ProgressSummary | null;
};

type AnalyticPeriod = 'thisWeek' | 'lastWeek' | 'thisMonth';
type CalendarPeriod = 'thisMonth' | 'lastMonth';
type CalendarDotTone = 'high' | 'medium' | 'low' | 'missed' | 'empty' | 'blank';
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

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ANALYTIC_PERIOD_LABELS: Record<AnalyticPeriod, string> = {
  lastWeek: 'Last Week',
  thisMonth: 'This Month',
  thisWeek: 'This Week',
};
const CALENDAR_PERIOD_LABELS: Record<CalendarPeriod, string> = {
  lastMonth: 'Last Month',
  thisMonth: 'This Month',
};
const ANALYTIC_PERIOD_OPTIONS: AnalyticPeriod[] = ['thisWeek', 'lastWeek', 'thisMonth'];
const CALENDAR_PERIOD_OPTIONS: CalendarPeriod[] = ['thisMonth', 'lastMonth'];
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

function getCalendarMonthStart(period: CalendarPeriod, day = new Date()) {
  const thisMonthStart = getStartOfMonth(day);
  return period === 'lastMonth' ? addMonths(thisMonthStart, -1) : thisMonthStart;
}

function isSameLocalDay(leftTimestamp: string, right: Date) {
  const left = new Date(leftTimestamp);

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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
  const successes = store.successHistory.filter((entry) => isInRange(entry.confirmedAt, range));
  const failures = store.failureHistory.filter((entry) => isInRange(entry.failedAt, range));
  const clearPoints = Array.from({ length: range.bucketCount }, () => 0);
  const missPoints = Array.from({ length: range.bucketCount }, () => 0);

  successes.forEach((entry) => {
    clearPoints[getBucketIndex(entry.confirmedAt, range)] += 1;
  });
  failures.forEach((entry) => {
    missPoints[getBucketIndex(entry.failedAt, range)] += 1;
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

function getMonthCalendarDots(
  successes: SuccessHistoryEntry[],
  failures: FailureHistoryEntry[],
  period: CalendarPeriod,
  day = new Date()
): CalendarDotTone[] {
  const monthStart = getCalendarMonthStart(period, day);
  const nextMonthStart = addMonths(monthStart, 1);
  const daysInMonth = Math.round((nextMonthStart.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
  const leadingBlankDays = monthStart.getDay();
  const totalCells = leadingBlankDays + daysInMonth <= 35 ? 35 : 42;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayOfMonth = index - leadingBlankDays + 1;

    if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
      return 'blank';
    }

    const date = new Date(monthStart);
    date.setDate(dayOfMonth);
    const clearCount = successes.filter((entry) => isSameLocalDay(entry.confirmedAt, date)).length;
    const missCount = failures.filter((entry) => isSameLocalDay(entry.failedAt, date)).length;

    if (missCount > 0 && clearCount === 0) {
      return 'missed';
    }

    if (clearCount >= 2) {
      return 'high';
    }

    if (clearCount === 1 && missCount === 0) {
      return 'medium';
    }

    if (clearCount > 0 || missCount > 0) {
      return 'low';
    }

    return 'empty';
  });
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

function getCountDelta(currentCount: number, previous: PeriodStats, previousCount: number, comparisonLabel: string, lowerIsBetter = false) {
  if (previous.attempts === 0) {
    return {
      tone: 'warning' as const,
      value: currentCount === 0 ? 'No scans in this period yet' : 'First baseline for this period',
    };
  }

  const delta = currentCount - previousCount;

  if (delta === 0) {
    return { tone: 'warning' as const, value: `No change vs ${comparisonLabel}` };
  }

  const isPositiveOutcome = lowerIsBetter ? delta < 0 : delta > 0;

  return {
    tone: isPositiveOutcome ? ('success' as const) : ('danger' as const),
    value: `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than ${comparisonLabel}`,
  };
}

export default function HistoryScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [analyticPeriod, setAnalyticPeriod] = useState<AnalyticPeriod>('thisWeek');
  const [calendarPeriod, setCalendarPeriod] = useState<CalendarPeriod>('thisMonth');
  const [openDropdown, setOpenDropdown] = useState<'analytics' | 'calendar' | null>(null);
  const [state, setState] = useState<HistoryState>({ store: null, summary: null });

  const loadHistory = useCallback(async () => {
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();
      setState({ store, summary: getProgressSummary(store) });
    } finally {
      setIsLoading(false);
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
  const calendarDots = useMemo(
    () => (state.store ? getMonthCalendarDots(state.store.successHistory, state.store.failureHistory, calendarPeriod) : []),
    [calendarPeriod, state.store]
  );
  const reliability = periodStats.completionRate;
  const clears = periodStats.successes;
  const misses = periodStats.failures;
  const reliabilityDelta = getReliabilityDelta(periodStats, previousPeriodStats, periodRange.comparisonLabel);
  const clearDelta = getCountDelta(clears, previousPeriodStats, previousPeriodStats.successes, periodRange.comparisonLabel);
  const missDelta = getCountDelta(misses, previousPeriodStats, previousPeriodStats.failures, periodRange.comparisonLabel, true);
  const categoryPerformance = state.summary?.useCaseReliability.slice(0, 3) ?? [];

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock title="Loading history" description="Building your clears, misses, and weekly review." />
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
          title="History & Analytics"
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
        title="History & Analytics"
      />

      <FlowPanel style={styles.reliabilityPanel}>
        <View style={styles.panelHeader}>
          <FlowSectionLabel>WEEKLY RELIABILITY</FlowSectionLabel>
          <Pressable
            accessibilityLabel="Change analytics period"
            accessibilityRole="button"
            onPress={() => setOpenDropdown((current) => (current === 'analytics' ? null : 'analytics'))}
            style={({ pressed }) => [styles.headerFilter, pressed && styles.pressed]}>
            <Text style={[styles.headerFilterText, { color: colors.textSoft }]}>
              {ANALYTIC_PERIOD_LABELS[analyticPeriod]}
            </Text>
            <Ionicons color={colors.textSoft} name="chevron-down" size={12} />
          </Pressable>
        </View>
        {openDropdown === 'analytics' ? (
          <PeriodMenu
            activeValue={analyticPeriod}
            getLabel={(value) => ANALYTIC_PERIOD_LABELS[value]}
            onSelect={(value) => {
              setAnalyticPeriod(value);
              setOpenDropdown(null);
            }}
            options={ANALYTIC_PERIOD_OPTIONS}
          />
        ) : null}

        <View style={styles.reliabilityContent}>
          <View style={styles.reliabilityCopy}>
            <Text style={[styles.reliabilityValue, { color: colors.text }]}>{reliability}%</Text>
            <FlowDelta tone={reliabilityDelta.tone} value={reliabilityDelta.value} />
          </View>
          <ReliabilityRing progress={reliability / 100} />
        </View>
      </FlowPanel>

      <View style={styles.metricGrid}>
        <FlowMetricCard
          footer={<FlowDelta tone={clearDelta.tone} value={clearDelta.value} />}
          label="Clear Scans"
          tone="success"
          value={`${clears}`}>
          <FlowTrendLine points={periodStats.clearPoints} tone="success" />
        </FlowMetricCard>
        <FlowMetricCard
          footer={<FlowDelta tone={missDelta.tone} value={missDelta.value} />}
          label="Missed Scans"
          tone={misses > 0 ? 'danger' : 'success'}
          value={`${misses}`}>
          <FlowTrendLine points={periodStats.missPoints} tone={misses > 0 ? 'danger' : 'success'} />
        </FlowMetricCard>
      </View>

      <FlowPanel style={styles.calendarPanel}>
        <View style={styles.panelHeader}>
          <FlowSectionLabel>ACTIVITY CALENDAR</FlowSectionLabel>
          <Pressable
            accessibilityLabel="Change activity calendar month"
            accessibilityRole="button"
            onPress={() => setOpenDropdown((current) => (current === 'calendar' ? null : 'calendar'))}
            style={({ pressed }) => [styles.headerFilter, pressed && styles.pressed]}>
            <Text style={[styles.headerFilterText, { color: colors.textSoft }]}>
              {CALENDAR_PERIOD_LABELS[calendarPeriod]}
            </Text>
            <Ionicons color={colors.textSoft} name="chevron-down" size={12} />
          </Pressable>
        </View>
        {openDropdown === 'calendar' ? (
          <PeriodMenu
            activeValue={calendarPeriod}
            getLabel={(value) => CALENDAR_PERIOD_LABELS[value]}
            onSelect={(value) => {
              setCalendarPeriod(value);
              setOpenDropdown(null);
            }}
            options={CALENDAR_PERIOD_OPTIONS}
          />
        ) : null}
        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label, index) => (
            <View key={`${label}-${index}`} style={styles.weekdayCell}>
              <Text style={[styles.weekdayLabel, { color: colors.textSoft }]}>{label}</Text>
            </View>
          ))}
        </View>
        <FlowCalendarDots dots={calendarDots} />
        <FlowLegend
          items={[
            { label: 'High', tone: 'high' },
            { label: 'Medium', tone: 'medium' },
            { label: 'Low', tone: 'low' },
            { label: 'Missed', tone: 'missed' },
          ]}
        />
      </FlowPanel>

      <FlowPanel style={styles.categoryPanel}>
        <FlowSectionLabel>CATEGORY PERFORMANCE</FlowSectionLabel>
        {categoryPerformance.length > 0 ? (
          <View style={styles.categoryRows}>
            {categoryPerformance.map((entry) => (
              <CategoryRow entry={entry} key={entry.useCaseType} />
            ))}
          </View>
        ) : (
          <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>
            Category performance appears after at least one checkpoint resolves this week.
          </Text>
        )}
      </FlowPanel>

      <FlowPanel style={styles.insightPanel}>
        <FlowIconBadge icon="star" size="small" tone="warning" />
        <View style={styles.insightCopy}>
          <Text style={[styles.insightTitle, { color: colors.text }]}>Insight</Text>
          <Text style={[styles.insightBody, { color: colors.textSoft }]}>{getInsight(state.summary)}</Text>
        </View>
      </FlowPanel>
    </AppScreen>
  );
}

function PeriodMenu<TValue extends string>({
  activeValue,
  getLabel,
  onSelect,
  options,
}: {
  activeValue: TValue;
  getLabel: (value: TValue) => string;
  onSelect: (value: TValue) => void;
  options: TValue[];
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.periodMenu, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      {options.map((option) => {
        const isActive = option === activeValue;

        return (
          <Pressable
            accessibilityRole="menuitem"
            key={option}
            onPress={() => onSelect(option)}
            style={({ pressed }) => [
              styles.periodOption,
              {
                backgroundColor: isActive ? colors.panelMuted : 'transparent',
                opacity: pressed ? 0.78 : 1,
              },
            ]}>
            <Text style={[styles.periodOptionText, { color: isActive ? colors.text : colors.textSoft }]}>
              {getLabel(option)}
            </Text>
            {isActive ? <Ionicons color={colors.primary} name="checkmark" size={14} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ReliabilityRing({ progress }: { progress: number }) {
  const colors = getAppColors(useColorScheme());
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const mutedRing = withAlpha(colors.success, '2A');
  const activeRing = colors.success;

  return (
    <View
      accessibilityLabel={`${Math.round(clampedProgress * 100)}% weekly reliability`}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clampedProgress * 100) }}
      style={[
        styles.reliabilityRing,
        {
          borderColor: activeRing,
          borderLeftColor: clampedProgress > 0.25 ? activeRing : mutedRing,
          borderTopColor: clampedProgress > 0.5 ? activeRing : mutedRing,
          borderRightColor: clampedProgress > 0.75 ? activeRing : mutedRing,
        },
      ]}>
      <View style={[styles.ringHole, { backgroundColor: colors.elevated }]} />
    </View>
  );
}

function CategoryRow({ entry }: { entry: UseCaseReliability }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View
      accessibilityLabel={`${entry.label}. ${entry.completionRate}% reliable.`}
      style={styles.categoryRow}>
      <FlowIconBadge icon={getCategoryIcon(entry.label)} size="small" tone="muted" />
      <View style={styles.categoryCopy}>
        <Text numberOfLines={1} style={[styles.categoryTitle, { color: colors.text }]}>
          {entry.label}
        </Text>
        <FlowProgressBar progress={entry.completionRate / 100} tone="success" />
      </View>
      <Text style={[styles.categoryValue, { color: colors.textSoft }]}>{entry.completionRate}%</Text>
    </View>
  );
}

function getCategoryIcon(label: string): keyof typeof Ionicons.glyphMap {
  const normalizedLabel = label.toLowerCase();

  if (normalizedLabel.includes('home') || normalizedLabel.includes('leave')) {
    return 'home-outline';
  }

  if (normalizedLabel.includes('work') || normalizedLabel.includes('study')) {
    return 'briefcase-outline';
  }

  if (normalizedLabel.includes('medication')) {
    return 'medical-outline';
  }

  return 'fitness-outline';
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 8,
    paddingBottom: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  reliabilityPanel: {
    gap: 8,
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
  calendarPanel: {
    gap: 8,
  },
  periodMenu: {
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
    minWidth: 128,
    padding: 4,
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
  categoryPanel: {
    gap: 8,
  },
  categoryRows: {
    gap: 7,
  },
  categoryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 34,
  },
  categoryCopy: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  categoryTitle: {
    ...TextPresets.body,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  categoryValue: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 14,
  },
  insightPanel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
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
