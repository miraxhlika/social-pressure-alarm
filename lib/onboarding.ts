import { readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';

const ONBOARDING_STORAGE_KEY = 'social-pressure-alarm/onboarding';

export type OnboardingStatus = 'pending' | 'active' | 'completed' | 'skipped';

export type OnboardingState = {
  status: OnboardingStatus;
  updatedAt: string | null;
};

function createDefaultOnboardingState(): OnboardingState {
  return {
    status: 'pending',
    updatedAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOnboardingStatus(value: unknown): OnboardingStatus {
  return value === 'active' || value === 'completed' || value === 'skipped' ? value : 'pending';
}

function normalizeOptionalIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export async function readOnboardingState() {
  const scopedValue = await readScopedStorageValue(ONBOARDING_STORAGE_KEY);

  if (!scopedValue.value) {
    return createDefaultOnboardingState();
  }

  try {
    const parsed = JSON.parse(scopedValue.value);

    if (!isRecord(parsed)) {
      return createDefaultOnboardingState();
    }

    return {
      status: normalizeOnboardingStatus(parsed.status),
      updatedAt: normalizeOptionalIsoString(parsed.updatedAt),
    };
  } catch {
    return createDefaultOnboardingState();
  }
}

export async function writeOnboardingState(status: OnboardingStatus) {
  const nextState: OnboardingState = {
    status,
    updatedAt: new Date().toISOString(),
  };

  await writeScopedStorageValue(ONBOARDING_STORAGE_KEY, JSON.stringify(nextState));

  return nextState;
}

export async function markOnboardingActive() {
  return writeOnboardingState('active');
}

export async function markOnboardingCompleted() {
  return writeOnboardingState('completed');
}

export async function markOnboardingSkipped() {
  return writeOnboardingState('skipped');
}
