export const PROFILE_HANDLE_MAX_LENGTH = 20;
export const PROFILE_HANDLE_MIN_LENGTH = 3;

export type ProfileSeedUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export function getMetadataString(user: ProfileSeedUser | null | undefined, ...keys: string[]) {
  const metadata = user?.user_metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function formatSeedLabel(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, PROFILE_HANDLE_MAX_LENGTH);
}

function createProviderDisplayName(
  user?: ProfileSeedUser | null,
  overrideDisplayName?: string | null
) {
  if (overrideDisplayName?.trim()) {
    return overrideDisplayName.trim();
  }

  const fullName = getMetadataString(user, 'full_name', 'name');

  if (fullName) {
    return fullName;
  }

  const firstName = getMetadataString(user, 'given_name', 'first_name');
  const lastName = getMetadataString(user, 'family_name', 'last_name');
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (combinedName) {
    return combinedName;
  }

  if (user?.email) {
    const localPart = user.email.split('@')[0] ?? '';
    const seededName = formatSeedLabel(localPart);

    if (seededName) {
      return seededName;
    }
  }

  return '';
}

export function createSuggestedDisplayName(
  user?: ProfileSeedUser | null,
  overrideDisplayName?: string | null
) {
  return createProviderDisplayName(user, overrideDisplayName) || (user?.id ? 'Circle member' : '');
}

export function createFallbackHandle(userId: string) {
  return `u_${userId.replace(/-/g, '').slice(0, 16)}`.slice(0, PROFILE_HANDLE_MAX_LENGTH);
}

export function createSuggestedHandle(user?: ProfileSeedUser | null) {
  const preferredHandle = getMetadataString(user, 'preferred_username', 'user_name', 'nickname');

  if (preferredHandle) {
    const normalizedPreferredHandle = normalizeHandle(preferredHandle);

    if (normalizedPreferredHandle.length >= PROFILE_HANDLE_MIN_LENGTH) {
      return normalizedPreferredHandle;
    }
  }

  if (user?.email) {
    const emailHandle = normalizeHandle(user.email.split('@')[0] ?? '');

    if (emailHandle.length >= PROFILE_HANDLE_MIN_LENGTH) {
      return emailHandle;
    }
  }

  const nameHandle = normalizeHandle(createProviderDisplayName(user));

  if (nameHandle.length >= PROFILE_HANDLE_MIN_LENGTH) {
    return nameHandle;
  }

  if (user?.id) {
    return createFallbackHandle(user.id);
  }

  return '';
}

export function createSuggestedAvatarUrl(user?: ProfileSeedUser | null) {
  return getMetadataString(user, 'avatar_url', 'picture');
}

export function nextHandleCandidate(baseHandle: string, attempt: number) {
  const normalizedBase = normalizeHandle(baseHandle);

  if (attempt <= 0) {
    return normalizedBase;
  }

  const suffix = `_${attempt + 1}`;
  const prefixLength = Math.max(PROFILE_HANDLE_MIN_LENGTH, PROFILE_HANDLE_MAX_LENGTH - suffix.length);

  return `${normalizedBase.slice(0, prefixLength)}${suffix}`.slice(0, PROFILE_HANDLE_MAX_LENGTH);
}

export function isSocialProfileComplete(
  profile: { displayName?: string | null; handle?: string | null } | null | undefined
) {
  return Boolean(profile?.displayName?.trim() && profile?.handle?.trim());
}
