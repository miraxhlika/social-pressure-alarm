import { readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';
import { Alarm } from '@/types/alarm';

const SNOOZE_STORAGE_KEY = 'social-pressure-alarm/snoozes';
const MAX_SNOOZE_MINUTES = 5;
/** Leave enough of the window after the reminder for the user to act. */
const SNOOZE_DEADLINE_BUFFER_SECONDS = 60;

type SnoozeRecord = {
  scheduledFor: string;
  until: string;
};

type SnoozeStore = Record<string, SnoozeRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSnoozeStore(value: unknown): SnoozeStore {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<SnoozeStore>((result, [alarmId, record]) => {
    if (
      isRecord(record) &&
      typeof record.scheduledFor === 'string' &&
      typeof record.until === 'string' &&
      !Number.isNaN(new Date(record.until).getTime())
    ) {
      result[alarmId] = { scheduledFor: record.scheduledFor, until: record.until };
    }

    return result;
  }, {});
}

async function readSnoozeStore() {
  const { value } = await readScopedStorageValue(SNOOZE_STORAGE_KEY);

  if (!value) {
    return {} as SnoozeStore;
  }

  try {
    return normalizeSnoozeStore(JSON.parse(value));
  } catch {
    return {} as SnoozeStore;
  }
}

async function writeSnoozeStore(store: SnoozeStore) {
  const now = Date.now();
  const activeEntries = Object.entries(store).filter(([, record]) => new Date(record.until).getTime() > now);
  await writeScopedStorageValue(SNOOZE_STORAGE_KEY, JSON.stringify(Object.fromEntries(activeEntries)));
}

export function getAvailableSnoozeMinutes(remainingSeconds: number | null) {
  if (remainingSeconds === null) {
    return 0;
  }

  return Math.min(MAX_SNOOZE_MINUTES, Math.floor((remainingSeconds - SNOOZE_DEADLINE_BUFFER_SECONDS) / 60));
}

export async function recordAlarmSnooze(alarm: Pick<Alarm, 'id' | 'scheduledFor'>, until: string) {
  if (!alarm.scheduledFor) {
    return;
  }

  const store = await readSnoozeStore();
  store[alarm.id] = { scheduledFor: alarm.scheduledFor, until };
  await writeSnoozeStore(store);
}

export async function clearAlarmSnooze(alarmId: string) {
  const store = await readSnoozeStore();

  if (!store[alarmId]) {
    return;
  }

  delete store[alarmId];
  await writeSnoozeStore(store);
}

/** Snoozed alarms should not reopen the live screen until their reminder is due. */
export async function getSnoozedAlarmIds(alarms: Pick<Alarm, 'id' | 'scheduledFor'>[], now = Date.now()) {
  const store = await readSnoozeStore();

  return new Set(
    alarms
      .filter((alarm) => {
        const record = store[alarm.id];
        return Boolean(
          record && record.scheduledFor === alarm.scheduledFor && new Date(record.until).getTime() > now
        );
      })
      .map((alarm) => alarm.id)
  );
}
