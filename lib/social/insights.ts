import { getProgressSummary } from '@/lib/progress';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { buildAccountProgressState, listMyAlarmEventHistory } from '@/lib/social/progress';
import {
  SocialChallengeSummary,
  SocialDashboardInsights,
  SocialFeedItem,
  SocialLeaderboardEntry,
} from '@/lib/social/types';
import { AlarmStore } from '@/types/alarm';

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

function createProgressStore(progressState: ReturnType<typeof buildAccountProgressState>): AlarmStore {
  return {
    alarms: [],
    lifetimeAlarmCreations: 0,
    currentStreak: progressState.currentStreak,
    longestStreak: progressState.longestStreak,
    failureHistory: progressState.failureHistory,
    successHistory: progressState.successHistory,
    checkpointPresets: [],
  };
}

function buildChallenges(rows: Awaited<ReturnType<typeof listMyAlarmEventHistory>>) {
  const progressState = buildAccountProgressState(rows);
  const summary = getProgressSummary(createProgressStore(progressState));
  const windowStart = Date.now() - WEEK_IN_MS;
  const earlyWins = rows.filter((row) => {
    if (row.outcome !== 'confirmed' || !row.scheduled_for) {
      return false;
    }

    const scheduledTimestamp = new Date(row.scheduled_for).getTime();

    if (scheduledTimestamp < windowStart) {
      return false;
    }

    return new Date(row.scheduled_for).getHours() < 8;
  }).length;

  const perfectWeekAttempts = summary.weeklyStats.attempts;
  const perfectWeekWins = summary.weeklyStats.successes;

  return [
    {
      id: 'seven-day-streak',
      title: '7-day wake streak',
      description: 'Hold seven confirmed clears in a row.',
      progressLabel: `${Math.min(progressState.currentStreak, 7)}/7 clears`,
      progressRatio: Math.min(1, progressState.currentStreak / 7),
      isCompleted: progressState.currentStreak >= 7,
    },
    {
      id: 'perfect-week',
      title: 'No misses this week',
      description: 'Keep the last seven days miss-free.',
      progressLabel: perfectWeekAttempts === 0 ? '0 attempts logged' : `${perfectWeekWins}/${perfectWeekAttempts} clean`,
      progressRatio:
        perfectWeekAttempts === 0
          ? 0
          : summary.weeklyStats.failures === 0
            ? Math.min(1, perfectWeekWins / Math.max(3, perfectWeekAttempts))
            : 0,
      isCompleted: perfectWeekAttempts >= 3 && summary.weeklyStats.failures === 0,
    },
    {
      id: 'three-before-eight',
      title: '3 clean clears before 8am',
      description: 'Stack three successful early clears this week.',
      progressLabel: `${Math.min(earlyWins, 3)}/3 early wins`,
      progressRatio: Math.min(1, earlyWins / 3),
      isCompleted: earlyWins >= 3,
    },
  ] satisfies SocialChallengeSummary[];
}

function buildLeaderboard(feed: SocialFeedItem[]) {
  const leaderboardMap = new Map<string, SocialLeaderboardEntry>();
  const windowStart = Date.now() - WEEK_IN_MS;

  for (const item of feed) {
    const resolvedTimestamp = new Date(item.resolvedAt).getTime();

    if (resolvedTimestamp < windowStart) {
      continue;
    }

    const existingEntry =
      leaderboardMap.get(item.actorId) ??
      {
        userId: item.actorId,
        displayName: item.actorDisplayName,
        handle: item.actorHandle,
        wins: 0,
        misses: 0,
        completionRate: 0,
        bestStreak: 0,
        isMe: item.isOwnEvent,
      };

    leaderboardMap.set(item.actorId, {
      ...existingEntry,
      wins: existingEntry.wins + (item.outcome === 'confirmed' ? 1 : 0),
      misses: existingEntry.misses + (item.outcome === 'missed' ? 1 : 0),
      completionRate: Math.max(existingEntry.completionRate, item.sharePayload.weeklyCompletionRate),
      bestStreak: Math.max(existingEntry.bestStreak, item.sharePayload.currentStreak),
    });
  }

  return [...leaderboardMap.values()]
    .map((entry) => ({
      ...entry,
      completionRate:
        entry.wins + entry.misses === 0
          ? entry.completionRate
          : Math.round((entry.wins / (entry.wins + entry.misses)) * 100),
    }))
    .sort((left, right) => {
      if (left.wins === right.wins) {
        if (left.bestStreak === right.bestStreak) {
          return right.completionRate - left.completionRate;
        }

        return right.bestStreak - left.bestStreak;
      }

      return right.wins - left.wins;
    })
    .slice(0, 5);
}

export async function getSocialDashboardInsights(): Promise<SocialDashboardInsights> {
  const [rows, feed] = await Promise.all([listMyAlarmEventHistory(150), listVisibleSocialFeed(40)]);

  return {
    challenges: buildChallenges(rows),
    leaderboard: buildLeaderboard(feed),
  };
}
