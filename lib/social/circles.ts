import * as Linking from 'expo-linking';

import { getSocialSession, getSupabaseClient } from '@/lib/social/client';
import { CreateSocialCircleInput, SocialCircleSummary } from '@/lib/social/types';

type CircleRow = {
  id: string;
  name: string;
  description?: string | null;
  invite_code: string;
  created_at: string;
  updated_at: string;
};

type CircleMembershipRow = {
  circle_id: string;
  role: 'owner' | 'member';
  notifications_enabled: boolean;
  circles: CircleRow | CircleRow[] | null;
};

type JoinedCircleRpcRow = CircleRow & {
  role: 'owner' | 'member';
  notifications_enabled: boolean;
  member_count: number;
};

type CircleMemberCountRow = {
  circle_id: string;
};

type ListMySocialCirclesOptions = {
  force?: boolean;
  maxAgeMs?: number;
};

export const SOCIAL_CIRCLES_CACHE_MAX_AGE_MS = 60_000;

let circlesCache: {
  circles: SocialCircleSummary[];
  updatedAt: number;
  userId: string;
} | null = null;
let circlesRequest: {
  promise: Promise<SocialCircleSummary[]>;
  userId: string;
} | null = null;
let circlesCacheVersion = 0;

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapCircleSummary(
  circle: CircleRow,
  membership: Pick<CircleMembershipRow, 'role' | 'notifications_enabled'>,
  memberCount: number
): SocialCircleSummary {
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description ?? null,
    inviteCode: circle.invite_code,
    memberCount,
    myRole: membership.role,
    notificationsEnabled: membership.notifications_enabled,
    createdAt: circle.created_at,
    updatedAt: circle.updated_at,
  };
}

async function getRequiredSessionUser() {
  const session = await getSocialSession();

  if (!session?.user) {
    throw new Error('Sign in to manage accountability circles.');
  }

  return session.user;
}

async function getCircleMemberCount(circleId: string) {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  const { count, error } = await client
    .from('circle_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('circle_id', circleId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function getCircleMemberCounts(circleIds: string[]) {
  const countsByCircleId = new Map(circleIds.map((circleId) => [circleId, 0]));

  if (circleIds.length === 0) {
    return countsByCircleId;
  }

  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  const { data, error } = await client
    .from('circle_memberships')
    .select('circle_id')
    .in('circle_id', circleIds);

  if (error) {
    const fallbackCounts = await Promise.all(circleIds.map((circleId) => getCircleMemberCount(circleId)));
    return new Map(circleIds.map((circleId, index) => [circleId, fallbackCounts[index] ?? 0]));
  }

  for (const row of (data ?? []) as CircleMemberCountRow[]) {
    countsByCircleId.set(row.circle_id, (countsByCircleId.get(row.circle_id) ?? 0) + 1);
  }

  return countsByCircleId;
}

export function getCachedMySocialCircles(userId?: string) {
  if (!circlesCache || (userId && circlesCache.userId !== userId)) {
    return null;
  }

  return circlesCache.circles;
}

export function clearMySocialCirclesCache() {
  circlesCacheVersion += 1;
  circlesCache = null;
  circlesRequest = null;
}

export function buildCircleInviteUrl(inviteCode: string) {
  return Linking.createURL('/circles', {
    scheme: 'socialpressurealarm',
    queryParams: {
      inviteCode,
    },
  });
}

export async function listMySocialCircles(options: ListMySocialCirclesOptions = {}) {
  const client = getSupabaseClient();
  const user = await getRequiredSessionUser();
  const maxAgeMs = options.maxAgeMs ?? 0;

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  if (!options.force && maxAgeMs > 0 && circlesCache?.userId === user.id) {
    const cacheAgeMs = Date.now() - circlesCache.updatedAt;

    if (cacheAgeMs < maxAgeMs) {
      return circlesCache.circles;
    }
  }

  if (!options.force && circlesRequest?.userId === user.id) {
    return circlesRequest.promise;
  }

  const requestVersion = circlesCacheVersion;
  const request = (async () => {
    const { data, error } = await client
      .from('circle_memberships')
      .select(
        'circle_id, role, notifications_enabled, circles!inner(id, name, description, invite_code, created_at, updated_at)'
      )
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true });

    if (error) {
      throw error;
    }

    const memberships = ((data ?? []) as CircleMembershipRow[]).filter(
      (membership) => membership.circles && !Array.isArray(membership.circles)
    );
    const memberCounts = await getCircleMemberCounts(memberships.map((membership) => membership.circle_id));

    return memberships.map((membership) =>
      mapCircleSummary(
        membership.circles as CircleRow,
        membership,
        memberCounts.get(membership.circle_id) ?? 0
      )
    );
  })();
  circlesRequest = {
    promise: request,
    userId: user.id,
  };

  try {
    const circles = await request;

    if (requestVersion === circlesCacheVersion) {
      circlesCache = {
        circles,
        updatedAt: Date.now(),
        userId: user.id,
      };
    }

    return circles;
  } finally {
    if (circlesRequest?.promise === request) {
      circlesRequest = null;
    }
  }
}

export async function createSocialCircle(input: CreateSocialCircleInput) {
  const client = getSupabaseClient();
  const user = await getRequiredSessionUser();
  const trimmedName = getTrimmedString(input.name);
  const trimmedDescription = getTrimmedString(input.description);

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  if (!trimmedName) {
    throw new Error('Circle name is required.');
  }

  const { data: circle, error: circleError } = await client
    .from('circles')
    .insert({
      owner_id: user.id,
      name: trimmedName,
      description: trimmedDescription || null,
    })
    .select('id, name, description, invite_code, created_at, updated_at')
    .single();

  if (circleError) {
    throw circleError;
  }

  const { error: membershipError } = await client.from('circle_memberships').insert({
    circle_id: circle.id,
    user_id: user.id,
    role: 'owner',
    notifications_enabled: true,
  });

  if (membershipError) {
    throw membershipError;
  }

  clearMySocialCirclesCache();
  return mapCircleSummary(circle, { role: 'owner', notifications_enabled: true }, 1);
}

export async function joinSocialCircleWithInviteCode(rawInviteCode: string) {
  const client = getSupabaseClient();
  const inviteCode = getTrimmedString(rawInviteCode).toLowerCase();

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  if (!inviteCode) {
    throw new Error('Invite code is required.');
  }

  const { data: joinedCircle, error: joinError } = await client
    .rpc('join_circle_with_invite_code', { invite_code_input: inviteCode })
    .single();

  if (joinError) {
    throw joinError;
  }

  if (!joinedCircle) {
    throw new Error('No circle matches that invite code.');
  }

  const typedJoinedCircle = joinedCircle as JoinedCircleRpcRow;
  clearMySocialCirclesCache();

  return mapCircleSummary(
    typedJoinedCircle,
    {
      role: typedJoinedCircle.role,
      notifications_enabled: typedJoinedCircle.notifications_enabled,
    },
    typedJoinedCircle.member_count
  );
}
