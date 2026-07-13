export const MAX_FAILURE_HISTORY = 10;
export const MAX_SUCCESS_HISTORY = 20;
export const MAX_CHECKPOINT_PRESETS = 8;

export type AlarmOutcome = 'confirmed' | 'missed';
export type RepeatSchedule = 'once' | 'daily' | 'weekdays';
export type AlarmNotificationKind = 'primary' | 'urgency' | 'readiness';
export type AlarmProofCodeType = 'qr' | 'barcode';
export type UseCaseType =
  | 'wake_up'
  | 'medication'
  | 'study_start'
  | 'deep_work'
  | 'leave_home'
  | 'workout'
  | 'custom';

export type AlarmSocialSettings = {
  circleId?: string;
  shareSuccesses: boolean;
  shareMisses: boolean;
};

export type AlarmEventSharePayload = {
  currentStreak: number;
  longestStreak: number;
  gracePeriodSeconds: number;
  timeToScanSeconds?: number;
  weeklyCompletionRate: number;
  weeklySuccesses: number;
  weeklyFailures: number;
};

export type AlarmEventRecord = {
  id: string;
  occurrenceKey: string;
  alarmId: string;
  alarmLabel: string;
  scheduledFor?: string;
  outcome: AlarmOutcome;
  resolvedAt: string;
  capturedAt: string;
  scheduleRevision: number;
  source: 'device';
  clientId?: string;
  idempotencyKey?: string;
  socialSettings?: AlarmSocialSettings;
  sharePayload: AlarmEventSharePayload;
};

export type QueuedAlarmEvent = AlarmEventRecord & {
  attempts: number;
  lastAttemptAt?: string;
  lastSyncError?: string;
};

export type FailureHistoryEntry = {
  alarmId: string;
  label: string;
  scheduledFor?: string;
  failedAt: string;
};

export type SuccessHistoryEntry = {
  alarmId: string;
  label: string;
  scheduledFor?: string;
  confirmedAt: string;
  timeToScanSeconds: number;
  gracePeriodSeconds: number;
};

export type CheckpointPreset = {
  id: string;
  label: string;
  expectedQrPayload: string;
  createdAt: string;
  lastUsedAt: string;
};

export type AlarmDefinition = {
  id: string;
  clientId?: string;
  hour: number;
  minute: number;
  label: string;
  useCaseType: UseCaseType;
  placeObject?: string;
  notes?: string;
  expectedQrPayload: string;
  proofCodeType?: AlarmProofCodeType;
  repeatSchedule: RepeatSchedule;
  timezone: string;
  scheduleRevision: number;
  gracePeriodSeconds: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  scheduledFor?: string;
  socialSettings?: AlarmSocialSettings;
  lastOutcome?: AlarmOutcome;
};

export type AlarmNotificationRegistration = {
  identifier: string;
  kind: AlarmNotificationKind;
  triggerSignature: string;
  weekday?: number;
};

export type AlarmRuntimeMetadata = {
  isPracticeRun?: boolean;
  notificationRegistrations?: AlarmNotificationRegistration[];
  /** Legacy identifiers retained until the runtime store has been migrated. */
  notificationIds?: string[];
  scheduledFor?: string;
  notificationStrategyKey?: string;
};

export type Alarm = AlarmDefinition & AlarmRuntimeMetadata;

export type AlarmStore = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
  currentStreak: number;
  longestStreak: number;
  failureHistory: FailureHistoryEntry[];
  successHistory: SuccessHistoryEntry[];
  checkpointPresets: CheckpointPreset[];
};
