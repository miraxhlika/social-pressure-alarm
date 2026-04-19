import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StateCard } from '@/components/ui/state-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
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

function formatMemberCount(count: number) {
  return `${count} member${count === 1 ? '' : 's'}`;
}

function formatActivityTitle(item: SocialFeedItem) {
  const verb = item.outcome === 'confirmed' ? 'cleared' : 'missed';
  return `${item.isOwnEvent ? 'You' : item.actorDisplayName} ${verb} ${item.alarmLabel}`;
}

function formatActivityMeta(item: SocialFeedItem) {
  return `${item.circleName} · ${formatFeedInsight(item)} · ${formatSocialTimestamp(item.resolvedAt)}`;
}

function matchesFeedSearch(item: SocialFeedItem, query: string) {
  if (!query) {
    return true;
  }

  const searchableText = [
    item.actorDisplayName,
    item.actorHandle,
    item.circleName,
    item.alarmLabel,
    item.outcome === 'confirmed' ? 'cleared' : 'missed',
    formatFeedInsight(item),
  ]
    .join(' ')
    .toLowerCase();

  return searchableText.includes(query);
}

type AccountabilityPlan = {
  title: string;
  body: string;
  actionLabel: string;
  action: 'manage' | 'share' | 'create';
};

function getCircleCommitmentHint(circle: SocialCircleSummary, circleFeed: SocialFeedItem[]) {
  if (circle.memberCount <= 1) {
    return 'Invite one person who will actually notice a miss. One partner is enough.';
  }

  if (circleFeed.length === 0) {
    return 'Attach one checkpoint and share clears first so this group has a real signal.';
  }

  if (circleFeed.some((item) => item.outcome === 'missed')) {
    return 'A miss already surfaced here. Review it quickly, adjust the checkpoint, and keep the circle focused.';
  }

  return 'Clears are flowing. Decide together whether misses stay private or become opt-in for firmer pressure.';
}

function getAccountabilityPlan(circles: SocialCircleSummary[], feed: SocialFeedItem[]): AccountabilityPlan {
  if (circles.length === 0) {
    return {
      title: 'Start with one person',
      body: 'A useful circle can be one reliable person who would notice a miss. Build small, then attach one checkpoint.',
      actionLabel: 'Set up a circle',
      action: 'manage',
    };
  }

  if (circles.every((circle) => circle.memberCount <= 1)) {
    return {
      title: 'Invite your first accountability partner',
      body: 'You have the structure, but nobody else is in yet. Share one invite with someone who will actually notice when you slip.',
      actionLabel: 'Share an invite',
      action: 'share',
    };
  }

  if (feed.length === 0) {
    return {
      title: 'Set the first shared checkpoint',
      body: 'Your circle has members, but it still needs one real commitment. Start by sharing clears, then decide if misses should stay opt-in.',
      actionLabel: 'Attach a checkpoint',
      action: 'create',
    };
  }

  if (feed.some((item) => item.outcome === 'missed')) {
    return {
      title: 'Keep misses useful, not noisy',
      body: 'Use misses as fast recovery prompts. Adjust the checkpoint, keep the group small, and avoid turning accountability into chatter.',
      actionLabel: 'Adjust a checkpoint',
      action: 'create',
    };
  }

  return {
    title: 'Protect one routine this week',
    body: 'Small circles work when everyone knows which checkpoint matters. Keep the group tight and the proof concrete.',
    actionLabel: 'Create another checkpoint',
    action: 'create',
  };
}

