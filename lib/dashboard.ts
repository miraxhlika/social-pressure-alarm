import { Alarm } from '@/types/alarm';
import { SocialFeedItem, SocialRuntimeSnapshot } from '@/lib/social/types';
import { formatScheduledFor, getAlarmPhase, getNextActionableAlarm } from '@/lib/alarms';

export function formatSocialTimestamp(timestamp?: string) {
  if (!timestamp) {
    return 'Not yet';
  }

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatFeedInsight(item: SocialFeedItem) {
  if (item.outcome === 'confirmed') {
    const parts = [] as string[];

    if (typeof item.sharePayload.timeToScanSeconds === 'number') {
      parts.push(`${item.sharePayload.timeToScanSeconds}s scan`);
    }

    parts.push(`streak ${item.sharePayload.currentStreak}`);
    return parts.join(' · ');
  }

  return `${item.sharePayload.weeklyCompletionRate}% weekly completion`;
}

export function getPrimaryAlarm(alarms: Alarm[]) {
  const actionableAlarm = getNextActionableAlarm(alarms);

  if (actionableAlarm) {
    return actionableAlarm;
  }

  return [...alarms]
    .filter((alarm) => alarm.isActive)
    .sort((left, right) => {
      const leftTime = left.scheduledFor ? new Date(left.scheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.scheduledFor ? new Date(right.scheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0] ?? alarms[0] ?? null;
}

export function getAlarmPhaseTone(alarm: Alarm | null) {
  if (!alarm) {
    return 'default' as const;
  }

  const phase = getAlarmPhase(alarm);

  switch (phase) {
    case 'missed':
      return 'danger' as const;
    case 'ringing':
      return 'warning' as const;
    case 'scheduled':
      return 'primary' as const;
    default:
      return 'default' as const;
  }
}

export function getAlarmPhaseLabel(alarm: Alarm | null) {
  if (!alarm) {
    return 'No alarm';
  }

  const phase = getAlarmPhase(alarm);

  switch (phase) {
    case 'inactive':
      return 'Cleared';
    case 'missed':
      return 'Missed';
    case 'ringing':
      return 'Scan now';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'Draft';
  }
}

export function getPrimaryAlarmCopy(alarm: Alarm | null) {
  if (!alarm) {
    return 'Create your first alarm and place the QR code away from the bed.';
  }

  const phase = getAlarmPhase(alarm);

  switch (phase) {
    case 'ringing':
      return 'The timer is running. Scan the saved QR code now.';
    case 'missed':
      return 'This alarm missed its window. Reschedule it for the next run.';
    case 'inactive':
      return 'This alarm is cleared. Reuse it or schedule it again.';
    case 'unscheduled':
      return 'This alarm is saved but not scheduled yet.';
    default:
      return `Next trigger ${formatScheduledFor(alarm.scheduledFor)} with a ${alarm.gracePeriodSeconds}s grace window.`;
  }
}

export function getSocialStatusTone(runtime: SocialRuntimeSnapshot | null) {
  if (!runtime?.configured) {
    return 'warning' as const;
  }

  if ((runtime.queue.failedCount ?? 0) > 0) {
    return 'danger' as const;
  }

  if ((runtime.queue.pendingCount ?? 0) > 0) {
    return 'primary' as const;
  }

  return 'success' as const;
}

export function getSocialStatusLabel(runtime: SocialRuntimeSnapshot | null) {
  if (!runtime?.configured) {
    return 'Setup';
  }

  if (!runtime.authenticated) {
    return 'Local only';
  }

  if ((runtime.queue.failedCount ?? 0) > 0) {
    return 'Sync issue';
  }

  if ((runtime.queue.pendingCount ?? 0) > 0) {
    return 'Sync queued';
  }

  return 'Synced';
}
