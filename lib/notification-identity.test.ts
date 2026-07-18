import {
  getNotificationIdsForAlarms,
  getOrphanedNotificationIds,
} from './notification-identity.ts';

const scheduled = [
  {
    identifier: 'checkpoint:alarm-a:r1:primary:daily',
    content: { data: { alarmId: 'alarm-a' } },
  },
  {
    identifier: 'checkpoint:alarm-a:r2:primary:daily',
    content: { data: { alarmId: 'alarm-a' } },
  },
  {
    identifier: 'checkpoint:alarm-b:r1:primary:daily',
    content: { data: { alarmId: 'alarm-b' } },
  },
  {
    identifier: 'weekly-review:1',
    content: { data: { kind: 'weekly-review' } },
  },
  {
    identifier: 'checkpoint:legacy-without-payload',
    content: { data: {} },
  },
];

Deno.test('alarm-scoped cancellation finds every revision without stored identifiers', () => {
  const identifiers = getNotificationIdsForAlarms(scheduled, ['alarm-a']);

  if (identifiers.length !== 2 || identifiers.some((identifier) => !identifier.includes('alarm-a'))) {
    throw new Error(`Unexpected identifiers: ${JSON.stringify(identifiers)}`);
  }
});

Deno.test('alarm-scoped cancellation can preserve a newly reconciled request', () => {
  const identifiers = getNotificationIdsForAlarms(
    scheduled,
    ['alarm-a'],
    ['checkpoint:alarm-a:r2:primary:daily']
  );

  if (identifiers.length !== 1 || identifiers[0] !== 'checkpoint:alarm-a:r1:primary:daily') {
    throw new Error(`Unexpected identifiers: ${JSON.stringify(identifiers)}`);
  }
});

Deno.test('orphan cleanup ignores active alarms and non-checkpoint reminders', () => {
  const identifiers = getOrphanedNotificationIds(scheduled, ['alarm-b']);

  if (
    identifiers.length !== 3 ||
    identifiers.filter((identifier) => identifier.includes('alarm-a')).length !== 2 ||
    !identifiers.includes('checkpoint:legacy-without-payload') ||
    identifiers.includes('weekly-review:1')
  ) {
    throw new Error(`Unexpected identifiers: ${JSON.stringify(identifiers)}`);
  }
});
