import {
  advanceRecurringOccurrence,
  createAlarmOccurrenceKey,
  createNextOccurrenceDate,
  enumerateElapsedOccurrences,
  shiftWeekdayAndTime,
} from './alarm-schedule';

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('daily recurrence advances without requiring application lifecycle work', () => {
  const next = createNextOccurrenceDate(8, 30, 'daily', new Date('2026-07-13T09:00:00.000Z'), 'UTC');
  assertEquals(next.toISOString(), '2026-07-14T08:30:00.000Z');
});

Deno.test('weekday recurrence rolls Friday forward to Monday', () => {
  const next = createNextOccurrenceDate(8, 0, 'weekdays', new Date('2026-07-17T09:00:00.000Z'), 'UTC');
  assertEquals(next.toISOString(), '2026-07-20T08:00:00.000Z');
});

Deno.test('wall-clock time survives the spring DST transition', () => {
  const next = createNextOccurrenceDate(
    8,
    0,
    'daily',
    new Date('2026-03-07T14:00:00.000Z'),
    'America/New_York'
  );
  assertEquals(next.toISOString(), '2026-03-08T12:00:00.000Z');
});

Deno.test('wall-clock time survives the fall DST transition', () => {
  const next = createNextOccurrenceDate(
    8,
    0,
    'daily',
    new Date('2026-10-31T13:00:00.000Z'),
    'America/New_York'
  );
  assertEquals(next.toISOString(), '2026-11-01T13:00:00.000Z');
});

Deno.test('timezone changes preserve the requested local hour', () => {
  const newYork = createNextOccurrenceDate(8, 0, 'daily', new Date('2026-07-13T00:00:00.000Z'), 'America/New_York');
  const skopje = createNextOccurrenceDate(8, 0, 'daily', new Date('2026-07-13T00:00:00.000Z'), 'Europe/Skopje');
  assertEquals(newYork.toISOString(), '2026-07-13T12:00:00.000Z');
  assertEquals(skopje.toISOString(), '2026-07-13T06:00:00.000Z');
});

Deno.test('catch-up enumerates each elapsed occurrence and returns the next one', () => {
  const result = enumerateElapsedOccurrences({
    scheduledFor: '2026-07-10T08:00:00.000Z',
    hour: 8,
    minute: 0,
    repeatSchedule: 'daily',
    timezone: 'UTC',
    gracePeriodSeconds: 120,
    now: new Date('2026-07-13T07:00:00.000Z').getTime(),
  });

  assertEquals(result.occurrences, [
    '2026-07-10T08:00:00.000Z',
    '2026-07-11T08:00:00.000Z',
    '2026-07-12T08:00:00.000Z',
  ]);
  assertEquals(result.nextScheduledFor, '2026-07-13T08:00:00.000Z');
  assertEquals(result.hasMore, false);
});

Deno.test('occurrence keys do not depend on outcome', () => {
  const scheduledFor = advanceRecurringOccurrence(
    '2026-07-13T08:00:00.000Z',
    8,
    0,
    'daily',
    'UTC'
  ).toISOString();
  assertEquals(createAlarmOccurrenceKey('alarm-1', scheduledFor), 'alarm-1::2026-07-14T08:00:00.000Z');
});

Deno.test('urgency reminder shifts across midnight and weekday boundaries', () => {
  assertEquals(shiftWeekdayAndTime(6, 23, 50, 30), {
    weekday: 7,
    hour: 0,
    minute: 20,
  });
});
