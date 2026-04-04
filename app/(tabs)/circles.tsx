import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatFeedInsight, formatSocialTimestamp } from '@/lib/dashboard';
import {
  buildCircleInviteUrl,
  createSocialCircle,
  joinSocialCircleWithInviteCode,
  listMySocialCircles,
} from '@/lib/social/circles';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { getSocialDashboardInsights } from '@/lib/social/insights';
import {
  SocialChallengeSummary,
  SocialCircleSummary,
  SocialFeedItem,
  SocialLeaderboardEntry,
} from '@/lib/social/types';
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
  const [feed, setFeed] = useState<SocialFeedItem[]>([]);
  const [challenges, setChallenges] = useState<SocialChallengeSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<SocialLeaderboardEntry[]>([]);

  const loadCircles = useCallback(async () => {
    if (!configured || !user || !isProfileComplete) {
      setCircles([]);
      setFeed([]);
      setChallenges([]);
      setLeaderboard([]);
      setIsRefreshing(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const [nextCircles, nextFeed, insights] = await Promise.all([
        listMySocialCircles(),
        listVisibleSocialFeed(4).catch(() => []),
        getSocialDashboardInsights().catch(() => ({
          challenges: [] as SocialChallengeSummary[],
          leaderboard: [] as SocialLeaderboardEntry[],
        })),
      ]);

      setCircles(nextCircles);
      setFeed(nextFeed);
      setChallenges(insights.challenges);
      setLeaderboard(insights.leaderboard.slice(0, 4));
    } catch (error) {
      Alert.alert('Unable to load circles', getErrorMessage(error, 'The latest circles could not be loaded.'));
    } finally {
      setIsRefreshing(false);
    }
  }, [configured, isProfileComplete, user]);

  useEffect(() => {
    if (typeof params.inviteCode === 'string' && params.inviteCode.trim()) {
      setInviteCode(params.inviteCode.trim());
      setScreenMessage('Invite code detected from the app link. Join when you are ready.');
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

  const topChallenge = challenges[0] ?? null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <PageHeader
          eyebrow="Circles"
          title="Shared accountability"
          description="Create, join, and manage your circles."
          badgeLabel={user ? `@${profile?.handle ?? 'profile'}` : 'Guest'}
          badgeTone={user ? 'success' : 'warning'}
        />

        {!configured ? (
          <StateCard
            actionLabel="Open profile"
            colors={colors}
            copy="Add the Supabase environment values first so circles can load from the backend."
            onPress={() => router.push('/account')}
            title="Supabase not configured"
          />
        ) : isLoading ? (
          <AppCard elevated style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[TextPresets.body, { color: colors.muted }]}>Loading your account session...</Text>
          </AppCard>
        ) : !user ? (
          <StateCard
            actionLabel="Go to profile"
            colors={colors}
            copy="Circles are tied to your account so invites and shared wake-up events stay stable."
            onPress={() => router.push('/account')}
            title="Sign in first"
          />
        ) : !isProfileComplete ? (
          <StateCard
            actionLabel="Complete profile"
            colors={colors}
            copy="Save your display name and handle first so other members see a stable identity."
            onPress={() => router.push('/account')}
            title="Finish your profile"
          />
        ) : (
          <>
            <AppCard elevated tone="muted" style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryMetric}>
                  <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Circles</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{circles.length}</Text>
                </View>
                <View style={styles.summaryMetric}>
                  <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Feed items</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{feed.length}</Text>
                </View>
                <View style={styles.summaryMetric}>
                  <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Top streak</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {leaderboard[0]?.bestStreak ?? 0}
                  </Text>
                </View>
              </View>

              {topChallenge ? (
                <View style={[styles.challengeStrip, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
                  <View style={styles.challengeCopy}>
                    <Text style={[TextPresets.label, { color: colors.text }]}>{topChallenge.title}</Text>
                    <Text style={[TextPresets.body, { color: colors.muted }]}>{topChallenge.progressLabel}</Text>
                  </View>
                  <StatusPill label={topChallenge.isCompleted ? 'Completed' : 'In progress'} tone={topChallenge.isCompleted ? 'success' : 'primary'} />
                </View>
              ) : null}
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Create"
                title="Start a circle"
                description="Create a new circle."
              />
              <AppInput
                autoCapitalize="words"
                label="Circle name"
                onChangeText={setCircleName}
                placeholder="Morning crew"
                value={circleName}
              />
              <AppInput
                inputStyle={styles.multilineInput}
                label="Description"
                multiline
                onChangeText={setCircleDescription}
                placeholder="People who will notice missed weekday alarms."
                value={circleDescription}
              />
              <AppButton
                disabled={isSubmitting}
                label={isSubmitting ? 'Working...' : 'Create circle'}
                onPress={handleCreateCircle}
              />
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Join"
                title="Use an invite code"
                description={profile?.handle ? `Signed in as @${profile.handle}.` : 'Join another circle.'}
              />
              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                label="Invite code"
                onChangeText={setInviteCode}
                placeholder="paste invite code"
                value={inviteCode}
              />
              <AppButton
                disabled={isSubmitting}
                label="Join circle"
                onPress={handleJoinCircle}
                variant="secondary"
              />
              {screenMessage ? <Text style={[TextPresets.body, { color: colors.success }]}>{screenMessage}</Text> : null}
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Manage"
                title="Your circles"
                description="Members, invites, and roles."
                action={isRefreshing ? <ActivityIndicator color={colors.primary} /> : undefined}
              />
              {circles.length === 0 ? (
                <Text style={[TextPresets.body, { color: colors.muted }]}>
                  No circles yet. Create one above or open an invite link from someone else.
                </Text>
              ) : (
                <View style={styles.circleList}>
                  {circles.map((circle) => (
                    <AppCard key={circle.id} padded={false} style={styles.circleCard} tone="canvas">
                      <View style={styles.circleContent}>
                        <View style={styles.circleHeader}>
                          <View style={styles.circleCopy}>
                            <Text style={[TextPresets.label, { color: colors.text }]}>{circle.name}</Text>
                            {circle.description ? (
                              <Text style={[TextPresets.body, { color: colors.muted }]}>{circle.description}</Text>
                            ) : null}
                          </View>
                          <StatusPill label={circle.myRole} tone="primary" />
                        </View>

                        <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                          {circle.memberCount} member{circle.memberCount === 1 ? '' : 's'}
                        </Text>

                        <View style={[styles.inviteBlock, { borderColor: colors.border }]}>
                          <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Invite code</Text>
                          <Text selectable style={[styles.inviteValue, { color: colors.text }]}>
                            {circle.inviteCode}
                          </Text>
                        </View>

                        <View style={styles.inviteActions}>
                          <AppButton
                            label="Copy code"
                            onPress={() => {
                              void handleCopyValue(circle.inviteCode, 'Invite code');
                            }}
                            size="compact"
                            style={styles.actionFill}
                            variant="secondary"
                          />
                          <AppButton
                            label="Copy link"
                            onPress={() => {
                              void handleCopyValue(buildCircleInviteUrl(circle.inviteCode), 'Invite link');
                            }}
                            size="compact"
                            style={styles.actionFill}
                            variant="secondary"
                          />
                        </View>

                        <AppButton
                          label="Share invite link"
                          onPress={() => {
                            void handleShareCircle(circle);
                          }}
                          size="compact"
                          variant="ghost"
                        />
                      </View>
                    </AppCard>
                  ))}
                </View>
              )}
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Activity"
                title="Recent circle feed"
                description="Recent shared results."
              />
              {feed.length === 0 ? (
                <Text style={[TextPresets.body, { color: colors.muted }]}>
                  Shared alarm outcomes will appear here after members start posting results.
                </Text>
              ) : (
                <View style={styles.feedList}>
                  {feed.map((item) => (
                    <AppCard key={item.id} padded={false} style={styles.feedCard} tone="canvas">
                      <View style={styles.feedContent}>
                        <View style={styles.feedHeader}>
                          <View style={styles.circleCopy}>
                            <Text style={[TextPresets.label, { color: colors.text }]}>
                              {item.isOwnEvent ? 'You' : item.actorDisplayName}
                            </Text>
                            <Text style={[TextPresets.body, { color: colors.muted }]}>
                              @{item.actorHandle} · {item.circleName}
                            </Text>
                          </View>
                          <StatusPill
                            label={item.outcome === 'confirmed' ? 'Cleared' : 'Missed'}
                            tone={item.outcome === 'confirmed' ? 'success' : 'danger'}
                          />
                        </View>
                        <Text style={[styles.feedTitle, { color: colors.text }]}>{item.alarmLabel}</Text>
                        <Text style={[TextPresets.body, { color: colors.textSoft }]}>{formatFeedInsight(item)}</Text>
                        <Text style={[TextPresets.body, { color: colors.muted }]}>
                          {formatSocialTimestamp(item.resolvedAt)}
                        </Text>
                      </View>
                    </AppCard>
                  ))}
                </View>
              )}
            </AppCard>

            <AppCard elevated>
              <SectionHeader
                kicker="Leaderboard"
                title="Current ranking"
                description="Wins, streaks, and completion rate."
              />
              {leaderboard.length === 0 ? (
                <Text style={[TextPresets.body, { color: colors.muted }]}>
                  The leaderboard appears after shared results land in the circle feed.
                </Text>
              ) : (
                <View style={styles.feedList}>
                  {leaderboard.map((entry, index) => (
                    <AppCard key={entry.userId} padded={false} style={styles.feedCard} tone="canvas">
                      <View style={[styles.feedContent, styles.leaderboardRow]}>
                        <Text style={[styles.rank, { color: colors.primary }]}>#{index + 1}</Text>
                        <View style={styles.circleCopy}>
                          <Text style={[TextPresets.label, { color: colors.text }]}>
                            {entry.isMe ? 'You' : entry.displayName}
                          </Text>
                          <Text style={[TextPresets.body, { color: colors.muted }]}>@{entry.handle}</Text>
                        </View>
                        <View style={styles.leaderboardStats}>
                          <Text style={[TextPresets.label, { color: colors.text }]}>{entry.wins} wins</Text>
                          <Text style={[TextPresets.body, { color: colors.muted }]}>
                            {entry.bestStreak} streak · {entry.completionRate}%
                          </Text>
                        </View>
                      </View>
                    </AppCard>
                  ))}
                </View>
              )}
            </AppCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StateCard({
  title,
  copy,
  actionLabel,
  onPress,
  colors,
}: {
  title: string;
  copy: string;
  actionLabel: string;
  onPress: () => void;
  colors: ReturnType<typeof getAppColors>;
}) {
  return (
    <AppCard elevated style={styles.stateCard}>
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[TextPresets.body, { color: colors.muted }]}>{copy}</Text>
      <AppButton label={actionLabel} onPress={onPress} />
    </AppCard>
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
  loadingCard: {
    alignItems: 'center',
    gap: Spacing.sm,
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
  summaryCard: {
    gap: Spacing.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  summaryMetric: {
    flex: 1,
    gap: Spacing.xs,
  },
  summaryValue: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  challengeStrip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  challengeCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  circleList: {
    gap: Spacing.md,
  },
  circleCard: {
    borderRadius: Radius.lg,
  },
  circleContent: {
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  circleHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  circleCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  inviteBlock: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  inviteValue: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
    lineHeight: 26,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionFill: {
    flex: 1,
  },
  feedList: {
    gap: Spacing.sm,
  },
  feedCard: {
    borderRadius: Radius.lg,
  },
  feedContent: {
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  feedHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  feedTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  leaderboardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  rank: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '800',
    width: 36,
  },
  leaderboardStats: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
});
