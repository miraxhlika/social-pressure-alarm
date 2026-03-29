import * as Linking from 'expo-linking';
import { EmailOtpType } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/social/client';

const EMAIL_OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function getRequiredSupabaseClient() {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase is not configured for this app.');
  }

  return client;
}

function readParamFromUrl(url: string, key: string) {
  const [basePart, hashPart = ''] = url.split('#');
  const queryString = basePart.includes('?') ? basePart.slice(basePart.indexOf('?') + 1) : '';
  const searchParams = new URLSearchParams(queryString);
  const hashParams = new URLSearchParams(hashPart);

  return hashParams.get(key) ?? searchParams.get(key);
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value ? EMAIL_OTP_TYPES.includes(value as EmailOtpType) : false;
}

export function getSocialAuthRedirectUrl() {
  return Linking.createURL('/account', {
    scheme: 'socialpressurealarm',
  });
}

export async function handleSupabaseAuthRedirect(url: string) {
  const client = getSupabaseClient();

  if (!client) {
    return false;
  }

  const authCode = readParamFromUrl(url, 'code');
  const accessToken = readParamFromUrl(url, 'access_token');
  const refreshToken = readParamFromUrl(url, 'refresh_token');
  const tokenHash = readParamFromUrl(url, 'token_hash');
  const authType = readParamFromUrl(url, 'type');

  if (authCode) {
    const { error } = await client.auth.exchangeCodeForSession(authCode);

    if (error) {
      throw error;
    }

    return true;
  }

  if (accessToken && refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    return true;
  }

  if (tokenHash && isEmailOtpType(authType)) {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: authType,
    });

    if (error) {
      throw error;
    }

    return true;
  }

  return false;
}

export async function signInWithPassword(email: string, password: string) {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function signUpWithPassword(email: string, password: string) {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: getSocialAuthRedirectUrl(),
    },
  });

  if (error) {
    throw error;
  }

  return {
    session: data.session,
    user: data.user,
    requiresEmailConfirmation: !data.session,
  };
}

export async function sendMagicLink(email: string) {
  const client = getRequiredSupabaseClient();
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: getSocialAuthRedirectUrl(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOutSocialSession() {
  const client = getRequiredSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}
