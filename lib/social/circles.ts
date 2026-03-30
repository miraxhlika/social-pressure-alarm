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

export function buildCircleInviteUrl(inviteCode: string) {
  return Linking.createURL('/circles', {
    scheme: 'socialpressurealarm',
    queryParams: {
      inviteCode,
    },
  });
}

export async function listMySocialCircles() {
  const client = getSupabaseClient();
  const user = await getRequiredSessionUser();

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

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

  const memberCounts = await Promise.all(
    memberships.map((membership) => getCircleMemberCount(membership.circle_id))
  );

  return memberships.map((membership, index) =>
    mapCircleSummary(membership.circles as CircleRow, membership, memberCounts[index] ?? 0)
  );
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

  return mapCircleSummary(
    typedJoinedCircle,
    {
      role: typedJoinedCircle.role,
      notifications_enabled: typedJoinedCircle.notifications_enabled,
    },
    typedJoinedCircle.member_count
  );
}
