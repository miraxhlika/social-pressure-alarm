import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialSession } from '@/providers/social-session-provider';

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

export default function AccountScreen() {
  const colors = getAppColors(useColorScheme());
  const {
    authRedirectUrl,
    configured,
    isLoading,
    isProfileLoading,
    profile,
    profileError,
    signIn,
    signOut,
    signUp,
    requestMagicLink,
    saveProfile,
    user,
  } = useSocialSession();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [allowCircleNotifications, setAllowCircleNotifications] = useState(true);
  const [allowMissedAlarmAlerts, setAllowMissedAlarmAlerts] = useState(true);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

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
    setTimezone(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setAllowCircleNotifications(profile?.allowCircleNotifications ?? true);
    setAllowMissedAlarmAlerts(profile?.allowMissedAlarmAlerts ?? true);
    setProfileMessage('');
  }, [profile, user?.email, user?.id]);

  const handleSubmitAuth = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert('Email required', 'Enter your email address to continue.');
      return;
    }

    if (!password) {
      Alert.alert('Password required', 'Enter your password to continue.');
      return;
    }

    if (authMode === 'sign-up' && password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Confirm the same password before creating your account.');
      return;
    }

    if (authMode === 'sign-up' && password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters for your account password.');
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage('');

    try {
      if (authMode === 'sign-in') {
        await signIn(trimmedEmail, password);
        setPassword('');
        setConfirmPassword('');
        setAuthMessage('Signed in successfully.');
      } else {
        const result = await signUp(trimmedEmail, password);
        setPassword('');
        setConfirmPassword('');
        setAuthMessage(
          result.requiresEmailConfirmation
            ? `Account created. Check ${result.emailAddress} to confirm your email, then return to the app.`
            : 'Account created and signed in.'
        );
      }
    } catch (error) {
      Alert.alert(
        authMode === 'sign-in' ? 'Unable to sign in' : 'Unable to create account',
        error instanceof Error ? error.message : 'The request could not be completed right now.'
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleSendMagicLink = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert('Email required', 'Enter your email address before requesting a magic link.');
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage('');

    try {
      const recipient = await requestMagicLink(trimmedEmail);
      setAuthMessage(
        `Magic link sent to ${recipient}. If it does not open the app automatically, confirm ${authRedirectUrl} is allowed in Supabase redirect URLs.`
      );
    } catch (error) {
      Alert.alert(
        'Unable to send magic link',
        error instanceof Error ? error.message : 'The magic link could not be sent right now.'
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleSaveProfile = async () => {
    const trimmedDisplayName = displayName.trim();
    const normalizedHandle = normalizeHandle(handle);
    const trimmedTimezone = timezone.trim();

    if (!trimmedDisplayName) {
      Alert.alert('Display name required', 'Add a display name for your accountability profile.');
      return;
    }

    if (!normalizedHandle || normalizedHandle.length < 3) {
      Alert.alert('Handle required', 'Choose a handle with at least 3 letters or numbers.');
      return;
    }

    if (!trimmedTimezone) {
      Alert.alert('Timezone required', 'Enter the timezone you want the social layer to use.');
      return;
    }

    setIsProfileSubmitting(true);
    setProfileMessage('');

    try {
      await saveProfile({
        displayName: trimmedDisplayName,
        handle: normalizedHandle,
        timezone: trimmedTimezone,
        allowCircleNotifications,
        allowMissedAlarmAlerts,
      });
      setHandle(normalizedHandle);
      setProfileMessage('Profile saved.');
    } catch (error) {
      Alert.alert(
        'Unable to save profile',
        error instanceof Error ? error.message : 'Your profile could not be saved right now.'
      );
    } finally {
      setIsProfileSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <PageHeader
          eyebrow="Profile"
          title="Account and settings"
          description="Sign in, update your profile, and manage alerts."
          badgeLabel={user ? 'Signed in' : 'Guest'}
          badgeTone={user ? 'success' : 'warning'}
        />

        {!configured ? (
          <AppCard elevated style={styles.stateCard}>
            <Text style={[styles.stateTitle, { color: colors.text }]}>Supabase not configured</Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              Add your Supabase URL and anon key to the app environment first, then reopen this module.
            </Text>
          </AppCard>
        ) : isLoading ? (
          <AppCard elevated style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[TextPresets.body, { color: colors.muted }]}>Loading account session...</Text>
          </AppCard>
        ) : !user ? (
          <AppCard elevated>
              <SectionHeader
                kicker="Authentication"
                title="Sign in or create account"
                description="Password or magic link."
              />

            <View style={styles.segmentedControl}>
              {(['sign-in', 'sign-up'] as const).map((mode) => {
                const isSelected = authMode === mode;

                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    onPress={() => setAuthMode(mode)}
                    style={[
                      styles.segmentButton,
                      {
                        backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}>
                    <Text style={[TextPresets.label, { color: isSelected ? colors.primary : colors.text }]}>
                      {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <AppInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="you@example.com"
              value={email}
            />

            <AppInput
              autoCapitalize="none"
              autoCorrect={false}
              label="Password"
              onChangeText={setPassword}
              placeholder={authMode === 'sign-in' ? 'Your password' : 'At least 6 characters'}
              secureTextEntry
              value={password}
            />

            {authMode === 'sign-up' ? (
              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                label="Confirm password"
                onChangeText={setConfirmPassword}
                placeholder="Repeat your password"
                secureTextEntry
                value={confirmPassword}
              />
            ) : null}

            {authMessage ? <Text style={[TextPresets.body, { color: colors.success }]}>{authMessage}</Text> : null}

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
                variant="secondary"
              />
            </View>
          </AppCard>
        ) : (
          <>
            <AppCard elevated tone="muted">
              <View style={styles.accountStrip}>
                <View style={styles.accountCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Signed in as</Text>
                  <Text style={[styles.emailText, { color: colors.primary }]}>{user.email ?? 'No email found'}</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    Keep one profile across devices.
                  </Text>
                </View>
                <AppButton
                  disabled={isAuthSubmitting}
                  label="Sign out"
                  onPress={() => {
                    void signOut().catch((error: unknown) => {
                      Alert.alert(
                        'Unable to sign out',
                        error instanceof Error ? error.message : 'Sign-out failed right now.'
                      );
                    });
                  }}
                  size="compact"
                  variant="secondary"
                />
              </View>
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Profile"
                title={profile ? 'Your profile' : 'Complete your profile'}
                description="Name, handle, timezone, and alerts."
              />

              <AppInput
                autoCapitalize="words"
                label="Display name"
                onChangeText={setDisplayName}
                placeholder="Early Riser"
                value={displayName}
              />

              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                helper="Lowercase only, with letters, numbers, and underscores."
                label="Handle"
                onChangeText={(value) => setHandle(normalizeHandle(value))}
                placeholder="early_riser"
                value={handle}
              />

              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                label="Timezone"
                onChangeText={setTimezone}
                placeholder="Europe/Madrid"
                value={timezone}
              />

              <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                <View style={styles.preferenceCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Circle notifications</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    Updates for circles, invites, and shared progress.
                  </Text>
                </View>
                <Switch
                  onValueChange={setAllowCircleNotifications}
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
                  onValueChange={setAllowMissedAlarmAlerts}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={allowMissedAlarmAlerts}
                />
              </View>

              {profileError ? <Text style={[TextPresets.body, { color: colors.danger }]}>{profileError}</Text> : null}
              {profileMessage ? <Text style={[TextPresets.body, { color: colors.success }]}>{profileMessage}</Text> : null}

              <AppButton
                disabled={isProfileSubmitting || isProfileLoading}
                label={isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save profile'}
                onPress={handleSaveProfile}
              />
            </AppCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: 128,
  },
  stateCard: {
    gap: Spacing.md,
  },
  stateTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 28,
  },
  loadingCard: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  buttonGroup: {
    gap: Spacing.sm,
  },
  accountStrip: {
    gap: Spacing.md,
  },
  accountCopy: {
    gap: Spacing.xs,
  },
  emailText: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  preferenceRow: {
    alignItems: 'center',
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
