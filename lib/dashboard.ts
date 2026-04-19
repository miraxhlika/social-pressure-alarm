import { Alarm } from '@/types/alarm';
import { formatGracePeriodLabel } from '@/lib/checkpoint-templates';
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

    parts.push(`${item.sharePayload.weeklyCompletionRate}% week`);
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
    return 'No checkpoint';
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
    return 'Set one checkpoint around a commitment that matters today.';
  }

  const phase = getAlarmPhase(alarm);

  switch (phase) {
    case 'ringing':
      return 'The proof window is open. Reach the saved checkpoint and scan now.';
    case 'missed':
      return 'This run was missed. Tighten the setup or reschedule the next attempt.';
    case 'inactive':
      return 'This checkpoint already did its job. Reuse it when this commitment comes back.';
    case 'unscheduled':
      return 'This checkpoint is saved, but it still needs a real time on the calendar.';
    default:
      return `Next run ${formatScheduledFor(alarm.scheduledFor)} with a ${formatGracePeriodLabel(
        alarm.gracePeriodSeconds
      )} reach window.`;
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
