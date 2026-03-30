import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import {
  buildCircleInviteUrl,
  createSocialCircle,
  joinSocialCircleWithInviteCode,
  listMySocialCircles,
} from '@/lib/social/circles';
import { SocialCircleSummary } from '@/lib/social/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialSession } from '@/providers/social-session-provider';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function CirclesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteCode?: string }>();
  const colors = getAppColors(useColorScheme());
  const { configured, isLoading, isProfileComplete, profile, user } = useSocialSession();
  const [circles, setCircles] = useState<SocialCircleSummary[]>([]);
  const [circleName, setCircleName] = useState('');
  const [circleDescription, setCircleDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [screenMessage, setScreenMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCircles = useCallback(async () => {
    if (!configured || !user || !isProfileComplete) {
      setCircles([]);
      setIsRefreshing(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const nextCircles = await listMySocialCircles();
      setCircles(nextCircles);
    } catch (error) {
      Alert.alert('Unable to load circles', getErrorMessage(error, 'The latest circles could not be loaded.'));
    } finally {
      setIsRefreshing(false);
    }
  }, [configured, isProfileComplete, user]);

  useEffect(() => {
    if (typeof params.inviteCode === 'string' && params.inviteCode.trim()) {
      setInviteCode(params.inviteCode.trim());
      setScreenMessage('Invite code detected from the app link. Sign in and join when you are ready.');
    }
  }, [params.inviteCode]);

  useFocusEffect(
    useCallback(() => {
      void loadCircles();
    }, [loadCircles])
  );

  const handleCreateCircle = async () => {
    if (!circleName.trim()) {
      Alert.alert('Circle name required', 'Give your accountability circle a name first.');
      return;
    }

    setIsSubmitting(true);
    setScreenMessage('');

    try {
      const createdCircle = await createSocialCircle({
        name: circleName,
        description: circleDescription,
      });

      setCircleName('');
      setCircleDescription('');
      setCircles((currentCircles) => [...currentCircles, createdCircle]);
      setScreenMessage(`Created ${createdCircle.name}. Share the invite link so someone else can join.`);
    } catch (error) {
      Alert.alert('Unable to create circle', getErrorMessage(error, 'The circle could not be created right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinCircle = async () => {
    if (!inviteCode.trim()) {
      Alert.alert('Invite code required', 'Paste or type the invite code you want to join.');
      return;
    }

    setIsSubmitting(true);
    setScreenMessage('');

    try {
      const joinedCircle = await joinSocialCircleWithInviteCode(inviteCode);
      setInviteCode(joinedCircle.inviteCode);
      setCircles((currentCircles) => {
        const withoutJoinedCircle = currentCircles.filter((circle) => circle.id !== joinedCircle.id);
        return [...withoutJoinedCircle, joinedCircle].sort((left, right) => left.name.localeCompare(right.name));
      });
      setScreenMessage(`Joined ${joinedCircle.name}. You can now attach alarms to this circle.`);
    } catch (error) {
      Alert.alert('Unable to join circle', getErrorMessage(error, 'The invite code could not be used right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareCircle = async (circle: SocialCircleSummary) => {
    try {
      const inviteUrl = buildCircleInviteUrl(circle.inviteCode);
      await Share.share({
        message: `Join my accountability circle "${circle.name}" in QR Checkpoint Alarm.\n\nInvite code: ${circle.inviteCode}\nInvite link: ${inviteUrl}`,
      });
    } catch (error) {
      Alert.alert('Unable to share invite', getErrorMessage(error, 'The invite link could not be shared.'));
    }
  };

  const handleCopyValue = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setScreenMessage(`${label} copied.`);
    } catch (error) {
      Alert.alert('Unable to copy', getErrorMessage(error, `The ${label.toLowerCase()} could not be copied.`));
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Accountability circles</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Create a small crew, share an invite link, and use those circles when you decide which alarms should stay private or become social.
          </Text>
        </View>

        {!configured ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Supabase not configured</Text>
            <Text style={[styles.helperText, { color: colors.muted }]}>
              Add the Supabase env values first so circles can load from the backend.
            </Text>
          </View>
        ) : isLoading ? (
          <View style={[styles.loadingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.helperText, { color: colors.muted }]}>Loading your account session...</Text>
          </View>
        ) : !user ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Sign in first</Text>
            <Text style={[styles.helperText, { color: colors.muted }]}>
              Circles are tied to your profile so invite links, memberships, and shared wake-up events stay consistent across devices.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/account')}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
              <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>Go to account</Text>
            </Pressable>
          </View>
        ) : !isProfileComplete ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Finish your profile</Text>
            <Text style={[styles.helperText, { color: colors.muted }]}>
              Save your display name and handle first so other circle members see a stable identity.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/account')}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
              <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>Complete profile</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Create a circle</Text>
              <Text style={[styles.helperText, { color: colors.muted }]}>
                Start with a tight group. Smaller circles are usually better for accountability than large public feeds.
              </Text>
              <Text style={[styles.label, { color: colors.text }]}>Circle name</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setCircleName}
                placeholder="Morning crew"
                placeholderTextColor={colors.muted}
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={circleName}
              />
              <Text style={[styles.label, { color: colors.text }]}>Description</Text>
              <TextInput
                multiline
                onChangeText={setCircleDescription}
                placeholder="A few people keeping each other honest on weekday alarms."
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multilineInput, { borderColor: colors.border, color: colors.text }]}
                value={circleDescription}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={handleCreateCircle}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: isSubmitting ? 0.7 : 1 },
                ]}>
                <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                  {isSubmitting ? 'Working...' : 'Create circle'}
                </Text>
              </Pressable>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Join with an invite code</Text>
              <Text style={[styles.helperText, { color: colors.muted }]}>
                {profile?.handle
                  ? `Signed in as @${profile.handle}. Use the invite code from another member to join their circle.`
                  : 'Use the invite code from another member to join their circle.'}
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setInviteCode}
                placeholder="paste invite code"
                placeholderTextColor={colors.muted}
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={inviteCode}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={handleJoinCircle}
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.border, opacity: isSubmitting ? 0.7 : 1 },
                ]}>
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Join circle</Text>
              </Pressable>
              {screenMessage ? <Text style={[styles.helperText, { color: colors.success }]}>{screenMessage}</Text> : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your circles</Text>
                {isRefreshing ? <ActivityIndicator color={colors.primary} /> : null}
              </View>
              {circles.length === 0 ? (
                <Text style={[styles.helperText, { color: colors.muted }]}>
                  No circles yet. Create one above or open an invite link from someone else.
                </Text>
              ) : (
                <View style={styles.circleList}>
                  {circles.map((circle) => (
                    <View
                      key={circle.id}
                      style={[styles.circleCard, { backgroundColor: colors.canvas, borderColor: colors.border }]}>
                      <Text style={[styles.circleName, { color: colors.text }]}>{circle.name}</Text>
                      {circle.description ? (
                        <Text style={[styles.helperText, { color: colors.muted }]}>{circle.description}</Text>
                      ) : null}
                      <Text style={[styles.metaText, { color: colors.muted }]}>
                        {circle.memberCount} member{circle.memberCount === 1 ? '' : 's'} · {circle.myRole}
                      </Text>
                      <View style={[styles.inviteBlock, { borderColor: colors.border }]}>
                        <Text style={[styles.inviteLabel, { color: colors.muted }]}>Invite code</Text>
                        <Text selectable style={[styles.inviteValue, { color: colors.text }]}>
                          {circle.inviteCode}
                        </Text>
                      </View>
                      <View style={[styles.inviteBlock, { borderColor: colors.border }]}>
                        <Text style={[styles.inviteLabel, { color: colors.muted }]}>Invite link</Text>
                        <Text selectable style={[styles.inviteLink, { color: colors.text }]}>
                          {buildCircleInviteUrl(circle.inviteCode)}
                        </Text>
                      </View>
                      <View style={styles.inviteActions}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            void handleCopyValue(circle.inviteCode, 'Invite code');
                          }}
                          style={[styles.inviteActionButton, { borderColor: colors.border }]}>
                          <Text style={[styles.inviteActionText, { color: colors.text }]}>Copy code</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            void handleCopyValue(buildCircleInviteUrl(circle.inviteCode), 'Invite link');
                          }}
                          style={[styles.inviteActionButton, { borderColor: colors.border }]}>
                          <Text style={[styles.inviteActionText, { color: colors.text }]}>Copy link</Text>
                        </Pressable>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          void handleShareCircle(circle);
                        }}
                        style={[styles.secondaryButton, { borderColor: colors.border }]}>
                        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Share invite link</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
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
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
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
  circleList: {
    gap: 12,
  },
  circleCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  inviteBlock: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  inviteLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  inviteValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  inviteLink: {
    fontSize: 13,
    lineHeight: 18,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  inviteActionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  inviteActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  circleName: {
    fontSize: 18,
    fontWeight: '700',
  },
  metaText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
