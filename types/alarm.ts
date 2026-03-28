export const FREE_ALARM_LIMIT = 3;
export const DEFAULT_ACCOUNTABILITY_MESSAGE =
  "I didn't wake up on time. Hold me accountable.";

export type Alarm = {
  id: string;
  hour: number;
  minute: number;
  contactName: string;
  phoneNumber: string;
  message: string;
  gracePeriodSeconds: number;
  isActive: boolean;
  createdAt: string;
  scheduledFor?: string;
  notificationId?: string;
  lastOutcome?: 'confirmed' | 'missed';
};

export type AlarmStore = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
};
