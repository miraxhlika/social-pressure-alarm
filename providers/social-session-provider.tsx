import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { Session, User } from '@supabase/supabase-js';

import {
  getSocialAuthRedirectUrl,
  handleSupabaseAuthRedirect,
  sendMagicLink,
  signInWithPassword,
  signOutSocialSession,
  signUpWithPassword,
} from '@/lib/social/auth';
import { getSupabaseClient, getSocialSession } from '@/lib/social/client';
import { hasSocialBackendConfig } from '@/lib/social/config';
import { getMySocialProfile, upsertMySocialProfile } from '@/lib/social/profile';
import { SocialProfile, UpsertSocialProfileInput } from '@/lib/social/types';

type SocialSessionContextValue = {
  configured: boolean;
  authRedirectUrl: string;
  isLoading: boolean;
  isProfileLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: SocialProfile | null;
  profileError: string | null;
  isProfileComplete: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string
  ) => Promise<{ requiresEmailConfirmation: boolean; emailAddress: string }>;
  requestMagicLink: (email: string) => Promise<string>;
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
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!configured || !session?.user) {
      setProfile(null);
      setProfileError(null);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);

    try {
      const nextProfile = await getMySocialProfile();
      setProfile(nextProfile);
      setProfileError(null);
    } catch (error) {
      setProfileError(getErrorMessage(error, 'Unable to load your social profile.'));
    } finally {
      setIsProfileLoading(false);
    }
  }, [configured, session?.user]);

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
          setProfileError(getErrorMessage(error, 'Unable to complete the email sign-in link.'));
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
          setProfileError(getErrorMessage(error, 'Unable to complete the email sign-in link.'));
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
    if (session?.user) {
      void refreshProfile();
      return;
    }

    setProfile(null);
    setProfileError(null);
    setIsProfileLoading(false);
  }, [refreshProfile, session?.user]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    await signInWithPassword(email, password);
  }, []);

  const handleSignUp = useCallback(async (email: string, password: string) => {
    const result = await signUpWithPassword(email, password);

    return {
      requiresEmailConfirmation: result.requiresEmailConfirmation,
      emailAddress: email.trim(),
    };
  }, []);

  const handleMagicLink = useCallback(async (email: string) => {
    await sendMagicLink(email);
    return email.trim();
  }, []);

  const handleSignOut = useCallback(async () => {
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
      isProfileLoading,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      isProfileComplete: Boolean(profile?.displayName && profile?.handle),
      refreshProfile,
      signIn: handleSignIn,
      signUp: handleSignUp,
      requestMagicLink: handleMagicLink,
      signOut: handleSignOut,
      saveProfile: handleSaveProfile,
    }),
    [
      authRedirectUrl,
      configured,
      handleMagicLink,
      handleSaveProfile,
      handleSignIn,
      handleSignOut,
      handleSignUp,
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
