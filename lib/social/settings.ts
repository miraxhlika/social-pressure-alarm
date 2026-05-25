import { SocialCircleSummary } from '@/lib/social/types';
import { AlarmOutcome, AlarmSocialSettings } from '@/types/alarm';

export function isCheckpointShared(settings?: AlarmSocialSettings) {
  return Boolean(settings?.circleId && (settings.shareMisses || settings.shareSuccesses));
}

export function isOutcomeShared(settings: AlarmSocialSettings | undefined, outcome: AlarmOutcome) {
  if (!isCheckpointShared(settings)) {
    return false;
  }

  return outcome === 'confirmed' ? Boolean(settings?.shareSuccesses) : Boolean(settings?.shareMisses);
}

export function findCircleName(circles: SocialCircleSummary[], circleId?: string) {
  if (!circleId) {
    return undefined;
  }

  return circles.find((circle) => circle.id === circleId)?.name;
}

export function getSharedOutcomeLabel(settings?: AlarmSocialSettings) {
  if (!isCheckpointShared(settings)) {
    return 'Private';
  }

  if (settings?.shareMisses && settings.shareSuccesses) {
    return 'Misses and clears';
  }

  if (settings?.shareMisses) {
    return 'Misses';
  }

  return 'Clears';
}

export function getCheckpointSocialLabel(settings?: AlarmSocialSettings, circleName?: string) {
  if (!isCheckpointShared(settings)) {
    return 'Private';
  }

  return circleName ? `Shared with "${circleName}"` : 'Shared with circle';
}

export function getCheckpointSocialDescription(settings?: AlarmSocialSettings, circleName?: string) {
  if (!isCheckpointShared(settings)) {
    return 'Private. Not shared.';
  }

  const sharedOutcomes = getSharedOutcomeLabel(settings).toLowerCase();
  const destination = circleName ? circleName : 'your circle';

  return `Shares ${sharedOutcomes} with ${destination}.`;
}

export function getOutcomeShareConfirmation(
  settings: AlarmSocialSettings | undefined,
  outcome: AlarmOutcome,
  circleName?: string
) {
  if (!isOutcomeShared(settings, outcome)) {
    return 'Private. Not shared.';
  }

  return circleName ? `Shared with ${circleName}` : 'Shared with your circle.';
}
