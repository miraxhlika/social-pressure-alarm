import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
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
  const router = useRouter();
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Accountability account</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Sign in to sync alarm outcomes, keep your profile, and unlock circles and social sharing.
          </Text>
        </View>

        {!configured ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Supabase not configured</Text>
            <Text style={[styles.helperText, { color: colors.muted }]}>
              Add your Supabase URL and anon key to the app env first, then reopen this screen.
            </Text>
          </View>
        ) : isLoading ? (
          <View
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.helperText, { color: colors.muted }]}>Loading account session...</Text>
          </View>
        ) : !user ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
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
                        backgroundColor: isSelected ? `${colors.primary}14` : 'transparent',
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.segmentButtonText,
                        {
                          color: isSelected ? colors.primary : colors.text,
                        },
                      ]}>
                      {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={email}
            />

            <Text style={[styles.label, { color: colors.text }]}>Password</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPassword}
              placeholder={authMode === 'sign-in' ? 'Your password' : 'At least 6 characters'}
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={password}
            />

            {authMode === 'sign-up' ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>Confirm password</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setConfirmPassword}
                  placeholder="Repeat your password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={[
                    styles.input,
                    {
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={confirmPassword}
                />
              </>
            ) : null}

            {authMessage ? (
              <Text style={[styles.helperText, { color: colors.success }]}>{authMessage}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isAuthSubmitting}
              onPress={handleSubmitAuth}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: isAuthSubmitting ? 0.7 : 1,
                },
              ]}>
              <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                {isAuthSubmitting
                  ? 'Working...'
                  : authMode === 'sign-in'
                    ? 'Sign In'
                    : 'Create Account'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isAuthSubmitting}
              onPress={handleSendMagicLink}
              style={[
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  opacity: isAuthSubmitting ? 0.7 : 1,
                },
              ]}>
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Send magic link</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Signed in</Text>
              <Text style={[styles.emailText, { color: colors.primary }]}>{user.email ?? 'No email found'}</Text>
              <Text style={[styles.helperText, { color: colors.muted }]}>
                Finish your profile so circles, invites, and synced wake-up history have a stable identity.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isAuthSubmitting}
                onPress={() => {
                  void signOut().catch((error: unknown) => {
                    Alert.alert(
                      'Unable to sign out',
                      error instanceof Error ? error.message : 'Sign-out failed right now.'
                    );
                  });
                }}
                style={[
                  styles.secondaryButton,
                  {
                    borderColor: colors.border,
                  },
                ]}>
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Sign out</Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {profile ? 'Your profile' : 'Complete your profile'}
              </Text>
              <Text style={[styles.helperText, { color: colors.muted }]}>
                This stays lightweight for now: name, handle, timezone, and notification preferences.
              </Text>

              <Text style={[styles.label, { color: colors.text }]}>Display name</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setDisplayName}
                placeholder="Early Riser"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={displayName}
              />

              <Text style={[styles.label, { color: colors.text }]}>Handle</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setHandle(normalizeHandle(value))}
                placeholder="early_riser"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={handle}
              />

              <Text style={[styles.label, { color: colors.text }]}>Timezone</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setTimezone}
                placeholder="Europe/Madrid"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={timezone}
              />

              <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                <View style={styles.preferenceCopy}>
                  <Text style={[styles.preferenceTitle, { color: colors.text }]}>
                    Circle notifications
                  </Text>
                  <Text style={[styles.preferenceText, { color: colors.muted }]}>
                    Allow updates from circles, invites, and social progress.
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
                  <Text style={[styles.preferenceTitle, { color: colors.text }]}>
                    Missed-alarm alerts
                  </Text>
                  <Text style={[styles.preferenceText, { color: colors.muted }]}>
                    Allow accountability alerts when you miss a wake-up.
                  </Text>
                </View>
                <Switch
                  onValueChange={setAllowMissedAlarmAlerts}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={allowMissedAlarmAlerts}
                />
              </View>

              {profileError ? <Text style={[styles.helperText, { color: colors.danger }]}>{profileError}</Text> : null}
              {profileMessage ? (
                <Text style={[styles.helperText, { color: colors.success }]}>{profileMessage}</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={isProfileSubmitting || isProfileLoading}
                onPress={handleSaveProfile}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: isProfileSubmitting || isProfileLoading ? 0.7 : 1,
                  },
                ]}>
                <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                  {isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save Profile'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Back Home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    gap: 8,
    paddingTop: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  loadingCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
  },
  emailText: {
    fontSize: 16,
    fontWeight: '700',
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 10,
  },
  segmentButton: {
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  segmentButtonText: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  preferenceRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    padding: 14,
  },
  preferenceCopy: {
    flex: 1,
    gap: 4,
  },
  preferenceTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  preferenceText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
