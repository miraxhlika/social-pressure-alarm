export const MAX_FAILURE_HISTORY = 10;
export const MAX_SUCCESS_HISTORY = 20;
export const MAX_CHECKPOINT_PRESETS = 8;

export type AlarmOutcome = 'confirmed' | 'missed';
export type RepeatSchedule = 'once' | 'daily' | 'weekdays';
export type AlarmProofStrictness = 'standard' | 'strict';
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
  alarmId: string;
  alarmLabel: string;
  scheduledFor?: string;
  outcome: AlarmOutcome;
  resolvedAt: string;
  source: 'device';
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
  hour: number;
  minute: number;
  label: string;
  useCaseType: UseCaseType;
  placeObject?: string;
  notes?: string;
  proofStrictness: AlarmProofStrictness;
  expectedQrPayload: string;
  proofCodeType?: AlarmProofCodeType;
  repeatSchedule: RepeatSchedule;
  gracePeriodSeconds: number;
  isActive: boolean;
  createdAt: string;
  scheduledFor?: string;
  socialSettings?: AlarmSocialSettings;
  lastOutcome?: AlarmOutcome;
};

export type AlarmRuntimeMetadata = {
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