const FEED_PAGE_SIZE = 12;
const LOAD_MORE_THRESHOLD = 240;
const ALL_CIRCLES_FILTER = 'all';

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
  const [loadError, setLoadError] = useState('');
  const [feed, setFeed] = useState<SocialFeedItem[]>([]);
  const [feedSearchQuery, setFeedSearchQuery] = useState('');
  const [selectedFeedCircleId, setSelectedFeedCircleId] = useState<string>(ALL_CIRCLES_FILTER);
  const [hasMoreFeed, setHasMoreFeed] = useState(false);
  const [isLoadingMoreFeed, setIsLoadingMoreFeed] = useState(false);
  const [challenges, setChallenges] = useState<SocialChallengeSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<SocialLeaderboardEntry[]>([]);
  const [activeView, setActiveView] = useState<'activity' | 'manage'>('activity');

  const loadCircles = useCallback(async () => {
    if (!configured || !user || !isProfileComplete) {
      setCircles([]);
      setFeed([]);
      setHasMoreFeed(false);
      setIsLoadingMoreFeed(false);
      setChallenges([]);
      setLeaderboard([]);
      setIsRefreshing(false);
      setLoadError('');
      return;
    }

    setIsRefreshing(true);
    setLoadError('');

    try {
      const [nextCircles, nextFeed, insights] = await Promise.all([
        listMySocialCircles(),
        listVisibleSocialFeed({ limitCount: FEED_PAGE_SIZE }).catch(() => []),
        getSocialDashboardInsights().catch(() => ({
          challenges: [] as SocialChallengeSummary[],
          leaderboard: [] as SocialLeaderboardEntry[],
        })),
      ]);

      setCircles(nextCircles);
      setFeed(nextFeed);
      setHasMoreFeed(nextFeed.length === FEED_PAGE_SIZE);
      setChallenges(insights.challenges);
      setLeaderboard(insights.leaderboard.slice(0, 4));
    } catch (error) {
      setLoadError(getErrorMessage(error, 'The latest circles could not be loaded.'));
    } finally {
      setIsRefreshing(false);
      setIsLoadingMoreFeed(false);
    }
  }, [configured, isProfileComplete, user]);

  useEffect(() => {
    if (typeof params.inviteCode === 'string' && params.inviteCode.trim()) {
      setInviteCode(params.inviteCode.trim());
      setScreenMessage('Invite code detected from the app link. Join when you are ready, then attach one checkpoint to make the circle real.');
    }
  }, [params.inviteCode]);

  useFocusEffect(
    useCallback(() => {
      void loadCircles();
    }, [loadCircles])
  );

  useEffect(() => {
    if (selectedFeedCircleId === ALL_CIRCLES_FILTER) {
      return;
    }

    if (!circles.some((circle) => circle.id === selectedFeedCircleId)) {
      setSelectedFeedCircleId(ALL_CIRCLES_FILTER);
    }
  }, [circles, selectedFeedCircleId]);

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
      setScreenMessage(`Created ${createdCircle.name}. The next move is sharing one invite with someone who will notice a miss.`);
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
      await trackAnalyticsEvent('invite_accepted', {
        circleId: joinedCircle.id,
      });
      setInviteCode(joinedCircle.inviteCode);
      setCircles((currentCircles) => {
        const withoutJoinedCircle = currentCircles.filter((circle) => circle.id !== joinedCircle.id);
        return [...withoutJoinedCircle, joinedCircle].sort((left, right) => left.name.localeCompare(right.name));
      });
      setScreenMessage(
        `Joined ${joinedCircle.name}. Next: attach one checkpoint and decide whether this circle sees clears only or clears plus misses.`
      );
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
        message: `Join my accountability circle "${circle.name}" in QR Checkpoint Alarm.\n\nSmall groups work best here, so this is meant for one or two people who would actually notice a miss.\n\nInvite code: ${circle.inviteCode}\nInvite link: ${inviteUrl}`,
      });
      await trackAnalyticsEvent('invite_sent', {
        circleId: circle.id,
      });
    } catch (error) {
      Alert.alert('Unable to share invite', getErrorMessage(error, 'The invite link could not be shared.'));
    }
  };

  const handleCopyInviteLink = async (circle: SocialCircleSummary) => {
    await handleCopyValue(buildCircleInviteUrl(circle.inviteCode), 'Invite link');
  };

  const handleCopyValue = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setScreenMessage(`${label} copied.`);
    } catch (error) {
      Alert.alert('Unable to copy', getErrorMessage(error, `The ${label.toLowerCase()} could not be copied.`));
    }
  };

  const loadMoreFeed = useCallback(async () => {
    if (!configured || !user || !isProfileComplete || isRefreshing || isLoadingMoreFeed || !hasMoreFeed) {
      return;
    }

    setIsLoadingMoreFeed(true);

    try {
      const nextPage = await listVisibleSocialFeed({
        limitCount: FEED_PAGE_SIZE,
        offsetCount: feed.length,
      });
      const existingIds = new Set(feed.map((item) => item.id));
      const uniqueNextPage = nextPage.filter((item) => !existingIds.has(item.id));

      setFeed((currentFeed) => (uniqueNextPage.length > 0 ? [...currentFeed, ...uniqueNextPage] : currentFeed));
      setHasMoreFeed(nextPage.length === FEED_PAGE_SIZE && uniqueNextPage.length > 0);
    } catch (error) {
      Alert.alert('Unable to load more activity', getErrorMessage(error, 'More clears and misses could not be loaded.'));
    } finally {
      setIsLoadingMoreFeed(false);
    }
  }, [configured, feed, hasMoreFeed, isLoadingMoreFeed, isProfileComplete, isRefreshing, user]);

  const handleActivityScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;

      if (contentSize.height <= layoutMeasurement.height) {
        return;
      }

      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);

      if (distanceFromBottom <= LOAD_MORE_THRESHOLD) {
        void loadMoreFeed();
      }
    },
    [loadMoreFeed]
  );

  const latestFeedItem = feed[0] ?? null;
  const topChallenge = challenges[0] ?? null;
  const totalMembers = circles.reduce((count, circle) => count + circle.memberCount, 0);
  const shareableCircle = circles.find((circle) => circle.myRole === 'owner') ?? circles[0] ?? null;
  const feedByCircleId = useMemo(
    () =>
      feed.reduce<Record<string, SocialFeedItem[]>>((result, item) => {
        const currentItems = result[item.circleId] ?? [];
        result[item.circleId] = [...currentItems, item];
        return result;
      }, {}),
    [feed]
  );
  const accountabilityPlan = useMemo(() => getAccountabilityPlan(circles, feed), [circles, feed]);
  const normalizedFeedSearchQuery = feedSearchQuery.trim().toLowerCase();
  const isFilteringFeed = selectedFeedCircleId !== ALL_CIRCLES_FILTER || normalizedFeedSearchQuery.length > 0;
  const filteredFeed = useMemo(
    () =>
      feed.filter(
        (item) =>
          (selectedFeedCircleId === ALL_CIRCLES_FILTER || item.circleId === selectedFeedCircleId) &&
          matchesFeedSearch(item, normalizedFeedSearchQuery)
      ),
    [feed, normalizedFeedSearchQuery, selectedFeedCircleId]
  );
  const feedSummary =
    filteredFeed.length === feed.length && !isFilteringFeed
      ? `${feed.length} activit${feed.length === 1 ? 'y' : 'ies'} loaded`
      : `Showing ${filteredFeed.length} of ${feed.length} loaded`;
  const activitySummary =
    circles.length === 0
      ? 'Create one small circle and attach one checkpoint when you are ready for outside accountability.'
      : latestFeedItem
        ? 'The latest accountability signal, the people involved, and the routine that currently matters most.'
        : 'Your circles are ready. The first shared clear or miss will turn this into a real accountability board.';

  const handleAccountabilityPlanAction = useCallback(() => {
    if (accountabilityPlan.action === 'manage') {
      setActiveView('manage');
      return;
    }

    if (accountabilityPlan.action === 'share') {
      if (shareableCircle) {
        void handleShareCircle(shareableCircle);
      } else {
        setActiveView('manage');
      }
      return;
    }

    router.push('/create');
  }, [accountabilityPlan.action, router, shareableCircle]);

  useEffect(() => {
    if (activeView !== 'activity' || !isFilteringFeed || filteredFeed.length > 0 || !hasMoreFeed || isLoadingMoreFeed) {
      return;
    }

    void loadMoreFeed();
  }, [activeView, filteredFeed.length, hasMoreFeed, isFilteringFeed, isLoadingMoreFeed, loadMoreFeed]);

  return (
    <AppScreen
      contentStyle={styles.screenContent}
      scrollProps={
        activeView === 'activity'
          ? {
              onScroll: handleActivityScroll,
              scrollEventThrottle: 16,
            }
          : undefined
      }>
      <PageHeader
        badgeLabel={user ? `@${profile?.handle ?? 'profile'}` : 'Guest'}
        badgeTone={user ? 'success' : 'warning'}
        eyebrow="Circles"
        description="Small-group accountability built on real proof."
        size="compact"
        title="Circles"
      />

      {!configured ? (
        <StateCard
          actionLabel="Open account"
          description="Add the backend values first so circles can load."
          onAction={() => router.push('/account')}
          title="Circles are unavailable"
        />
      ) : isLoading ? (
        <LoadingBlock description="Loading your account session for circles." title="Loading circles" />
      ) : !user ? (
        <StateCard
          actionLabel="Go to account"
          description="Sign in if you want durable invites and small-group accountability."
          onAction={() => router.push('/account')}
          title="Sign in first"
        />
      ) : !isProfileComplete ? (
        <StateCard
          actionLabel="Complete profile"
          description="Save your display name and handle first."
          onAction={() => router.push('/account')}
          title="Finish your profile"
        />
      ) : (
        <>
          <View style={[styles.segmentedControl, { backgroundColor: colors.panel, borderColor: colors.line }]}>
            {(['activity', 'manage'] as const).map((view) => {
              const isActive = activeView === view;

              return (
                <Pressable
                  key={view}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setActiveView(view)}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: isActive ? colors.elevated : 'transparent',
                      borderColor: isActive ? colors.line : 'transparent',
                    },
                  ]}>
                  <Text style={[TextPresets.label, { color: isActive ? colors.primary : colors.text }]}>
                    {view === 'activity' ? 'Activity' : 'Manage'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <AppCard elevated tone="primary" style={styles.accountabilityCard}>
            <SectionHeader
              kicker="Accountability"
              size="compact"
              title={accountabilityPlan.title}
              description={accountabilityPlan.body}
            />

            <View style={styles.commitmentChecklist}>
              {[
                'Keep circles small: one to three people is enough.',
                'Start with one checkpoint the whole group understands.',
                'Keep miss sharing opt-in so pressure stays useful.',
              ].map((step) => (
                <View
                  key={step}
                  style={[styles.commitmentStep, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                  <Text style={[styles.commitmentStepText, { color: colors.textSoft }]}>{step}</Text>
                </View>
              ))}
            </View>

            <AppButton label={accountabilityPlan.actionLabel} onPress={handleAccountabilityPlanAction} />
          </AppCard>

          {loadError ? (
            <StateCard
              actionLabel="Retry"
              description={loadError}
              onAction={() => {
                void loadCircles();
              }}
              title="Could not refresh circles"
              tone="danger"
            />
          ) : activeView === 'activity' ? (
            <>
              <AppCard elevated tone="canvas" style={styles.heroCard}>
                <View style={styles.heroHeader}>
                  <View style={styles.heroCopy}>
                    <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Overview</Text>
                    <Text style={[styles.heroTitle, { color: colors.text }]}>Accountability pulse</Text>
                    <Text style={[styles.heroBody, { color: colors.textSoft }]}>{activitySummary}</Text>
                  </View>
                  {isRefreshing ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <StatusPill
                      label={latestFeedItem ? 'Live' : 'Quiet'}
                      tone={latestFeedItem ? 'success' : 'default'}
                    />
                  )}
                </View>

                <View style={styles.metricGrid}>
                  <MetricTile colors={colors} helper="Active groups" label="Circles" value={`${circles.length}`} />
                  <MetricTile colors={colors} helper="People across groups" label="Members" value={`${totalMembers}`} />
                  <MetricTile
                    colors={colors}
                    helper="Best current streak"
                    label="Top streak"
                    value={`${leaderboard[0]?.bestStreak ?? 0}`}
                  />
                </View>

                {latestFeedItem ? (
                  <View style={[styles.activityStrip, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                    <View style={styles.activityStripCopy}>
                      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Latest proof</Text>
                      <Text numberOfLines={2} style={[styles.activityStripTitle, { color: colors.text }]}>
                        {formatActivityTitle(latestFeedItem)}
                      </Text>
                      <Text numberOfLines={2} style={[styles.activityStripMeta, { color: colors.textSoft }]}>
                        {formatActivityMeta(latestFeedItem)}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {topChallenge ? (
                  <View style={[styles.challengeStrip, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                    <View style={styles.challengeCopy}>
                      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Commitment</Text>
                      <Text style={[TextPresets.label, { color: colors.text }]}>{topChallenge.title}</Text>
                      <Text style={[styles.challengeMeta, { color: colors.textSoft }]}>{topChallenge.progressLabel}</Text>
                    </View>
                    <StatusPill
                      label={topChallenge.isCompleted ? 'Completed' : 'In progress'}
                      tone={topChallenge.isCompleted ? 'success' : 'primary'}
                    />
                  </View>
                ) : null}
              </AppCard>

              <AppCard elevated tone="canvas">
                <SectionHeader
                  kicker="Feed"
                  size="compact"
                  title="Follow-through feed"
                  description="The clears and misses that matter inside your circles."
                />

                <View style={styles.feedTools}>
                  <AppInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    containerStyle={styles.feedSearchWrap}
                    inputStyle={styles.feedSearchInput}
                    onChangeText={setFeedSearchQuery}
                    placeholder="Search checkpoints, members, or circles"
                    returnKeyType="search"
                    value={feedSearchQuery}
                  />

                  <View style={styles.feedFilterRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedFeedCircleId === ALL_CIRCLES_FILTER }}
                      onPress={() => setSelectedFeedCircleId(ALL_CIRCLES_FILTER)}
                      style={[
                        styles.feedFilterChip,
                        {
                          backgroundColor:
                            selectedFeedCircleId === ALL_CIRCLES_FILTER ? colors.primarySurface : colors.elevated,
                          borderColor: selectedFeedCircleId === ALL_CIRCLES_FILTER ? colors.primary : colors.line,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.feedFilterText,
                          { color: selectedFeedCircleId === ALL_CIRCLES_FILTER ? colors.primary : colors.textSoft },
                        ]}>
                        All circles
                      </Text>
                    </Pressable>

                    {circles.map((circle) => {
                      const isSelected = selectedFeedCircleId === circle.id;

                      return (
                        <Pressable
                          key={circle.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => setSelectedFeedCircleId(circle.id)}
                          style={[
                            styles.feedFilterChip,
                            {
                              backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                              borderColor: isSelected ? colors.primary : colors.line,
                            },
                          ]}>
                          <Text style={[styles.feedFilterText, { color: isSelected ? colors.primary : colors.textSoft }]}>
                            {circle.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.feedSummary, { color: colors.muted }]}>{feedSummary}</Text>
                </View>

                {filteredFeed.length === 0 ? (
                  <EmptyState
                    description={
                      isFilteringFeed
                        ? 'Try a different circle filter or search term.'
                        : 'Shared clears and misses appear here once someone in your circles protects or misses a checkpoint.'
                    }
                    title={isFilteringFeed ? 'No matching activity' : 'No accountability signals yet'}
                    variant="inline"
                  />
                ) : (
                  <View style={styles.feedList}>
                    {filteredFeed.map((item) => (
                      <View
                        key={item.id}
                        style={[
                          styles.feedRow,
                          {
                            backgroundColor: colors.elevated,
                            borderColor:
                              item.outcome === 'confirmed'
                                ? withAlpha(colors.success, '30')
                                : withAlpha(colors.danger, '30'),
                          },
                        ]}>
                        <View style={styles.feedHeader}>
                          <View style={styles.feedCopy}>
                            <Text style={[TextPresets.label, { color: colors.text }]}>
                              {item.isOwnEvent ? 'You' : item.actorDisplayName}
                            </Text>
                            <Text numberOfLines={1} style={[styles.feedContext, { color: colors.muted }]}>
                              @{item.actorHandle} in {item.circleName}
                            </Text>
                          </View>
                          <StatusPill
                            label={item.outcome === 'confirmed' ? 'Cleared' : 'Missed'}
                            tone={item.outcome === 'confirmed' ? 'success' : 'danger'}
                          />
                        </View>
                        <Text numberOfLines={1} style={[styles.feedTitle, { color: colors.text }]}>
                          {item.alarmLabel}
                        </Text>
                        <Text numberOfLines={2} style={[styles.feedMeta, { color: colors.textSoft }]}>
                          {formatFeedInsight(item)} · {formatSocialTimestamp(item.resolvedAt)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {isLoadingMoreFeed ? (
                  <View style={styles.feedFooter}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : hasMoreFeed ? (
                  <View style={styles.feedFooter}>
                    <Text style={[styles.feedFooterText, { color: colors.muted }]}>Scroll to load more activity</Text>
                  </View>
                ) : feed.length > 0 ? (
                  <View style={styles.feedFooter}>
                    <Text style={[styles.feedFooterText, { color: colors.muted }]}>You are caught up</Text>
                  </View>
                ) : null}
              </AppCard>
            </>
          ) : (
            <>
              <AppCard elevated tone="canvas">
                <SectionHeader
                  kicker="Manage"
                  size="compact"
                  title="Start or join a small group"
                  description="One or two reliable people is enough."
                />

                <View style={styles.quickActions}>
                  <View style={[styles.actionPanel, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                    <View style={styles.panelCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Create a circle</Text>
                      <Text style={[styles.panelDescription, { color: colors.textSoft }]}>
                        Start small. One or two people who would notice a miss is enough.
                      </Text>
                    </View>
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
                      placeholder="People who will notice missed weekday checkpoints."
                      value={circleDescription}
                    />
                    <AppButton
                      disabled={isSubmitting}
                      label={isSubmitting ? 'Working...' : 'Create circle'}
                      onPress={handleCreateCircle}
                    />
                  </View>

                  <View style={[styles.actionPanel, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                    <View style={styles.panelCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Join with an invite code</Text>
                      <Text style={[styles.panelDescription, { color: colors.textSoft }]}>
                        {profile?.handle
                          ? `You will join as @${profile.handle}, then you can attach one checkpoint to this circle.`
                          : 'Join another accountability circle from a shared code.'}
                      </Text>
                    </View>
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
                  </View>
                </View>

                {screenMessage ? (
                  <View style={[styles.messageBanner, { backgroundColor: colors.successSurface, borderColor: withAlpha(colors.success, '2E') }]}>
                    <Text style={[styles.messageText, { color: colors.success }]}>{screenMessage}</Text>
                  </View>
                ) : null}
              </AppCard>

              <AppCard elevated>
                <SectionHeader
                  action={isRefreshing ? <ActivityIndicator color={colors.primary} /> : undefined}
                  kicker="Your circles"
                  size="compact"
                  title="Groups, invites, and next moves"
                  description="Everything a small accountability group needs to stay useful."
                />

                {circles.length === 0 ? (
                  <EmptyState
                    description="Create your first circle or join one. Small groups work best when they stay focused on one real commitment."
                    title="No circles yet"
                  />
                ) : (
                  <View style={styles.circleList}>
                    {circles.map((circle) => (
                      <View
                        key={circle.id}
                        style={[styles.circleRow, { backgroundColor: colors.canvas, borderColor: colors.line }]}>
                        <View style={styles.circleHeader}>
                          <View style={styles.circleCopy}>
                            <Text style={[TextPresets.label, { color: colors.text }]}>{circle.name}</Text>
                            <Text numberOfLines={2} style={[styles.circleDescription, { color: colors.textSoft }]}>
                              {circle.description || 'Shared accountability circle.'}
                            </Text>
                          </View>
                          <StatusPill label={circle.myRole === 'owner' ? 'Owner' : 'Member'} tone="primary" />
                        </View>

                        <View style={styles.circleMeta}>
                          <Text style={[styles.circleMetaText, { color: colors.textSoft }]}>{formatMemberCount(circle.memberCount)}</Text>
                          <Text style={[styles.circleMetaText, { color: colors.muted }]}>Code {circle.inviteCode}</Text>
                        </View>

                        <View style={[styles.commitmentHint, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                          <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next move</Text>
                          <Text style={[styles.commitmentHintText, { color: colors.textSoft }]}>
                            {getCircleCommitmentHint(circle, feedByCircleId[circle.id] ?? [])}
                          </Text>
                        </View>

                        <View style={styles.circleActions}>
                          <AppButton
                            label="Share invite"
                            onPress={() => {
                              void handleShareCircle(circle);
                            }}
                            size="compact"
                            style={styles.actionFill}
                            variant="secondary"
                          />
                          <AppButton
                            label="Copy link"
                            onPress={() => {
                              void handleCopyInviteLink(circle);
                            }}
                            size="compact"
                            style={styles.actionFill}
                            variant="ghost"
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </AppCard>
            </>
          )}
        </>
      )}
    </AppScreen>
  );
}

function MetricTile({
  label,
  value,
  helper,
  colors,
}: {
  label: string;
  value: string;
  helper: string;
  colors: ReturnType<typeof getAppColors>;
}) {
  return (
    <View style={[styles.metricTile, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.metricHelper, { color: colors.muted }]}>{helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: Spacing.lg,
  },
  segmentedControl: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  accountabilityCard: {
    gap: Spacing.md,
  },
  commitmentChecklist: {
    gap: Spacing.sm,
  },
  commitmentStep: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  commitmentStepText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  heroCard: {
    gap: Spacing.md,
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '800',
    lineHeight: 32,
  },
  heroBody: {
    ...TextPresets.body,
    fontSize: 15,
    lineHeight: 22,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  metricTile: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: 120,
    flexGrow: 1,
    gap: 2,
    minHeight: 78,
    padding: 14,
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  metricHelper: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  activityStrip: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 14,
  },
  activityStripCopy: {
    gap: 2,
  },
  activityStripTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  activityStripMeta: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  challengeStrip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
    padding: 14,
  },
  challengeCopy: {
    flex: 1,
    gap: 2,
  },
  challengeMeta: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedList: {
    gap: Spacing.sm,
  },
  feedTools: {
    gap: Spacing.sm,
  },
  feedSearchWrap: {
    gap: 0,
  },
  feedSearchInput: {
    minHeight: 46,
    paddingVertical: 12,
  },
  feedFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  feedFilterChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  feedFilterText: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  feedSummary: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  feedRow: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  feedHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  feedCopy: {
    flex: 1,
    gap: 2,
  },
  feedContext: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  feedMeta: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedFooter: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  feedFooterText: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  circleList: {
    gap: Spacing.sm,
  },
  circleRow: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: 14,
  },
  circleHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  circleCopy: {
    flex: 1,
    gap: 2,
  },
  circleDescription: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  circleMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  circleMetaText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  commitmentHint: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 2,
    padding: 12,
  },
  commitmentHintText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  circleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  actionFill: {
    flexBasis: 140,
    flexGrow: 1,
  },
  leaderboardList: {
    gap: Spacing.sm,
  },
  leaderboardRow: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
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
  quickActions: {
    gap: Spacing.md,
  },
  actionPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: 14,
  },
  panelCopy: {
    gap: 2,
  },
  panelDescription: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  messageBanner: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
