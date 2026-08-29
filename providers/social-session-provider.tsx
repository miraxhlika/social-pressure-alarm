import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { Session, User } from '@supabase/supabase-js';

import {
  signInWithApple,
  signInWithGoogle,
  getSocialAuthRedirectUrl,
  handleSupabaseAuthRedirect,
  signOutSocialSession,
} from '@/lib/social/auth';
import { getSupabaseClient, getSocialSession } from '@/lib/social/client';
import { hasSocialBackendConfig } from '@/lib/social/config';
import { ensureMySocialProfile, upsertMySocialProfile } from '@/lib/social/profile';
import { isSocialProfileComplete } from '@/lib/social/profile-defaults';
import { unregisterSignedInDevicePushToken } from '@/lib/social/push';
import { SocialProfile, UpsertSocialProfileInput } from '@/lib/social/types';

type SocialAuthProvider = 'google' | 'apple';

type SocialSessionContextValue = {
  configured: boolean;
  authRedirectUrl: string;
  isLoading: boolean;
  authProviderInFlight: SocialAuthProvider | null;
  isProfileLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: SocialProfile | null;
  profileError: string | null;
  isProfileComplete: boolean;
  refreshProfile: () => Promise<void>;
  continueWithGoogle: () => Promise<void>;
  continueWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  saveProfile: (input: UpsertSocialProfileInput) => Promise<SocialProfile>;
};

const SocialSessionContext = createContext<SocialSessionContextValue | null>(null);

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SocialSessionProvider({ children }: { children: ReactNode }) {
  const configured = hasSocialBackendConfig();
  const authRedirectUrl = getSocialAuthRedirectUrl();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [isLoading, setIsLoading] = useState(configured);
  const [authProviderInFlight, setAuthProviderInFlight] = useState<SocialAuthProvider | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!configured || !session?.user?.id) {
      setProfile(null);
      setProfileError(null);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);

    try {
      const nextProfile = await ensureMySocialProfile();
      setProfile(nextProfile);
      setProfileError(null);
    } catch (error) {
      setProfileError(getErrorMessage(error, 'Unable to load your social profile.'));
    } finally {
      setIsProfileLoading(false);
    }
  }, [configured, session?.user?.id]);

  useEffect(() => {
    if (!configured) {
      setIsLoading(false);
      setSession(null);
      setProfile(null);
      setProfileError(null);
      return;
    }

    let isMounted = true;
    const client = getSupabaseClient();

    const bootstrapSession = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();

        if (initialUrl) {
          await handleSupabaseAuthRedirect(initialUrl);
        }
      } catch (error) {
        if (isMounted) {
          setProfileError(getErrorMessage(error, 'Unable to complete the sign-in redirect.'));
        }
      }

      try {
        const nextSession = await getSocialSession();

        if (isMounted) {
          setSession(nextSession);
        }
      } catch (error) {
        if (isMounted) {
          setProfileError(getErrorMessage(error, 'Unable to restore your social session.'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrapSession();

    const authSubscription = client?.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }

      setSession(nextSession);
      setIsLoading(false);

      if (!nextSession?.user) {
        setProfile(null);
        setProfileError(null);
        setIsProfileLoading(false);
      }
    });

    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleSupabaseAuthRedirect(url).catch((error: unknown) => {
        if (isMounted) {
          setProfileError(getErrorMessage(error, 'Unable to complete the sign-in redirect.'));
        }
      });
    });

    return () => {
      isMounted = false;
      authSubscription?.data.subscription.unsubscribe();
      linkSubscription.remove();
    };
  }, [configured]);

  useEffect(() => {
    if (session?.user?.id) {
      void refreshProfile();
      return;
    }

    setProfile(null);
    setProfileError(null);
    setIsProfileLoading(false);
  }, [refreshProfile, session?.user?.id]);

  const handleContinueWithGoogle = useCallback(async () => {
    setAuthProviderInFlight('google');
    setIsProfileLoading(true);

    try {
      await signInWithGoogle();

      try {
        const nextProfile = await ensureMySocialProfile();
        setProfile(nextProfile);
        setProfileError(null);
      } catch (error) {
        setProfileError(getErrorMessage(error, 'Unable to finish setting up your profile.'));
      }
    } finally {
      setAuthProviderInFlight(null);
      setIsProfileLoading(false);
    }
  }, []);

  const handleContinueWithApple = useCallback(async () => {
    setAuthProviderInFlight('apple');
    setIsProfileLoading(true);

    try {
      await signInWithApple();

      try {
        const nextProfile = await ensureMySocialProfile();
        setProfile(nextProfile);
        setProfileError(null);
      } catch (error) {
        setProfileError(getErrorMessage(error, 'Unable to finish setting up your profile.'));
      }
    } finally {
      setAuthProviderInFlight(null);
      setIsProfileLoading(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await unregisterSignedInDevicePushToken();
    await signOutSocialSession();
  }, []);

  const handleSaveProfile = useCallback(async (input: UpsertSocialProfileInput) => {
    const savedProfile = await upsertMySocialProfile(input);
    setProfile(savedProfile);
    setProfileError(null);
    return savedProfile;
  }, []);

  const value = useMemo<SocialSessionContextValue>(
    () => ({
      configured,
      authRedirectUrl,
      isLoading,
      authProviderInFlight,
      isProfileLoading,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      isProfileComplete: isSocialProfileComplete(profile),
      refreshProfile,
      continueWithGoogle: handleContinueWithGoogle,
      continueWithApple: handleContinueWithApple,
      signOut: handleSignOut,
      saveProfile: handleSaveProfile,
    }),
    [
      authRedirectUrl,
      authProviderInFlight,
      configured,
      handleContinueWithApple,
      handleContinueWithGoogle,
      handleSaveProfile,
      handleSignOut,
      isLoading,
      isProfileLoading,
      profile,
      profileError,
      refreshProfile,
      session,
    ]
  );

  return <SocialSessionContext.Provider value={value}>{children}</SocialSessionContext.Provider>;
}

export function useSocialSession() {
  const value = useContext(SocialSessionContext);

  if (!value) {
    throw new Error('useSocialSession must be used within a SocialSessionProvider.');
  }

  return value;
}
