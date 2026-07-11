import { getUseCaseLabel } from '@/lib/checkpoint-templates';
import {
  getFailureOccurrenceTimestamp,
  getSuccessOccurrenceTimestamp,
} from '@/lib/alarm-history';
import { AlarmOutcome, AlarmStore, SuccessHistoryEntry, UseCaseType } from '@/types/alarm';

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

const STREAK_MILESTONES = [
  {
    threshold: 3,
    title: 'Building Rhythm',
    description: '3 clears in a row.',
  },
  {
    threshold: 7,
    title: 'One Week',
    description: '7 clears in a row.',
  },
  {
    threshold: 14,
    title: 'Consistent',
    description: '14 clears in a row.',
  },
  {
    threshold: 30,
    title: 'Locked In',
    description: '30 clears in a row.',
  },
] as const;

const TITLE_LEVELS = [
  { threshold: 0, title: 'Getting Started' },
  { threshold: 3, title: 'Building Rhythm' },
  { threshold: 7, title: 'One Week' },
  { threshold: 14, title: 'Consistent' },
  { threshold: 30, title: 'Locked In' },
] as const;

export type ProgressBadge = {
  id: string;
  label: string;
  description: string;
};

export type WeeklyCompletionStats = {
  attempts: number;
  successes: number;
  failures: number;
  completionRate: number;
  averageTimeToClearSeconds: number | null;
  fastestClearSeconds: number | null;
};

export type UseCaseReliability = {
  useCaseType: UseCaseType;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  completionRate: number;
  averageTimeToClearSeconds: number | null;
  fastestClearSeconds: number | null;
  lastOutcome: AlarmOutcome | null;
  lastResolvedAt: string | null;
};

export type WeeklyReview = {
  title: string;
  body: string;
  strongestUseCase: UseCaseReliability | null;
  recoveryUseCase: UseCaseReliability | null;
  speedLabel: string;
  speedBody: string;
};

export type MilestoneProgress = {
  currentLabel: string;
  nextLabel: string | null;
  progressRatio: number;
  remainingWins: number;
};

export type ProgressSummary = {
  checkpointTitle: string;
  currentStreakMilestone: (typeof STREAK_MILESTONES)[number] | null;
  nextStreakMilestone: (typeof STREAK_MILESTONES)[number] | null;
  milestoneProgress: MilestoneProgress;
  weeklyStats: WeeklyCompletionStats;
  useCaseReliability: UseCaseReliability[];
  weeklyReview: WeeklyReview;
  activeBadges: ProgressBadge[];
  recentWins: SuccessHistoryEntry[];
  latestSuccess: SuccessHistoryEntry | null;
  nextGoalCopy: string;
};

type AttemptRecord = {
  alarmId: string;
  label: string;
  outcome: AlarmOutcome;
  resolvedAt: string;
  timeToScanSeconds: number | null;
  gracePeriodSeconds: number | null;
  useCaseType: UseCaseType;
};

function getTitleForScore(score: number) {
  return [...TITLE_LEVELS].reverse().find((level) => score >= level.threshold)?.title ?? TITLE_LEVELS[0].title;
}

function roundAverage(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
}

function getUseCaseTypesByAlarmId(store: AlarmStore) {
  return new Map(store.alarms.map((alarm) => [alarm.id, alarm.useCaseType]));
}

function getUseCaseTypeForAlarm(useCaseTypesByAlarmId: Map<string, UseCaseType>, alarmId: string): UseCaseType {
  return useCaseTypesByAlarmId.get(alarmId) ?? 'custom';
}

