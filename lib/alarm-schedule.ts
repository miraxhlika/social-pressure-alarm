import type { RepeatSchedule } from '../types/alarm';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string) {
  let formatter = formatterCache.get(timezone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
  }

  return formatter;
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return Number(parts.find((part) => part.type === type)?.value ?? 0);
}

export function getDeviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimezone(timezone: string) {
  try {
    getFormatter(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = getFormatter(isValidTimezone(timezone) ? timezone : 'UTC').formatToParts(date);

  return {
    year: getPart(parts, 'year'),
    month: getPart(parts, 'month'),
    day: getPart(parts, 'day'),
    hour: getPart(parts, 'hour'),
    minute: getPart(parts, 'minute'),
    second: getPart(parts, 'second'),
  };
}

function zonedWallTimeToDate(parts: Omit<ZonedParts, 'second'> & { second?: number }, timezone: string) {
  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0
  );
  let candidate = new Date(targetUtc);

  // Two passes handle offsets on both sides of DST transitions. If a local wall
  // time does not exist, Intl normalizes it to the next representable instant.
  for (let index = 0; index < 2; index += 1) {
    const actual = getZonedParts(candidate, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    candidate = new Date(candidate.getTime() + targetUtc - actualAsUtc);
  }

  return candidate;
}

function addWallDays(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getWallWeekday(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function createNextOccurrenceDate(
  hour: number,
  minute: number,
  repeatSchedule: RepeatSchedule,
  after = new Date(),
  timezone = getDeviceTimezone()
) {
  const resolvedTimezone = isValidTimezone(timezone) ? timezone : 'UTC';
  let wallDate = getZonedParts(after, resolvedTimezone);
  let candidate = zonedWallTimeToDate(
    { year: wallDate.year, month: wallDate.month, day: wallDate.day, hour, minute },
    resolvedTimezone
  );

  if (candidate.getTime() <= after.getTime()) {
    wallDate = { ...wallDate, ...addWallDays(wallDate, 1) };
    candidate = zonedWallTimeToDate(
      { year: wallDate.year, month: wallDate.month, day: wallDate.day, hour, minute },
      resolvedTimezone
    );
  }

  if (repeatSchedule === 'weekdays') {
    while ([0, 6].includes(getWallWeekday(wallDate))) {
      wallDate = { ...wallDate, ...addWallDays(wallDate, 1) };
      candidate = zonedWallTimeToDate(
        { year: wallDate.year, month: wallDate.month, day: wallDate.day, hour, minute },
        resolvedTimezone
      );
    }
  }

  return candidate;
}

export function advanceRecurringOccurrence(
  scheduledFor: string | Date,
  hour: number,
  minute: number,
  repeatSchedule: RepeatSchedule,
  timezone: string
) {
  const occurrence = typeof scheduledFor === 'string' ? new Date(scheduledFor) : scheduledFor;
  return createNextOccurrenceDate(hour, minute, repeatSchedule, new Date(occurrence.getTime() + 1), timezone);
}

export function createAlarmOccurrenceKey(alarmId: string, scheduledFor?: string) {
  const timestamp = scheduledFor ? new Date(scheduledFor) : null;
  const normalized = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toISOString() : 'unscheduled';
  return `${alarmId}::${normalized}`;
}

export function shiftWeekdayAndTime(weekday: number, hour: number, minute: number, offsetMinutes: number) {
  const totalMinutes = hour * 60 + minute + offsetMinutes;
  const dayOffset = Math.floor(totalMinutes / 1440);
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;

  return {
    weekday: ((weekday - 1 + dayOffset + 7) % 7) + 1,
    hour: Math.floor(normalizedMinutes / 60),
    minute: normalizedMinutes % 60,
  };
}

export function enumerateElapsedOccurrences(input: {
  scheduledFor: string;
  hour: number;
  minute: number;
  repeatSchedule: RepeatSchedule;
  timezone: string;
  gracePeriodSeconds: number;
  now?: number;
  limit?: number;
}) {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? 100;
  const occurrences: string[] = [];
  let occurrence = new Date(input.scheduledFor);

  while (
    occurrences.length < limit &&
    !Number.isNaN(occurrence.getTime()) &&
    occurrence.getTime() + input.gracePeriodSeconds * 1000 < now
  ) {
    occurrences.push(occurrence.toISOString());

    if (input.repeatSchedule === 'once') {
      break;
    }

    occurrence = advanceRecurringOccurrence(
      occurrence,
      input.hour,
      input.minute,
      input.repeatSchedule,
      input.timezone
    );
  }

  return {
    occurrences,
    nextScheduledFor: occurrence.toISOString(),
    hasMore: occurrence.getTime() + input.gracePeriodSeconds * 1000 < now,
  };
}
