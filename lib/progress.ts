import { AlarmStore, SuccessHistoryEntry } from '@/types/alarm';

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

const STREAK_MILESTONES = [
  {
    threshold: 3,
    title: 'Momentum Builder',
    description: 'Lock in 3 wake-ups in a row.',
  },
  {
    threshold: 7,
    title: 'Weekly Warrior',
    description: 'Hold the line for a full week of wins.',
  },
  {
    threshold: 14,
    title: 'Consistency Machine',
    description: 'Two weeks of follow-through.',
  },
  {
    threshold: 30,
    title: 'Checkpoint Legend',
    description: 'Thirty straight clears is elite.',
  },
] as const;

const TITLE_LEVELS = [
  { threshold: 0, title: 'Rookie Scanner' },
  { threshold: 3, title: 'Momentum Builder' },
  { threshold: 7, title: 'Weekly Warrior' },
  { threshold: 14, title: 'Consistency Machine' },
  { threshold: 30, title: 'Checkpoint Legend' },
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
  activeBadges: ProgressBadge[];
  recentWins: SuccessHistoryEntry[];
  latestSuccess: SuccessHistoryEntry | null;
  nextGoalCopy: string;
};

function getTitleForScore(score: number) {
  return [...TITLE_LEVELS].reverse().find((level) => score >= level.threshold)?.title ?? TITLE_LEVELS[0].title;
}

export function getWeeklyCompletionStats(store: AlarmStore, now = Date.now()): WeeklyCompletionStats {
  const windowStart = now - WEEK_IN_MS;
  const successes = store.successHistory.filter(
    (entry) => new Date(entry.confirmedAt).getTime() >= windowStart
  ).length;
  const failures = store.failureHistory.filter(
    (entry) => new Date(entry.failedAt).getTime() >= windowStart
  ).length;
  const attempts = successes + failures;

  return {
    attempts,
    successes,
    failures,
    completionRate: attempts === 0 ? 0 : Math.round((successes / attempts) * 100),
  };
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

export function getProgressBadges(store: AlarmStore, now = Date.now()): ProgressBadge[] {
  const weeklyStats = getWeeklyCompletionStats(store, now);
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
      label: 'Comeback Streak',
      description: `You bounced back with ${store.currentStreak} wins after your last miss.`,
    });
  }

  if (
    latestSuccess &&
    latestSuccess.timeToScanSeconds <= Math.max(15, Math.floor(latestSuccess.gracePeriodSeconds / 3))
  ) {
    badges.push({
      id: 'fast-finish',
      label: 'Fast Finish',
      description: `Cleared in ${latestSuccess.timeToScanSeconds}s.`,
    });
  }

  return badges;
}

export function getProgressSummary(store: AlarmStore, now = Date.now()): ProgressSummary {
  const currentStreakMilestone =
    [...STREAK_MILESTONES].reverse().find((milestone) => store.currentStreak >= milestone.threshold) ??
    null;
  const nextStreakMilestone =
    STREAK_MILESTONES.find((milestone) => store.currentStreak < milestone.threshold) ?? null;
  const milestoneProgress = getMilestoneProgress(store.currentStreak);
  const weeklyStats = getWeeklyCompletionStats(store, now);

  return {
    checkpointTitle: getTitleForScore(store.longestStreak),
    currentStreakMilestone,
    nextStreakMilestone,
    milestoneProgress,
    weeklyStats,
    activeBadges: getProgressBadges(store, now),
    recentWins: store.successHistory.slice(0, 3),
    latestSuccess: store.successHistory[0] ?? null,
    nextGoalCopy: nextStreakMilestone
      ? `${milestoneProgress.remainingWins} more ${
          milestoneProgress.remainingWins === 1 ? 'win' : 'wins'
        } to reach ${nextStreakMilestone.title}.`
      : 'You have cleared every current milestone. Time to protect the legend run.',
  };
}