function getWeeklyAttemptRecords(store: AlarmStore, now = Date.now()): AttemptRecord[] {
  const windowStart = now - WEEK_IN_MS;
  const useCaseTypesByAlarmId = getUseCaseTypesByAlarmId(store);
  const successAttempts = store.successHistory
    .filter((entry) => new Date(getSuccessOccurrenceTimestamp(entry)).getTime() >= windowStart)
    .map<AttemptRecord>((entry) => ({
      alarmId: entry.alarmId,
      label: entry.label,
      outcome: 'confirmed',
      resolvedAt: getSuccessOccurrenceTimestamp(entry),
      timeToScanSeconds: entry.timeToScanSeconds,
      gracePeriodSeconds: entry.gracePeriodSeconds,
      useCaseType: getUseCaseTypeForAlarm(useCaseTypesByAlarmId, entry.alarmId),
    }));
  const failureAttempts = store.failureHistory
    .filter((entry) => new Date(getFailureOccurrenceTimestamp(entry)).getTime() >= windowStart)
    .map<AttemptRecord>((entry) => ({
      alarmId: entry.alarmId,
      label: entry.label,
      outcome: 'missed',
      resolvedAt: getFailureOccurrenceTimestamp(entry),
      timeToScanSeconds: null,
      gracePeriodSeconds: null,
      useCaseType: getUseCaseTypeForAlarm(useCaseTypesByAlarmId, entry.alarmId),
    }));

  return [...successAttempts, ...failureAttempts].sort(
    (left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime()
  );
}

function buildWeeklyCompletionStats(attempts: AttemptRecord[]): WeeklyCompletionStats {
  const successes = attempts.filter((entry) => entry.outcome === 'confirmed');
  const failures = attempts.length - successes.length;
  const clearTimes = successes
    .map((entry) => entry.timeToScanSeconds)
    .filter((value): value is number => typeof value === 'number');

  return {
    attempts: attempts.length,
    successes: successes.length,
    failures,
    completionRate: attempts.length === 0 ? 0 : Math.round((successes.length / attempts.length) * 100),
    averageTimeToClearSeconds: roundAverage(clearTimes),
    fastestClearSeconds: clearTimes.length > 0 ? Math.min(...clearTimes) : null,
  };
}

export function getWeeklyCompletionStats(store: AlarmStore, now = Date.now()): WeeklyCompletionStats {
  return buildWeeklyCompletionStats(getWeeklyAttemptRecords(store, now));
}

export function getMilestoneProgress(currentStreak: number): MilestoneProgress {
  const previousMilestone =
    [...STREAK_MILESTONES].reverse().find((milestone) => currentStreak >= milestone.threshold) ?? null;
  const nextMilestone = STREAK_MILESTONES.find((milestone) => currentStreak < milestone.threshold) ?? null;
  const lowerBound = previousMilestone?.threshold ?? 0;
  const upperBound = nextMilestone?.threshold ?? lowerBound;
  const range = Math.max(1, upperBound - lowerBound);
  const rawProgress = nextMilestone ? (currentStreak - lowerBound) / range : 1;

  return {
    currentLabel: previousMilestone?.title ?? TITLE_LEVELS[0].title,
    nextLabel: nextMilestone?.title ?? null,
    progressRatio: Math.max(0, Math.min(1, rawProgress)),
    remainingWins: nextMilestone ? nextMilestone.threshold - currentStreak : 0,
  };
}

function buildProgressBadges(store: AlarmStore, weeklyStats: WeeklyCompletionStats): ProgressBadge[] {
  const latestSuccess = store.successHistory[0] ?? null;
  const badges: ProgressBadge[] = [];
  const streakMilestone = [...STREAK_MILESTONES]
    .reverse()
    .find((milestone) => store.currentStreak >= milestone.threshold);

  if (streakMilestone) {
    badges.push({
      id: `milestone-${streakMilestone.threshold}`,
      label: streakMilestone.title,
      description: `${store.currentStreak} straight checkpoint clears.`,
    });
  }

  if (weeklyStats.attempts >= 3 && weeklyStats.completionRate === 100) {
    badges.push({
      id: 'perfect-week',
      label: 'Perfect Week',
      description: `No misses across ${weeklyStats.attempts} attempts this week.`,
    });
  }

  if (store.failureHistory.length > 0 && store.currentStreak >= 2) {
    badges.push({
      id: 'comeback',
      label: 'Bounce Back',
      description: `${store.currentStreak} wins since the last miss.`,
    });
  }

  if (
    latestSuccess &&
    latestSuccess.timeToScanSeconds <= Math.max(15, Math.floor(latestSuccess.gracePeriodSeconds / 3))
  ) {
    badges.push({
      id: 'fast-finish',
      label: 'Quick Clear',
      description: `Cleared in ${latestSuccess.timeToScanSeconds}s.`,
    });
  }

  return badges;
}

export function getProgressBadges(store: AlarmStore, now = Date.now()): ProgressBadge[] {
  return buildProgressBadges(store, getWeeklyCompletionStats(store, now));
}

function buildUseCaseReliability(attempts: AttemptRecord[]): UseCaseReliability[] {
  const groupedAttempts = attempts.reduce<Record<UseCaseType, AttemptRecord[]>>((groups, entry) => {
    const existingGroup = groups[entry.useCaseType] ?? [];
    existingGroup.push(entry);
    groups[entry.useCaseType] = existingGroup;
    return groups;
  }, {} as Record<UseCaseType, AttemptRecord[]>);

  return (Object.entries(groupedAttempts) as [UseCaseType, AttemptRecord[]][])
    .map(([useCaseType, groupedEntries]) => {
      const stats = buildWeeklyCompletionStats(groupedEntries);
      const lastAttempt = groupedEntries[0] ?? null;

      return {
        useCaseType,
        label: getUseCaseLabel(useCaseType),
        attempts: stats.attempts,
        successes: stats.successes,
        failures: stats.failures,
        completionRate: stats.completionRate,
        averageTimeToClearSeconds: stats.averageTimeToClearSeconds,
        fastestClearSeconds: stats.fastestClearSeconds,
        lastOutcome: lastAttempt?.outcome ?? null,
        lastResolvedAt: lastAttempt?.resolvedAt ?? null,
      };
    })
    .sort((left, right) => {
      if (right.completionRate !== left.completionRate) {
        return right.completionRate - left.completionRate;
      }

      if (right.attempts !== left.attempts) {
        return right.attempts - left.attempts;
      }

      return left.failures - right.failures;
    });
}

export function getUseCaseReliability(store: AlarmStore, now = Date.now()): UseCaseReliability[] {
  return buildUseCaseReliability(getWeeklyAttemptRecords(store, now));
}

function getStrongestUseCase(useCaseReliability: UseCaseReliability[]) {
  return (
    [...useCaseReliability]
      .filter((entry) => entry.successes > 0)
      .sort((left, right) => {
        if (right.completionRate !== left.completionRate) {
          return right.completionRate - left.completionRate;
        }

        if (right.successes !== left.successes) {
          return right.successes - left.successes;
        }

        return right.attempts - left.attempts;
      })[0] ?? null
  );
}

function getRecoveryUseCase(useCaseReliability: UseCaseReliability[]) {
  return (
    [...useCaseReliability]
      .filter((entry) => entry.failures > 0)
      .sort((left, right) => {
        if (right.failures !== left.failures) {
          return right.failures - left.failures;
        }

        if (left.completionRate !== right.completionRate) {
          return left.completionRate - right.completionRate;
        }

        return right.attempts - left.attempts;
      })[0] ?? null
  );
}

function buildWeeklyReview(
  weeklyStats: WeeklyCompletionStats,
  useCaseReliability: UseCaseReliability[]
): WeeklyReview {
  const strongestUseCase = getStrongestUseCase(useCaseReliability);
  const recoveryUseCase = getRecoveryUseCase(useCaseReliability);

  if (weeklyStats.attempts === 0) {
    return {
      title: 'No weekly review yet',
      body: 'Your first live clear or miss will turn this into a weekly review instead of a setup placeholder.',
      strongestUseCase: null,
      recoveryUseCase: null,
      speedLabel: 'No clear-time baseline yet',
      speedBody: 'Once a checkpoint clears, the app will show how fast you reached proof.',
    };
  }

  const speedLabel =
    weeklyStats.averageTimeToClearSeconds === null
      ? 'No clear-time baseline yet'
      : `Average clear in ${weeklyStats.averageTimeToClearSeconds}s`;
  const speedBody =
    weeklyStats.fastestClearSeconds === null
      ? 'Clear-time context appears once a successful run is logged.'
      : `Fastest clear this week: ${weeklyStats.fastestClearSeconds}s.`;

  if (weeklyStats.completionRate >= 90 && weeklyStats.attempts >= 3) {
    return {
      title: strongestUseCase ? `${strongestUseCase.label} is holding` : 'Your system held this week',
      body: recoveryUseCase
        ? `${weeklyStats.completionRate}% reliable overall. ${strongestUseCase?.label ?? 'Your routine'} led the week, and ${recoveryUseCase.label} is the only setup worth tightening next.`
        : `${weeklyStats.completionRate}% reliable overall with no routine slipping hard enough to demand a reset.`,
      strongestUseCase,
      recoveryUseCase,
      speedLabel,
      speedBody,
    };
  }

  if (weeklyStats.completionRate >= 70) {
    return {
      title: strongestUseCase ? `${strongestUseCase.label} stayed reliable` : 'Mostly reliable this week',
      body: recoveryUseCase
        ? `${weeklyStats.completionRate}% reliable overall. ${recoveryUseCase.label} caused ${recoveryUseCase.failures} miss${
            recoveryUseCase.failures === 1 ? '' : 'es'
          }, so adjust that setup before the next cycle.`
        : `${weeklyStats.completionRate}% reliable overall. Keep the current setups and add repetition before making bigger changes.`,
      strongestUseCase,
      recoveryUseCase,
      speedLabel,
      speedBody,
    };
  }

  if (recoveryUseCase) {
    return {
      title: `${recoveryUseCase.label} needs tightening`,
      body: `${weeklyStats.completionRate}% reliable overall. ${recoveryUseCase.label} accounted for ${recoveryUseCase.failures} miss${
        recoveryUseCase.failures === 1 ? '' : 'es'
      }, so change the timing or reach window before the next run.`,
      strongestUseCase,
      recoveryUseCase,
      speedLabel,
      speedBody,
    };
  }

  return {
    title: 'This week needs a sturdier setup',
    body: `${weeklyStats.completionRate}% reliable overall. Keep one commitment simple, reachable, and repeatable until the baseline improves.`,
    strongestUseCase,
    recoveryUseCase: null,
    speedLabel,
    speedBody,
  };
}

export function getWeeklyReview(store: AlarmStore, now = Date.now()): WeeklyReview {
  const attempts = getWeeklyAttemptRecords(store, now);
  const weeklyStats = buildWeeklyCompletionStats(attempts);
  const useCaseReliability = buildUseCaseReliability(attempts);

  return buildWeeklyReview(weeklyStats, useCaseReliability);
}

export function getProgressSummary(store: AlarmStore, now = Date.now()): ProgressSummary {
  const currentStreakMilestone =
    [...STREAK_MILESTONES].reverse().find((milestone) => store.currentStreak >= milestone.threshold) ??
    null;
  const nextStreakMilestone =
    STREAK_MILESTONES.find((milestone) => store.currentStreak < milestone.threshold) ?? null;
  const milestoneProgress = getMilestoneProgress(store.currentStreak);
  const weeklyAttempts = getWeeklyAttemptRecords(store, now);
  const weeklyStats = buildWeeklyCompletionStats(weeklyAttempts);
  const useCaseReliability = buildUseCaseReliability(weeklyAttempts);
  const weeklyReview = buildWeeklyReview(weeklyStats, useCaseReliability);

  return {
    checkpointTitle: getTitleForScore(store.longestStreak),
    currentStreakMilestone,
    nextStreakMilestone,
    milestoneProgress,
    weeklyStats,
    useCaseReliability,
    weeklyReview,
    activeBadges: buildProgressBadges(store, weeklyStats),
    recentWins: store.successHistory.slice(0, 3),
    latestSuccess: store.successHistory[0] ?? null,
    nextGoalCopy: nextStreakMilestone
      ? `${milestoneProgress.remainingWins} more ${
          milestoneProgress.remainingWins === 1 ? 'win' : 'wins'
        } to reach ${nextStreakMilestone.title}.`
      : 'You are in the highest streak tier.',
  };
}
