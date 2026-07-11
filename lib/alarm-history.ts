import { FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

function getOccurrenceTimestamp(scheduledFor: string | undefined, resolvedAt: string) {
  if (scheduledFor && !Number.isNaN(new Date(scheduledFor).getTime())) {
    return scheduledFor;
  }

  return resolvedAt;
}

export function getFailureOccurrenceTimestamp(entry: FailureHistoryEntry) {
  return getOccurrenceTimestamp(entry.scheduledFor, entry.failedAt);
}

export function getSuccessOccurrenceTimestamp(entry: SuccessHistoryEntry) {
  return getOccurrenceTimestamp(entry.scheduledFor, entry.confirmedAt);
}
