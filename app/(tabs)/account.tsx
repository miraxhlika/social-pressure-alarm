import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Pressable, Platform, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StateCard } from '@/components/ui/state-card';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialSession } from '@/providers/social-session-provider';

type FormFeedbackTone = 'success' | 'danger';
type ProfileFieldErrors = {
  displayName?: string;
  handle?: string;
  timezone?: string;
};
type FormFeedback = {
  tone: FormFeedbackTone;
  message: string;
};

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const COMMON_TIMEZONES = [
  'UTC',
  DEFAULT_TIMEZONE,
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
];
const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

function getMetadataString(user: User | null | undefined, ...keys: string[]) {
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

function getProviderLabel(user: User | null | undefined) {
  const provider = typeof user?.app_metadata?.provider === 'string' ? user.app_metadata.provider : null;

  if (provider === 'apple') {
    return 'Apple';
  }

  if (provider === 'google') {
    return 'Google';
  }

  return null;
}

function formatSeedLabel(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function createSuggestedDisplayName(user?: User | null) {
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

  if (!user?.email) {
    return '';
  }

  const localPart = user.email.split('@')[0] ?? '';
  return formatSeedLabel(localPart);
}

function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

function createSuggestedHandle(user?: User | null) {
  const preferredHandle = getMetadataString(user, 'preferred_username', 'user_name', 'nickname');

  if (preferredHandle) {
    return normalizeHandle(preferredHandle);
  }

  if (user?.email) {
    return normalizeHandle(user.email.split('@')[0] ?? '');
  }

  return normalizeHandle(createSuggestedDisplayName(user));
}

function getAccountLabel(user: User | null) {
  return user?.email ?? getMetadataString(user, 'email') ?? `${getProviderLabel(user) ?? 'Connected'} account`;
}

function getSuggestedTimezones(...zones: (string | null | undefined)[]) {
  const supportedTimezones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [];
  const hasSupportedTimezones = supportedTimezones.length > 0;

  return Array.from(new Set([...zones, ...COMMON_TIMEZONES].filter((zone): zone is string => Boolean(zone))))
    .filter((zone) => !hasSupportedTimezones || supportedTimezones.includes(zone))
    .slice(0, 8);
}

function getProfileErrors({
  displayName,
  handle,
  timezone,
}: {
  displayName: string;
  handle: string;
  timezone: string;
}): ProfileFieldErrors {
  const trimmedDisplayName = displayName.trim();
  const normalizedHandle = normalizeHandle(handle);
  const trimmedTimezone = timezone.trim();
  const supportedTimezones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [];
  const hasSupportedTimezones = supportedTimezones.length > 0;
  const errors: ProfileFieldErrors = {};

  if (!trimmedDisplayName) {
    errors.displayName = 'Add the name your circle will recognize.';
  }

  if (!normalizedHandle) {
    errors.handle = 'Choose a handle for circles and the activity feed.';
  } else if (normalizedHandle.length < 3) {
    errors.handle = 'Use at least 3 letters or numbers.';
  }

  if (!trimmedTimezone) {
    errors.timezone = 'Choose the timezone used for social timing.';
  } else if (hasSupportedTimezones && !supportedTimezones.includes(trimmedTimezone)) {
    errors.timezone = 'Use one of the suggested IANA timezones, like Europe/Skopje.';
  }

  return errors;
}

function getFriendlyAuthError(error: unknown, authRedirectUrl: string) {
  const message = error instanceof Error ? error.message : 'The request could not be completed right now.';

  if (/canceled/i.test(message)) {
    return message;
  }

  if (/redirect|valid session|invalid_grant|grant/i.test(message)) {
    return `Could not finish sign-in. Confirm ${authRedirectUrl} is allowed in Supabase redirect URLs, then try again.`;
  }

  if (/provider/i.test(message)) {
    return 'That provider is not configured yet in Supabase. Finish the provider setup, then try again.';
  }

  return message;
}

function getFriendlyProfileError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Your profile could not be saved right now.';

  if (/duplicate key|profiles_handle_key|handle/i.test(message)) {
    return 'That handle is already taken. Try another one.';
  }

  return message;
}

function hasErrors(errors: Record<string, string | undefined>) {
  return Object.values(errors).some(Boolean);
}

function getFeedbackColors(tone: FormFeedbackTone, colors: ReturnType<typeof getAppColors>) {
  if (tone === 'danger') {
    return {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
      textColor: colors.danger,
    };
  }

  return {
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
    textColor: colors.success,
  };
}

export default function AccountScreen() {
  const colors = getAppColors(useColorScheme());
  const {
    authRedirectUrl,
    authProviderInFlight,
    continueWithApple,
    continueWithGoogle,
    configured,
    isLoading,
    isProfileLoading,
    profile,
    profileError,
    refreshProfile,
    signOut,
    saveProfile,
    user,
  } = useSocialSession();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [authFeedback, setAuthFeedback] = useState<FormFeedback | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [allowCircleNotifications, setAllowCircleNotifications] = useState(true);
  const [allowMissedAlarmAlerts, setAllowMissedAlarmAlerts] = useState(true);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasAttemptedProfileSubmit, setHasAttemptedProfileSubmit] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<FormFeedback | null>(null);
  const suggestedDisplayName = createSuggestedDisplayName(user);
  const suggestedHandle = createSuggestedHandle(user);
  const signedInAccountLabel = getAccountLabel(user);
  const supportsAppleSignIn = Platform.OS === 'ios';
  const isGoogleSubmitting = authProviderInFlight === 'google';
  const isAppleSubmitting = authProviderInFlight === 'apple';

  useEffect(() => {
    const hydrationKey = `${user?.id ?? 'signed-out'}:${profile?.updatedAt ?? 'no-profile'}`;

    if (hydratedFormKeyRef.current === hydrationKey) {
      return;
    }

    hydratedFormKeyRef.current = hydrationKey;
    setDisplayName(profile?.displayName ?? suggestedDisplayName);
    setHandle(profile?.handle ?? suggestedHandle);
    setTimezone(profile?.timezone ?? DEFAULT_TIMEZONE);
    setAllowCircleNotifications(profile?.allowCircleNotifications ?? true);
    setAllowMissedAlarmAlerts(profile?.allowMissedAlarmAlerts ?? true);
    setProfileFeedback(null);
    setHasAttemptedProfileSubmit(false);
  }, [profile, suggestedDisplayName, suggestedHandle, user?.id]);

  const profileErrors = getProfileErrors({
    displayName,
    handle,
    timezone,
  });
  const normalizedHandle = normalizeHandle(handle);
  const timezoneSuggestions = getSuggestedTimezones(timezone, profile?.timezone, DEFAULT_TIMEZONE);
  const authFeedbackColors = authFeedback ? getFeedbackColors(authFeedback.tone, colors) : null;
  const profileFeedbackColors = profileFeedback ? getFeedbackColors(profileFeedback.tone, colors) : null;
  const handleHelper =
    normalizedHandle.length >= 3
      ? `Circle members will see @${normalizedHandle}.`
      : 'Lowercase only, with letters, numbers, and underscores.';

  const handleContinueWithGoogle = async () => {
    setAuthFeedback(null);

    try {
      await continueWithGoogle();
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: getFriendlyAuthError(error, authRedirectUrl),
      });
    }
  };

  const handleContinueWithApple = async () => {
    setAuthFeedback(null);

    try {
      await continueWithApple();
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: getFriendlyAuthError(error, authRedirectUrl),
      });
    }
  };

  const handleSaveProfile = async () => {
    setHasAttemptedProfileSubmit(true);

    if (hasErrors(profileErrors)) {
      setProfileFeedback(null);
      return;
    }

    const trimmedDisplayName = displayName.trim();
    const trimmedTimezone = timezone.trim();

    setIsProfileSubmitting(true);
    setProfileFeedback(null);

    try {
      await saveProfile({
        displayName: trimmedDisplayName,
        handle: normalizedHandle,
        timezone: trimmedTimezone,
        allowCircleNotifications,
        allowMissedAlarmAlerts,
      });
      setHandle(normalizedHandle);
      setTimezone(trimmedTimezone);
      setProfileFeedback({
        tone: 'success',
        message: 'Profile saved.',
      });
    } catch (error) {
      setProfileFeedback({
        tone: 'danger',
        message: getFriendlyProfileError(error),
      });
    } finally {
      setIsProfileSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setProfileFeedback(null);

    try {
      await signOut();
    } catch (error) {
      setProfileFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Sign-out failed right now.',
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AppScreen keyboardAware>
        <PageHeader
          eyebrow="Account"
          title="Identity and alerts"
          description="Sync, profile, and notification preferences."
          badgeLabel={user ? 'Signed in' : 'Guest'}
          badgeTone={user ? 'success' : 'warning'}
        />

        {!configured ? (
          <StateCard
            description="Add your Supabase URL and anon key to the app environment first, then reopen this module."
            title="Supabase not configured"
          />
        ) : isLoading ? (
          <LoadingBlock description="Checking your account session and profile." title="Loading account" />
        ) : !user ? (
          <>
            <StateCard
              description="Your alarms still run locally. Sign in only if you want sync and circles."
              style={styles.authIntro}
              title="Sync and circles"
              tone="primary"
            />
            <AppCard elevated>
              <SectionHeader
                kicker="Authentication"
                title="Continue securely"
                description="Use Google or Apple to create your sync account and sign back in on any device."
              />

              <View style={styles.buttonGroup}>
                <AppButton
                  disabled={Boolean(authProviderInFlight)}
                  label={isGoogleSubmitting ? 'Connecting Google...' : 'Continue with Google'}
                  onPress={handleContinueWithGoogle}
                  variant="secondary"
                />
                {supportsAppleSignIn ? (
                  <AppButton
                    disabled={Boolean(authProviderInFlight)}
                    label={isAppleSubmitting ? 'Connecting Apple...' : 'Continue with Apple'}
                    onPress={handleContinueWithApple}
                    variant="ghost"
                  />
                ) : null}
              </View>

              <Text style={[styles.helperCaption, { color: colors.muted }]}>
                If sign-in returns to the browser, confirm {authRedirectUrl} is allowed in your Supabase redirect URLs.
              </Text>
              {!supportsAppleSignIn ? (
                <Text style={[styles.helperCaption, { color: colors.muted }]}>
                  Apple sign-in appears on iPhone and iPad builds.
                </Text>
              ) : null}

              {authFeedback && authFeedbackColors ? (
                <View
                  style={[
                    styles.feedbackCard,
                    {
                      backgroundColor: authFeedbackColors.backgroundColor,
                      borderColor: authFeedbackColors.borderColor,
                    },
                  ]}>
                  <Text style={[TextPresets.body, { color: authFeedbackColors.textColor }]}>
                    {authFeedback.message}
                  </Text>
                </View>
              ) : null}
            </AppCard>
          </>
        ) : (
          <>
            <AppCard elevated tone="primary">
              <View style={styles.accountStrip}>
                <View style={styles.accountCopy}>
                  <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Signed in</Text>
                  <Text style={[styles.accountTitle, { color: colors.text }]}>
                    {profile?.displayName || suggestedDisplayName || 'Your account'}
                  </Text>
                  <Text style={[styles.accountMeta, { color: colors.primary }]}>
                    {profile?.handle ? `@${profile.handle}` : 'Finish your profile to show up clearly in circles.'}
                  </Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{signedInAccountLabel}</Text>
                </View>
              </View>

              <View style={styles.summaryPillRow}>
                <View
                  style={[
                    styles.summaryPill,
                    {
                      backgroundColor: profile ? colors.successSurface : colors.warningSurface,
                      borderColor: profile ? colors.success : colors.warning,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.summaryPillLabel,
                      { color: profile ? colors.success : colors.warning },
                    ]}>
                    {profile ? 'Profile ready' : 'Finish setup'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.summaryPill,
                    {
                      backgroundColor: colors.elevated,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[styles.summaryPillLabel, { color: colors.textSoft }]}>{timezone}</Text>
                </View>
              </View>
            </AppCard>

            {isProfileLoading && !profile ? (
              <LoadingBlock
                description="Pulling down your name, handle, timezone, and alert preferences."
                title="Loading profile"
              />
            ) : profileError && !profile ? (
              <StateCard
                actionLabel="Try again"
                description={profileError}
                onAction={() => {
                  void refreshProfile();
                }}
                title="Could not load your profile"
                tone="danger"
              />
            ) : (
              <>
                <AppCard elevated>
                  <SectionHeader
                    kicker="Identity"
                    title={profile ? 'Public profile' : 'Finish your profile'}
                    description="This is how circles will recognize you."
                  />

                  <AppInput
                    autoCapitalize="words"
                    error={hasAttemptedProfileSubmit ? profileErrors.displayName : undefined}
                    helper="Use the name your circle will recognize quickly."
                    label="Display name"
                    onChangeText={(value) => {
                      setDisplayName(value);
                      setProfileFeedback(null);
                    }}
                    placeholder="Early Riser"
                    value={displayName}
                  />

                  <AppInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    error={hasAttemptedProfileSubmit ? profileErrors.handle : undefined}
                    helper={hasAttemptedProfileSubmit && profileErrors.handle ? undefined : handleHelper}
                    label="Handle"
                    onChangeText={(value) => {
                      setHandle(normalizeHandle(value));
                      setProfileFeedback(null);
                    }}
                    placeholder="early_riser"
                    value={handle}
                  />

                  <AppInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    error={hasAttemptedProfileSubmit ? profileErrors.timezone : undefined}
                    helper="Used for circle timestamps and alarm follow-up timing."
                    label="Timezone"
                    onChangeText={(value) => {
                      setTimezone(value);
                      setProfileFeedback(null);
                    }}
                    placeholder="Europe/Skopje"
                    value={timezone}
                  />

                  <View style={styles.timezoneSuggestions}>
                    {timezoneSuggestions.map((zone) => {
                      const isSelected = timezone === zone;

                      return (
                        <Pressable
                          key={zone}
                          accessibilityHint="Sets the profile timezone."
                          accessibilityLabel={`Use timezone ${zone}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => {
                            setTimezone(zone);
                            setProfileFeedback(null);
                          }}
                          style={[
                            styles.timezoneChip,
                            {
                              backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                              borderColor: isSelected ? colors.primary : colors.border,
                            },
                          ]}>
                          <Text
                            style={[
                              styles.timezoneChipLabel,
                              { color: isSelected ? colors.primary : colors.textSoft },
                            ]}>
                            {zone}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.helperCaption, { color: colors.muted }]}>
                    Quick picks come from your device timezone plus common regions.
                  </Text>

                  {profileError ? (
                    <Text style={[TextPresets.body, { color: colors.danger }]}>{profileError}</Text>
                  ) : null}

                  {profileFeedback && profileFeedbackColors ? (
                    <View
                      style={[
                        styles.feedbackCard,
                        {
                          backgroundColor: profileFeedbackColors.backgroundColor,
                          borderColor: profileFeedbackColors.borderColor,
                        },
                      ]}>
                      <Text style={[TextPresets.body, { color: profileFeedbackColors.textColor }]}>
                        {profileFeedback.message}
                      </Text>
                    </View>
                  ) : null}

                  <AppButton
                    disabled={isProfileSubmitting || isProfileLoading}
                    label={isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save profile'}
                    onPress={handleSaveProfile}
                  />
                </AppCard>

                <AppCard elevated tone="canvas">
                  <SectionHeader
                    kicker="Notifications"
                    title="Keep alerts useful"
                    description="Only the notifications you want."
                  />

                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Circle notifications</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Updates for circles, invites, and shared progress.
                      </Text>
                    </View>
                    <Switch
                      accessibilityHint="Turns circle activity notifications on or off."
                      accessibilityLabel="Circle notifications"
                      onValueChange={(value) => {
                        setAllowCircleNotifications(value);
                        setProfileFeedback(null);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={allowCircleNotifications}
                    />
                  </View>

                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Missed-alarm alerts</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Alerts when you miss a scheduled checkpoint.
                      </Text>
                    </View>
                    <Switch
                      accessibilityHint="Turns missed alarm alerts on or off."
                      accessibilityLabel="Missed-alarm alerts"
                      onValueChange={(value) => {
                        setAllowMissedAlarmAlerts(value);
                        setProfileFeedback(null);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={allowMissedAlarmAlerts}
                    />
                  </View>
                </AppCard>

                <AppButton
                  disabled={isSigningOut}
                  label={isSigningOut ? 'Signing out...' : 'Sign out'}
                  onPress={handleSignOut}
                  variant="ghost"
                  style={{ marginTop: Spacing.xl }}
                />
              </>
            )}
          </>
        )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: 100,
  },
  authIntro: {
    marginBottom: Spacing.md,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  modeCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    gap: Spacing.sm,
    minHeight: 108,
    padding: Spacing.lg,
  },
  modeTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  buttonGroup: {
    gap: Spacing.sm,
  },
  helperCaption: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  accountStrip: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  accountAction: {
    alignSelf: 'flex-start',
  },
  accountCopy: {
    gap: Spacing.xs,
    maxWidth: 420,
  },
  accountTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 30,
  },
  accountMeta: {
    ...TextPresets.label,
    fontSize: 16,
    lineHeight: 22,
  },
  summaryPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryPill: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  summaryPillLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  timezoneSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: -Spacing.xs,
  },
  timezoneChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  timezoneChipLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  preferenceRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  preferenceCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
});
