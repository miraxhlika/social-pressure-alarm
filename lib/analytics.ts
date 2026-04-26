import { readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';
import { RepeatSchedule, UseCaseType } from '@/types/alarm';

const ANALYTICS_STORAGE_KEY = 'social-pressure-alarm/analytics-events';
const MAX_ANALYTICS_EVENTS = 250;

export type AnalyticsEventName =
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'use_case_selected'
  | 'demo_checkpoint_created'
  | 'demo_checkpoint_cleared'
  | 'recurring_checkpoint_saved'
  | 'checkpoint_cleared'
  | 'checkpoint_missed'
  | 'first_miss'
  | 'miss_recovery_action'
  | 'second_checkpoint_created'
  | 'invite_sent'
  | 'invite_accepted';

type BaseCheckpointPayload = {
  checkpointId?: string;
  useCaseType?: UseCaseType;
  repeatSchedule?: RepeatSchedule;
  gracePeriodSeconds?: number;
};

export type AnalyticsPayloadMap = {
  onboarding_started: {
    source: 'app_launch' | 'manual';
  };
  onboarding_completed: {
    mode: 'local' | 'optional_sign_in';
    cameraPermission: 'granted' | 'denied' | 'undetermined';
    notificationPermission: 'granted' | 'provisional' | 'denied' | 'undetermined';
  };
  use_case_selected: {
    source: 'create' | 'onboarding';
    useCaseType: UseCaseType;
  };
  demo_checkpoint_created: {
    useCaseType: UseCaseType;
  };
  demo_checkpoint_cleared: {
    checkpointId?: string;
    useCaseType?: UseCaseType;
    timeToClearSeconds?: number;
  };
  recurring_checkpoint_saved: BaseCheckpointPayload & {
    creationCountBeforeSave: number;
    source: 'new' | 'reuse';
    socialMode: 'private' | 'circle';
  };
  checkpoint_cleared: BaseCheckpointPayload & {
    timeToClearSeconds?: number;
  };
  checkpoint_missed: BaseCheckpointPayload & {
    failureCount: number;
  };
  first_miss: BaseCheckpointPayload;
  miss_recovery_action: BaseCheckpointPayload & {
    action: 'reschedule' | 'edit' | 'retry';
  };
  second_checkpoint_created: BaseCheckpointPayload;
  invite_sent: {
    circleId?: string;
  };
  invite_accepted: {
    circleId?: string;
  };
};

export type AnalyticsEvent<TName extends AnalyticsEventName = AnalyticsEventName> = {
  id: string;
  name: TName;
  occurredAt: string;
  payload: AnalyticsPayloadMap[TName];
};

export const ANALYTICS_EVENT_CATALOG: Record<
  AnalyticsEventName,
  {
    description: string;
    payload: string[];
  }
> = {
  onboarding_started: {
    description: 'User entered first-run onboarding.',
    payload: ['source'],
  },
  onboarding_completed: {
    description: 'User completed first-run onboarding.',
    payload: ['mode', 'cameraPermission', 'notificationPermission'],
  },
  use_case_selected: {
    description: 'User selected a checkpoint use case.',
    payload: ['source', 'useCaseType'],
  },
  demo_checkpoint_created: {
    description: 'A low-friction demo checkpoint was created.',
    payload: ['useCaseType'],
  },
  demo_checkpoint_cleared: {
    description: 'A demo checkpoint was successfully cleared.',
    payload: ['checkpointId', 'useCaseType', 'timeToClearSeconds'],
  },
  recurring_checkpoint_saved: {
    description: 'A real saved checkpoint was created.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds', 'creationCountBeforeSave', 'source', 'socialMode'],
  },
  checkpoint_cleared: {
    description: 'A saved checkpoint was cleared.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds', 'timeToClearSeconds'],
  },
  checkpoint_missed: {
    description: 'A saved checkpoint was missed.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds', 'failureCount'],
  },
  first_miss: {
    description: 'User recorded their first miss.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds'],
  },
  miss_recovery_action: {
    description: 'User took a recovery action after a miss.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds', 'action'],
  },
  second_checkpoint_created: {
    description: 'User created a second real checkpoint.',
    payload: ['checkpointId', 'useCaseType', 'repeatSchedule', 'gracePeriodSeconds'],
  },
  invite_sent: {
    description: 'User sent a circle invite.',
    payload: ['circleId'],
  },
  invite_accepted: {
    description: 'User accepted a circle invite.',
    payload: ['circleId'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === 'string' && value in ANALYTICS_EVENT_CATALOG;
}

function normalizeAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!isRecord(value) || !isAnalyticsEventName(value.name) || typeof value.id !== 'string' || typeof value.occurredAt !== 'string') {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    occurredAt: value.occurredAt,
    payload: isRecord(value.payload) ? (value.payload as AnalyticsPayloadMap[AnalyticsEventName]) : ({} as AnalyticsPayloadMap[AnalyticsEventName]),
  };
}

export async function readAnalyticsEvents() {
  const scopedValue = await readScopedStorageValue(ANALYTICS_STORAGE_KEY);

  if (!scopedValue.value) {
    return [] as AnalyticsEvent[];
  }

  try {
    const parsed = JSON.parse(scopedValue.value) as unknown[];
    return Array.isArray(parsed)
      ? parsed.map(normalizeAnalyticsEvent).filter((event): event is AnalyticsEvent => event !== null)
      : [];
  } catch {
    return [] as AnalyticsEvent[];
  }
}

export async function trackAnalyticsEvent<TName extends AnalyticsEventName>(
  name: TName,
  payload: AnalyticsPayloadMap[TName]
) {
  const nextEvent: AnalyticsEvent<TName> = {
    id: `${name}-${Date.now()}`,
    name,
    occurredAt: new Date().toISOString(),
    payload,
  };
  const existingEvents = await readAnalyticsEvents();
  const nextEvents = [nextEvent, ...existingEvents].slice(0, MAX_ANALYTICS_EVENTS);

  await writeScopedStorageValue(ANALYTICS_STORAGE_KEY, JSON.stringify(nextEvents));

  if (__DEV__) {
    console.info('[analytics]', nextEvent.name, nextEvent.payload);
  }

  return nextEvent;
}
