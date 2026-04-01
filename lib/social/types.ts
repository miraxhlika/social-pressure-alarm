import { AlarmEventSharePayload, QueuedAlarmEvent } from '@/types/alarm';

export type SocialProfile = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  timezone: string;
  allowCircleNotifications: boolean;
  allowMissedAlarmAlerts: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CircleMembershipRole = 'owner' | 'member';

export type SocialCircleSummary = {
  id: string;
  name: string;
  description?: string | null;
  inviteCode: string;
  memberCount: number;
  myRole: CircleMembershipRole;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertSocialProfileInput = {
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  timezone: string;
  allowCircleNotifications: boolean;
  allowMissedAlarmAlerts: boolean;
};

export type CreateSocialCircleInput = {
  name: string;
  description?: string;
};

export type SocialFeedItem = {
  id: string;
  alarmId: string;
  alarmLabel: string;
  outcome: 'confirmed' | 'missed';
  resolvedAt: string;
  scheduledFor?: string;
  circleId: string;
  circleName: string;
  actorId: string;
  actorDisplayName: string;
  actorHandle: string;
  isOwnEvent: boolean;
  sharePayload: AlarmEventSharePayload;
};

export type SocialQueueSummary = {
  pendingCount: number;
  failedCount: number;
  queuedEvents: QueuedAlarmEvent[];
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  latestError?: string;
};

export type SocialRuntimeSnapshot = {
  configured: boolean;
  authenticated: boolean;
  queue: SocialQueueSummary;
};

export type SocialChallengeSummary = {
  id: string;
  title: string;
  description: string;
  progressLabel: string;
  progressRatio: number;
  isCompleted: boolean;
};

export type SocialLeaderboardEntry = {
  userId: string;
  displayName: string;
  handle: string;
  wins: number;
  misses: number;
  completionRate: number;
  bestStreak: number;
  isMe: boolean;
};

export type SocialDashboardInsights = {
  challenges: SocialChallengeSummary[];
  leaderboard: SocialLeaderboardEntry[];
};
