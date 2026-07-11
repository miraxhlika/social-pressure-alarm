import {
  readDeviceStorageValue,
  readScopedStorageValue,
  writeDeviceStorageValue,
} from '@/lib/storage';

const ONBOARDING_STORAGE_KEY = 'social-pressure-alarm/onboarding';

export type OnboardingStatus = 'pending' | 'active' | 'completed' | 'skipped';
export type OnboardingStep = 'welcome' | 'how' | 'permissions';

export type OnboardingState = {
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  returnToPermissionsAfterSettings: boolean;
  updatedAt: string | null;
};

function createDefaultOnboardingState(): OnboardingState {
  return {
    status: 'pending',
    currentStep: 'welcome',
    returnToPermissionsAfterSettings: false,
    updatedAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOnboardingStatus(value: unknown): OnboardingStatus {
  return value === 'active' || value === 'completed' || value === 'skipped' ? value : 'pending';
}

function normalizeOnboardingStep(value: unknown): OnboardingStep {
  if (value === 'welcome' || value === 'how' || value === 'permissions') {
    return value;
  }

  return 'welcome';
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function normalizeOptionalIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export async function readOnboardingState() {
  const deviceValue = await readDeviceStorageValue(ONBOARDING_STORAGE_KEY);
  const scopedValue = deviceValue === null ? await readScopedStorageValue(ONBOARDING_STORAGE_KEY) : null;
  const storedValue = deviceValue ?? scopedValue?.value ?? null;

  if (!storedValue) {
    return createDefaultOnboardingState();
  }

  try {
    const parsed = JSON.parse(storedValue);

    if (!isRecord(parsed)) {
      return createDefaultOnboardingState();
    }

    const status = normalizeOnboardingStatus(parsed.status);

    const normalizedState = {
      status,
      currentStep: normalizeOnboardingStep(parsed.currentStep),
      returnToPermissionsAfterSettings: normalizeBoolean(parsed.returnToPermissionsAfterSettings),
      updatedAt: normalizeOptionalIsoString(parsed.updatedAt),
    };

    if (deviceValue === null && scopedValue?.value) {
      await writeDeviceStorageValue(ONBOARDING_STORAGE_KEY, JSON.stringify(normalizedState));
    }

    return normalizedState;
  } catch {
    return createDefaultOnboardingState();
  }
}

export async function writeOnboardingState(
  status: OnboardingStatus,
  currentStep?: OnboardingStep,
  options?: { returnToPermissionsAfterSettings?: boolean }
) {
  const nextState: OnboardingState = {
    status,
    currentStep: currentStep ?? normalizeOnboardingStep(null),
    returnToPermissionsAfterSettings: options?.returnToPermissionsAfterSettings ?? false,
    updatedAt: new Date().toISOString(),
  };

  await writeDeviceStorageValue(ONBOARDING_STORAGE_KEY, JSON.stringify(nextState));

  return nextState;
}

export async function markOnboardingActive(currentStep: OnboardingStep = 'welcome') {
  return writeOnboardingState('active', currentStep);
}

export async function markOnboardingReturningFromSettings() {
  return writeOnboardingState('active', 'permissions', { returnToPermissionsAfterSettings: true });
}

export async function markOnboardingCompleted() {
  return writeOnboardingState('completed');
}

export async function markOnboardingSkipped() {
  return writeOnboardingState('skipped');
}
