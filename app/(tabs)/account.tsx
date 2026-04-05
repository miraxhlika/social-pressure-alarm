import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

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

type AuthMode = 'sign-in' | 'sign-up';
type FormFeedbackTone = 'success' | 'danger';
type AuthFieldErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
};
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
const EMAIL_PATTERN = /\S+@\S+\.\S+/;
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

function createSuggestedDisplayName(email?: string | null) {
  if (!email) {
    return '';
  }

  const localPart = email.split('@')[0] ?? '';
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function createSuggestedHandle(email?: string | null) {
  if (!email) {
    return '';
  }

  return (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

function getSuggestedTimezones(...zones: (string | null | undefined)[]) {
  const supportedTimezones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [];
  const hasSupportedTimezones = supportedTimezones.length > 0;

  return Array.from(new Set([...zones, ...COMMON_TIMEZONES].filter((zone): zone is string => Boolean(zone))))
    .filter((zone) => !hasSupportedTimezones || supportedTimezones.includes(zone))
    .slice(0, 8);
}

function getAuthErrors({
  authMode,
  email,
  password,
  confirmPassword,
}: {
  authMode: AuthMode;
  email: string;
  password: string;
  confirmPassword: string;
}): AuthFieldErrors {
  const trimmedEmail = email.trim().toLowerCase();
  const errors: AuthFieldErrors = {};

  if (!trimmedEmail) {
    errors.email = 'Enter your email address to continue.';
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = 'Use a valid email address.';
  }

  if (!password) {
    errors.password = 'Enter your password.';
  } else if (authMode === 'sign-up' && password.length < 6) {
    errors.password = 'Use at least 6 characters.';
  }

  if (authMode === 'sign-up') {
    if (!confirmPassword) {
      errors.confirmPassword = 'Repeat the password once.';
    } else if (confirmPassword !== password) {
      errors.confirmPassword = 'Passwords need to match.';
    }
  }

  return errors;
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

function getFriendlyAuthError(authMode: AuthMode, error: unknown) {
  const message = error instanceof Error ? error.message : 'The request could not be completed right now.';

  if (/invalid login credentials/i.test(message)) {
    return 'That email and password do not match. Try again or use a magic link.';
  }

  if (/email not confirmed/i.test(message)) {
    return 'Confirm your email from the link in your inbox, then return to sign in.';
  }

  if (/user already registered/i.test(message)) {
    return 'An account already exists for this email. Sign in instead or request a magic link.';
  }

  return authMode === 'sign-in' ? message : `Could not create the account. ${message}`;
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
    configured,
    isLoading,
    isProfileLoading,
    profile,
    profileError,
    refreshProfile,
    signIn,
    signOut,
    signUp,
    requestMagicLink,
    saveProfile,
    user,
  } = useSocialSession();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authFeedback, setAuthFeedback] = useState<FormFeedback | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [hasAttemptedAuthSubmit, setHasAttemptedAuthSubmit] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [allowCircleNotifications, setAllowCircleNotifications] = useState(true);
  const [allowMissedAlarmAlerts, setAllowMissedAlarmAlerts] = useState(true);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasAttemptedProfileSubmit, setHasAttemptedProfileSubmit] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<FormFeedback | null>(null);

  useEffect(() => {
    if (user?.email) {
      setEmail((currentEmail) => currentEmail || user.email || '');
    }
  }, [user?.email]);

  useEffect(() => {
    const hydrationKey = `${user?.id ?? 'signed-out'}:${profile?.updatedAt ?? 'no-profile'}`;

    if (hydratedFormKeyRef.current === hydrationKey) {
      return;
    }

    hydratedFormKeyRef.current = hydrationKey;
    setDisplayName(profile?.displayName ?? createSuggestedDisplayName(user?.email));
    setHandle(profile?.handle ?? createSuggestedHandle(user?.email));
    setTimezone(profile?.timezone ?? DEFAULT_TIMEZONE);
    setAllowCircleNotifications(profile?.allowCircleNotifications ?? true);
    setAllowMissedAlarmAlerts(profile?.allowMissedAlarmAlerts ?? true);
    setProfileFeedback(null);
    setHasAttemptedProfileSubmit(false);
  }, [profile, user?.email, user?.id]);

  const authErrors = getAuthErrors({
    authMode,
    email,
    password,
    confirmPassword,
  });
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

  const handleSubmitAuth = async () => {
    setHasAttemptedAuthSubmit(true);

    if (hasErrors(authErrors)) {
      setAuthFeedback(null);
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    setIsAuthSubmitting(true);
    setAuthFeedback(null);

    try {
      if (authMode === 'sign-in') {
        await signIn(trimmedEmail, password);
        setPassword('');
        setConfirmPassword('');
      } else {
        const result = await signUp(trimmedEmail, password);
        setPassword('');
        setConfirmPassword('');
        setAuthFeedback({
          tone: 'success',
          message: result.requiresEmailConfirmation
            ? `Account created. Check ${result.emailAddress} to confirm your email, then return to the app.`
            : 'Account created and signed in.',
        });
      }
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: getFriendlyAuthError(authMode, error),
      });
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleSendMagicLink = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setAuthFeedback({
        tone: 'danger',
        message: 'Enter a valid email address before requesting a magic link.',
      });
      return;
    }

    setIsAuthSubmitting(true);
    setAuthFeedback(null);

    try {
      const recipient = await requestMagicLink(trimmedEmail);
      setAuthFeedback({
        tone: 'success',
        message: `Magic link sent to ${recipient}. If it does not open the app automatically, confirm ${authRedirectUrl} is allowed in Supabase redirect URLs.`,
      });
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'The magic link could not be sent right now.',
      });
    } finally {
      setIsAuthSubmitting(false);
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
                title={authMode === 'sign-in' ? 'Sign in' : 'Create account'}
                description={
                  authMode === 'sign-in'
                    ? 'Use your password or a magic link.'
                    : 'Create one account for sync and circles.'
                }
                action={
                  <AppButton
                    label={authMode === 'sign-in' ? 'Create account instead' : 'Sign in instead'}
                    onPress={() => {
                      setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in');
                      setHasAttemptedAuthSubmit(false);
                      setAuthFeedback(null);
                      setPassword('');
                      setConfirmPassword('');
                    }}
                    size="compact"
                    variant="ghost"
                  />
                }
              />

              <AppInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                error={hasAttemptedAuthSubmit ? authErrors.email : undefined}
                helper="Used for sign-in links, password recovery, and your profile."
                inputMode="email"
                keyboardType="email-address"
                label="Email"
                onChangeText={(value) => {
                  setEmail(value);
                  setAuthFeedback(null);
                }}
                placeholder="you@example.com"
                textContentType="emailAddress"
                value={email}
              />

              <AppInput
                autoCapitalize="none"
                autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                autoCorrect={false}
                error={hasAttemptedAuthSubmit ? authErrors.password : undefined}
                helper={authMode === 'sign-in' ? 'Use the password tied to this email.' : 'Use at least 6 characters.'}
                label="Password"
                onChangeText={(value) => {
                  setPassword(value);
                  setAuthFeedback(null);
                }}
                placeholder={authMode === 'sign-in' ? 'Your password' : 'At least 6 characters'}
                secureTextEntry
                textContentType={authMode === 'sign-in' ? 'password' : 'newPassword'}
                value={password}
              />

              {authMode === 'sign-up' ? (
                <AppInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect={false}
                  error={hasAttemptedAuthSubmit ? authErrors.confirmPassword : undefined}
                  label="Confirm password"
                  onChangeText={(value) => {
                    setConfirmPassword(value);
                    setAuthFeedback(null);
                  }}
                  placeholder="Repeat your password"
                  secureTextEntry
                  textContentType="newPassword"
                  value={confirmPassword}
                />
              ) : null}

              <View style={styles.buttonGroup}>
                <AppButton
                  disabled={isAuthSubmitting}
                  label={isAuthSubmitting ? 'Working...' : authMode === 'sign-in' ? 'Sign in' : 'Create account'}
                  onPress={handleSubmitAuth}
                />
                <AppButton
                  disabled={isAuthSubmitting}
                  label="Send magic link"
                  onPress={handleSendMagicLink}
                  variant="ghost"
                />
              </View>

              <Text style={[styles.helperCaption, { color: colors.muted }]}>
                Magic links work for first-time access too.
              </Text>

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
                    {profile?.displayName || createSuggestedDisplayName(user.email) || 'Your account'}
                  </Text>
                  <Text style={[styles.accountMeta, { color: colors.primary }]}>
                    {profile?.handle ? `@${profile.handle}` : 'Finish your profile to show up clearly in circles.'}
                  </Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{user.email ?? 'No email found'}</Text>
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
