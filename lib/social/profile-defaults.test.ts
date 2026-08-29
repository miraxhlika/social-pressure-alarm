import {
  createFallbackHandle,
  createSuggestedDisplayName,
  createSuggestedHandle,
  isSocialProfileComplete,
  nextHandleCandidate,
  normalizeHandle,
} from './profile-defaults.ts';

Deno.test('suggested display name prefers provider full name', () => {
  const displayName = createSuggestedDisplayName({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'hidden@privaterelay.appleid.com',
    user_metadata: {
      full_name: 'Ada Lovelace',
    },
  });

  if (displayName !== 'Ada Lovelace') {
    throw new Error(`Unexpected display name: ${displayName}`);
  }
});

Deno.test('suggested display name uses an explicit Apple name override', () => {
  const displayName = createSuggestedDisplayName(
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'ada@example.com',
      user_metadata: {},
    },
    'Ada Lovelace'
  );

  if (displayName !== 'Ada Lovelace') {
    throw new Error(`Unexpected display name: ${displayName}`);
  }
});

Deno.test('suggested handle comes from email when metadata is empty', () => {
  const handle = createSuggestedHandle({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'Early.Riser@gmail.com',
    user_metadata: {},
  });

  if (handle !== 'early_riser') {
    throw new Error(`Unexpected handle: ${handle}`);
  }
});

Deno.test('suggested handle falls back to a unique user id when nothing else is usable', () => {
  const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const handle = createSuggestedHandle({
    id: userId,
    user_metadata: {},
  });

  if (handle !== createFallbackHandle(userId)) {
    throw new Error(`Unexpected fallback handle: ${handle}`);
  }
});

Deno.test('handle candidates stay unique and within length limits', () => {
  const first = nextHandleCandidate('early_riser_account', 0);
  const second = nextHandleCandidate('early_riser_account', 1);

  if (first !== 'early_riser_account' || first.length > 20) {
    throw new Error(`Unexpected first handle candidate: ${first}`);
  }

  if (second.length > 20 || !second.endsWith('_2') || second === first) {
    throw new Error(`Unexpected second handle candidate: ${second}`);
  }
});

Deno.test('normalizeHandle strips invalid characters', () => {
  if (normalizeHandle('Early Riser!') !== 'early_riser') {
    throw new Error(`Unexpected normalized handle: ${normalizeHandle('Early Riser!')}`);
  }
});

Deno.test('a profile is complete only when both name and handle exist', () => {
  if (isSocialProfileComplete({ displayName: 'Ada', handle: '' })) {
    throw new Error('Empty handle should not be complete');
  }

  if (!isSocialProfileComplete({ displayName: 'Ada', handle: 'ada' })) {
    throw new Error('Name and handle should be complete');
  }
});
