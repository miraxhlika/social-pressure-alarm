import { QueuedAlarmEvent } from '@/types/alarm';

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

export type UpsertSocialProfileInput = {
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  timezone: string;
  allowCircleNotifications: boolean;
  allowMissedAlarmAlerts: boolean;
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
