import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { EmailOtpType } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { getSupabaseClient } from '@/lib/social/client';

WebBrowser.maybeCompleteAuthSession();

const EMAIL_OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];
let lastHandledAuthUrl: string | null = null;

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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatAppleName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  if (!fullName) {
    return null;
  }

  const parts = [
    fullName.givenName,
    fullName.middleName,
    fullName.familyName,
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join(' ') : null;
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

  if (lastHandledAuthUrl === url) {
    return true;
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

    lastHandledAuthUrl = url;
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

    lastHandledAuthUrl = url;
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

    lastHandledAuthUrl = url;
    return true;
  }

  return false;
}

export async function signInWithGoogle() {
  const client = getRequiredSupabaseClient();
  const redirectUrl = getSocialAuthRedirectUrl();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });

  if (error) {
    throw error;
  }

  if (!data.url) {
    throw new Error('Google sign-in could not be started right now.');
  }

  await WebBrowser.warmUpAsync().catch(() => null);

  try {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

    if (result.type === 'success') {
      const didHandle = await handleSupabaseAuthRedirect(result.url);

      if (!didHandle) {
        throw new Error('Google sign-in returned without a valid session.');
      }

      return;
    }

    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Google sign-in was canceled.');
    }

    throw new Error(`Google sign-in could not be completed (${result.type}).`);
  } finally {
    await WebBrowser.coolDownAsync().catch(() => null);
  }
}

export async function signInWithApple() {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple sign-in is available only on iPhone and iPad builds.');
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Apple sign-in is not available on this device.');
  }

  const client = getRequiredSupabaseClient();
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;

  try {
    credential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Apple sign-in could not be started.');

    if (/ERR_REQUEST_CANCELED/i.test(message)) {
      throw new Error('Apple sign-in was canceled.');
    }

    throw error;
  }

  if (!credential.identityToken) {
    throw new Error('Apple sign-in did not return an identity token.');
  }

  const { data, error } = await client.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) {
    throw error;
  }

  const fullName = formatAppleName(credential.fullName);

  if (fullName) {
    await client.auth
      .updateUser({
        data: {
          full_name: fullName,
        },
      })
      .catch(() => null);
  }

  return data;
}

export async function signOutSocialSession() {
  const client = getRequiredSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}
