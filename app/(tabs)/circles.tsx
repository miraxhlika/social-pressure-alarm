import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  Alert,
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppIconButton } from '@/components/ui/app-icon-button';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowFooterButton,
  FlowIconBadge,
  FlowPanel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { SkeletonRefreshPill } from '@/components/ui/skeleton';
import { StateCard } from '@/components/ui/state-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  buildCircleInviteUrl,
  createSocialCircle,
  joinSocialCircleWithInviteCode,
  SOCIAL_CIRCLES_CACHE_MAX_AGE_MS,
  listMySocialCircles,
} from '@/lib/social/circles';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { sendCircleNudge } from '@/lib/social/push';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { SocialCircleSummary, SocialFeedItem } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { QueuedAlarmEvent } from '@/types/alarm';

type AppColors = ReturnType<typeof getAppColors>;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMemberCount(count: number) {
  return `${count} member${count === 1 ? '' : 's'}`;
}

function extractCircleInviteCode(value: string) {
  const trimmedValue = value.trim();
  const linkMatch = trimmedValue.match(/[?&]inviteCode=([^&#\s]+)/i);
  const messageMatch = trimmedValue.match(/invite\s+code:\s*([^\s]+)/i);
  const encodedCode = linkMatch?.[1] ?? messageMatch?.[1];

  if (!encodedCode) {
    return trimmedValue;
  }

  try {
    return decodeURIComponent(encodedCode).trim();
  } catch {
    return encodedCode.trim();
  }
}

type CircleActivityItem = {
  id: string;
  circleId: string;
  circleName: string;
  isPending: boolean;
  outcome: 'confirmed' | 'missed';
  person: string;
  checkpointLabel: string;
  resolvedAt: string;
  canSendNudge: boolean;
};

function formatActivityTime(timestamp: string) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Just now';
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (elapsedSeconds < 60) {
    return 'Just now';
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function shouldShowQueuedEvent(event: QueuedAlarmEvent) {
  return Boolean(
    event.socialSettings?.circleId &&
      ((event.outcome === 'confirmed' && event.socialSettings.shareSuccesses) ||
        (event.outcome === 'missed' && event.socialSettings.shareMisses))
  );
}

function buildCircleActivityFeed(
  remoteItems: SocialFeedItem[],
  queuedEvents: QueuedAlarmEvent[],
  circles: SocialCircleSummary[]
) {
  const circleNameById = new Map(circles.map((circle) => [circle.id, circle.name]));
  const queuedItems: CircleActivityItem[] = queuedEvents
    .filter(shouldShowQueuedEvent)
    .map((event) => ({
      id: event.id,
      circleId: event.socialSettings?.circleId ?? '',
      circleName: circleNameById.get(event.socialSettings?.circleId ?? '') ?? 'Accountability circle',
      isPending: true,
      outcome: event.outcome,
      person: 'You',
      checkpointLabel: event.alarmLabel,
      resolvedAt: event.resolvedAt,
      canSendNudge: false,
    }));
  const queuedIds = new Set(queuedItems.map((item) => item.id));
  const deliveredItems: CircleActivityItem[] = remoteItems
    .filter((item) => !queuedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      circleId: item.circleId,
      circleName: item.circleName,
      isPending: false,
      outcome: item.outcome,
      person: item.isOwnEvent ? 'You' : item.actorDisplayName,
      checkpointLabel: item.alarmLabel,
      resolvedAt: item.resolvedAt,
      canSendNudge: item.outcome === 'missed' && !item.isOwnEvent,
    }));

  return [...queuedItems, ...deliveredItems]
    .sort((left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime());
}

const COPY_FEEDBACK_MS = 2200;
const ACTIVITY_FETCH_SIZE = 50;
const ACTIVITY_VISIBLE_STEP = 20;
const SHEET_OPEN_DURATION_MS = 300;
const SHEET_CLOSE_DURATION_MS = 220;
const CIRCLES_SCREEN_REFRESH_MAX_AGE_MS = 60_000;

type LoadCirclesOptions = {
  force?: boolean;
  showRefreshing?: boolean;
};

export default function CirclesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteCode?: string }>();
  const colors = getAppColors(useColorScheme());
  const { configured, isLoading, isProfileComplete, isProfileLoading, user } = useSocialSession();
  const loadCirclesRequestRef = useRef(0);
  const lastLoadedUserRef = useRef<string | null>(null);
  const lastLoadedAtRef = useRef(0);
  const [circles, setCircles] = useState<SocialCircleSummary[]>([]);
  const [activityItems, setActivityItems] = useState<CircleActivityItem[]>([]);
  const [circleName, setCircleName] = useState('');
  const [circleDescription, setCircleDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [hasLoadedCircles, setHasLoadedCircles] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isCircleSheetMounted, setIsCircleSheetMounted] = useState(false);
  const [isCircleSheetVisible, setIsCircleSheetVisible] = useState(false);
  const [circleSheetMode, setCircleSheetMode] = useState<'create' | 'join'>('create');
  const [copiedCircleId, setCopiedCircleId] = useState<string | null>(null);
  const [selectedActivityCircleId, setSelectedActivityCircleId] = useState<'all' | string>('all');
  const [remoteActivityCount, setRemoteActivityCount] = useState(0);
  const [hasOlderActivity, setHasOlderActivity] = useState(false);
  const [isLoadingOlderActivity, setIsLoadingOlderActivity] = useState(false);
  const [visibleActivityLimit, setVisibleActivityLimit] = useState(ACTIVITY_VISIBLE_STEP);
  const [nudgingEventId, setNudgingEventId] = useState<string | null>(null);
  const [nudgedEventIds, setNudgedEventIds] = useState<Set<string>>(() => new Set());
  const circleSheetAnimation = useRef(new Animated.Value(0)).current;
  const circleSheetKeyboardOffset = useRef(new Animated.Value(0)).current;
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCircles = useCallback(async (options: LoadCirclesOptions = {}) => {
    const requestId = loadCirclesRequestRef.current + 1;
    loadCirclesRequestRef.current = requestId;

    if (!configured || !user?.id) {
      setCircles([]);
      setActivityItems([]);
      setRemoteActivityCount(0);
      setHasOlderActivity(false);
      setHasLoadedCircles(false);
      setIsRefreshing(false);
      setLoadError('');
      lastLoadedUserRef.current = null;
      lastLoadedAtRef.current = 0;
      return;
    }

    if (!isProfileComplete) {
      if (lastLoadedUserRef.current !== user.id && !isProfileLoading) {
        setCircles([]);
        setActivityItems([]);
        setHasLoadedCircles(false);
      }

      setIsRefreshing(false);
      setLoadError('');
      return;
    }

    const hasRecentScreenData =
      hasLoadedCircles &&
      lastLoadedUserRef.current === user.id &&
      Date.now() - lastLoadedAtRef.current < CIRCLES_SCREEN_REFRESH_MAX_AGE_MS;

    if (!options.force && hasRecentScreenData) {
      return;
    }

    const shouldShowRefreshing = options.showRefreshing ?? !hasLoadedCircles;

    if (shouldShowRefreshing) {
      setIsRefreshing(true);
    }

    setLoadError('');

    try {
      const [nextCircles, nextFeed, queueSummary] = await Promise.all([
        listMySocialCircles({
          force: options.force,
          maxAgeMs: SOCIAL_CIRCLES_CACHE_MAX_AGE_MS,
        }),
        listVisibleSocialFeed({ limitCount: ACTIVITY_FETCH_SIZE }).catch(() => []),
        getSocialQueueSummary().catch(() => ({ queuedEvents: [] })),
      ]);

      if (loadCirclesRequestRef.current === requestId) {
        setCircles(nextCircles);
        setActivityItems(buildCircleActivityFeed(nextFeed, queueSummary.queuedEvents, nextCircles));
        setRemoteActivityCount(nextFeed.length);
        setHasOlderActivity(nextFeed.length === ACTIVITY_FETCH_SIZE);
        setVisibleActivityLimit(ACTIVITY_VISIBLE_STEP);
        setHasLoadedCircles(true);
        lastLoadedUserRef.current = user.id;
        lastLoadedAtRef.current = Date.now();
      }
    } catch (error) {
      if (loadCirclesRequestRef.current === requestId) {
        setLoadError(getErrorMessage(error, 'The latest circles could not be loaded.'));
        setHasLoadedCircles(true);
      }
    } finally {
      if (loadCirclesRequestRef.current === requestId) {
        setIsRefreshing(false);
      }
    }
  }, [configured, hasLoadedCircles, isProfileComplete, isProfileLoading, user?.id]);

  useEffect(() => {
    if (typeof params.inviteCode === 'string' && params.inviteCode.trim()) {
      setInviteCode(params.inviteCode.trim());
      setCircleSheetMode('join');
      setIsCircleSheetVisible(true);
    }
  }, [params.inviteCode]);

  useEffect(() => {
    if (isCircleSheetVisible) {
      setIsCircleSheetMounted(true);
    }
  }, [isCircleSheetVisible]);

  useEffect(() => {
    if (!isCircleSheetMounted) {
      return;
    }

    Animated.timing(circleSheetAnimation, {
      duration: isCircleSheetVisible ? SHEET_OPEN_DURATION_MS : SHEET_CLOSE_DURATION_MS,
      easing: isCircleSheetVisible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      toValue: isCircleSheetVisible ? 1 : 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !isCircleSheetVisible) {
        setIsCircleSheetMounted(false);
      }
    });
  }, [circleSheetAnimation, isCircleSheetMounted, isCircleSheetVisible]);

  useEffect(() => {
    const keyboardShowEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const keyboardHideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(keyboardShowEvent, (event) => {
      Animated.timing(circleSheetKeyboardOffset, {
        duration: event.duration ?? 260,
        easing: Easing.out(Easing.cubic),
        toValue: event.endCoordinates.height,
        useNativeDriver: false,
      }).start();
    });
    const hideSubscription = Keyboard.addListener(keyboardHideEvent, (event) => {
      Animated.timing(circleSheetKeyboardOffset, {
        duration: event.duration ?? 220,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [circleSheetKeyboardOffset]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCircles();
    }, [loadCircles])
  );

  const closeCircleSheet = useCallback(() => {
    Keyboard.dismiss();
    setIsCircleSheetVisible(false);
  }, []);

  const openCircleSheet = useCallback(() => {
    setCircleSheetMode(circles.length === 0 ? 'create' : 'join');
    setIsCircleSheetVisible(true);
  }, [circles.length]);

  const handleCreateCircle = async () => {
    if (!circleName.trim()) {
      Alert.alert('Circle name required', 'Give your accountability circle a name first.');
      return;
    }

    setIsSubmitting(true);

    try {
      const createdCircle = await createSocialCircle({
        name: circleName,
        description: circleDescription,
      });

      setCircleName('');
      setCircleDescription('');
      setCircles((currentCircles) => {
        const withoutCreatedCircle = currentCircles.filter((circle) => circle.id !== createdCircle.id);
        return [...withoutCreatedCircle, createdCircle].sort((left, right) => left.name.localeCompare(right.name));
      });
      await loadCircles({ force: true });
      closeCircleSheet();
    } catch (error) {
      Alert.alert('Unable to create circle', getErrorMessage(error, 'The circle could not be created right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinCircle = async () => {
    const normalizedInviteCode = extractCircleInviteCode(inviteCode);

    if (!normalizedInviteCode) {
      Alert.alert('Invite required', 'Paste the invite link or code you received.');
      return;
    }

    setIsSubmitting(true);

    try {
      const joinedCircle = await joinSocialCircleWithInviteCode(normalizedInviteCode);
      await trackAnalyticsEvent('invite_accepted', {
        circleId: joinedCircle.id,
      });
      setInviteCode(joinedCircle.inviteCode);
      setCircles((currentCircles) => {
        const withoutJoinedCircle = currentCircles.filter((circle) => circle.id !== joinedCircle.id);
        return [...withoutJoinedCircle, joinedCircle].sort((left, right) => left.name.localeCompare(right.name));
      });
      await loadCircles({ force: true });
      closeCircleSheet();
    } catch (error) {
      Alert.alert('Unable to join circle', getErrorMessage(error, 'The invite code could not be used right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasteInvite = async () => {
    const clipboardValue = await Clipboard.getStringAsync();

    if (!clipboardValue.trim()) {
      Alert.alert('Nothing to paste', 'Copy an invite link or code first.');
      return;
    }

    setInviteCode(clipboardValue.trim());
  };

  const handleShareCircle = async (circle: SocialCircleSummary) => {
    try {
      const inviteUrl = buildCircleInviteUrl(circle.inviteCode);
      await Share.share({
        message: `Join my accountability circle "${circle.name}".\n\nTap to join:\n${inviteUrl}\n\nIf the link does not open, use invite code: ${circle.inviteCode}`,
      });
      await trackAnalyticsEvent('invite_sent', {
        circleId: circle.id,
      });
    } catch (error) {
      Alert.alert('Unable to share invite', getErrorMessage(error, 'The invite link could not be shared.'));
    }
  };

  const handleCopyInviteCode = async (circle: SocialCircleSummary) => {
    try {
      await Clipboard.setStringAsync(circle.inviteCode);
      setCopiedCircleId(circle.id);

      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedCircleId(null);
      }, COPY_FEEDBACK_MS);
    } catch (error) {
      Alert.alert('Unable to copy', getErrorMessage(error, 'The invite code could not be copied.'));
    }
  };

  const handleSendNudge = async (item: CircleActivityItem) => {
    if (!item.canSendNudge) {
      return;
    }

    setNudgingEventId(item.id);

    try {
      const result = await sendCircleNudge(item.id);
      setNudgedEventIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.add(item.id);
        return nextIds;
      });
      Alert.alert(
        result.duplicate ? 'Nudge already sent' : 'Nudge sent',
        `${item.person} will get a short check-in.`
      );
    } catch (error) {
      Alert.alert('Unable to send nudge', getErrorMessage(error, 'The nudge could not be sent right now.'));
    } finally {
      setNudgingEventId(null);
    }
  };

  const handleLoadOlderActivity = async () => {
    if (isLoadingOlderActivity) {
      return;
    }

    if (filteredActivityItems.length > visibleActivityLimit) {
      setVisibleActivityLimit((currentLimit) => currentLimit + ACTIVITY_VISIBLE_STEP);
      return;
    }

    if (!hasOlderActivity) {
      return;
    }

    setIsLoadingOlderActivity(true);

    try {
      const nextFeed = await listVisibleSocialFeed({
        limitCount: ACTIVITY_FETCH_SIZE,
        offsetCount: remoteActivityCount,
      });
      const olderItems = buildCircleActivityFeed(nextFeed, [], circles);

      setActivityItems((currentItems) => {
        const itemsById = new Map(currentItems.map((item) => [item.id, item]));

        olderItems.forEach((item) => itemsById.set(item.id, item));

        return [...itemsById.values()].sort(
          (left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime()
        );
      });
      setRemoteActivityCount((currentCount) => currentCount + nextFeed.length);
      setHasOlderActivity(nextFeed.length === ACTIVITY_FETCH_SIZE);
      setVisibleActivityLimit((currentLimit) => currentLimit + ACTIVITY_VISIBLE_STEP);
    } catch (error) {
      Alert.alert('Unable to load older activity', getErrorMessage(error, 'Try again in a moment.'));
    } finally {
      setIsLoadingOlderActivity(false);
    }
  };

  const circleSheetTranslateY = circleSheetAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [96, 0],
  });
  const circleSheetScale = circleSheetAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
  });
  const filteredActivityItems = useMemo(() => {
    if (selectedActivityCircleId !== 'all') {
      return activityItems.filter((item) => item.circleId === selectedActivityCircleId);
    }

    return activityItems;
  }, [activityItems, selectedActivityCircleId]);
  const displayedActivityItems = filteredActivityItems.slice(0, visibleActivityLimit);
  const canLoadOlderActivity = filteredActivityItems.length > visibleActivityLimit || hasOlderActivity;
  return (
    <AppScreen
      backgroundColor={colors.elevated}
      contentStyle={styles.screenContent}
      footer={
        !configured || isLoading || !user || !isProfileComplete ? null : (
          <View style={styles.createCtaFooter}>
            <FlowFooterButton
              label="Create or join a circle"
              onPress={openCircleSheet}
            />
          </View>
        )
      }>
      <FlowTopBar
        subtitle="Small groups, real accountability."
        title="Circles"
      />

      {!configured ? (
        <StateCard
          actionLabel="Go to Today"
          description="Local checkpoints still work on this device. Circles are optional and are not available in this build yet."
          onAction={() => router.push('/')}
          title="Circles are optional"
        />
      ) : isLoading ? (
        <LoadingBlock description="Loading your account session for circles." layout="list" title="Loading circles" />
      ) : !user ? (
        <EmptyState
          actionLabel="Go to account"
          description="Sign in if you want durable invites and small-group accountability."
          eyebrow="Circles"
          icon="people-outline"
          onAction={() => router.push('/account')}
          title="Sign in first"
          tone="primary"
        />
      ) : isProfileLoading ? (
        <LoadingBlock description="Checking your profile before loading circles." layout="compact" title="Loading circles" />
      ) : !isProfileComplete ? (
        <StateCard
          actionLabel="Complete profile"
          description="Save your display name and handle first."
          onAction={() => router.push('/account')}
          title="Finish your profile"
        />
      ) : (
        <>
          {loadError ? (
            <StateCard
              actionLabel="Retry"
              description={loadError}
              onAction={() => {
                void loadCircles({ force: true, showRefreshing: true });
              }}
              title="Could not refresh circles"
              tone="danger"
            />
          ) : null}

          {!loadError && !hasLoadedCircles && isRefreshing ? (
            <LoadingBlock description="Pulling in your circles and recent activity." layout="list" title="Loading circles" />
          ) : null}

          {!loadError && hasLoadedCircles && circles.length === 0 ? (
            <EmptyState
              actionLabel="Create or join circle"
              description="Start a small accountability circle or join one with an invite code when you want someone to notice your progress."
              eyebrow="Circles"
              icon="people-outline"
              onAction={openCircleSheet}
              title="No circles yet"
              tone="primary"
            />
          ) : null}

          {!loadError && circles.length > 0 ? (
            <View style={styles.screenSection}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your circles</Text>
                <View style={styles.sectionHeaderActions}>
                  {isRefreshing ? (
                    <SkeletonRefreshPill width={48} />
                  ) : (
                    <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
                      {circles.length} {circles.length === 1 ? 'circle' : 'circles'}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.circleCards}>
                {circles.map((circle) => {
                  const isCopied = copiedCircleId === circle.id;

                  return (
                    <FlowPanel key={circle.id} style={styles.circleCard}>
                      <View style={styles.circleHeader}>
                        <View style={[styles.circleAvatar, { backgroundColor: colors.primarySurface }]}>
                          <Ionicons color={colors.primary} name="people-outline" size={18} />
                        </View>
                        <View style={styles.circleCopy}>
                          <Text style={[styles.circleTitle, { color: colors.text }]}>{circle.name}</Text>
                          <Text numberOfLines={1} style={[styles.circleDescription, { color: colors.textSoft }]}>
                            {formatMemberCount(circle.memberCount)}
                          </Text>
                        </View>
                        <StatusPill label={circle.myRole === 'owner' ? 'Owner' : 'Member'} tone="default" />
                      </View>

                      <View style={styles.circleActions}>
                        <Pressable
                          accessibilityLabel={`Share invite for ${circle.name}`}
                          accessibilityRole="button"
                          onPress={() => {
                            void handleShareCircle(circle);
                          }}
                          style={({ pressed }) => [
                            styles.circleAction,
                            {
                              backgroundColor: colors.primarySurface,
                              borderColor: colors.primary,
                            },
                            pressed && styles.pressed,
                          ]}>
                          <Ionicons color={colors.primary} name="person-add-outline" size={17} />
                          <Text style={[styles.circleActionLabel, { color: colors.primary }]}>Invite</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={isCopied ? 'Invite code copied' : `Copy invite code for ${circle.name}`}
                          accessibilityRole="button"
                          onPress={() => {
                            void handleCopyInviteCode(circle);
                          }}
                          style={({ pressed }) => [
                            styles.circleAction,
                            {
                              backgroundColor: isCopied ? colors.successSurface : colors.panelMuted,
                              borderColor: isCopied ? colors.success : colors.line,
                            },
                            pressed && styles.pressed,
                          ]}>
                          <Ionicons
                            color={isCopied ? colors.success : colors.textSoft}
                            name={isCopied ? 'checkmark' : 'copy-outline'}
                            size={17}
                          />
                          <Text style={[styles.circleActionLabel, { color: isCopied ? colors.success : colors.textSoft }]}>
                            {isCopied ? 'Copied' : 'Copy code'}
                          </Text>
                        </Pressable>
                      </View>
                    </FlowPanel>
                  );
                })}
              </View>
            </View>
          ) : null}

          {!loadError && circles.length > 0 ? (
            <View style={styles.screenSection}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent activity</Text>
                {isRefreshing ? (
                  <SkeletonRefreshPill width={58} />
                ) : (
                  <Text style={[styles.sectionCount, { color: colors.textSoft }]}>
                    {hasOlderActivity
                      ? 'More available'
                      : `${filteredActivityItems.length} ${filteredActivityItems.length === 1 ? 'update' : 'updates'}`}
                  </Text>
                )}
              </View>

              {activityItems.length > 0 ? (
                <ScrollView
                  contentContainerStyle={styles.activityFilters}
                  horizontal
                  showsHorizontalScrollIndicator={false}>
                  <ActivityFilterChip
                    label="All"
                    onPress={() => {
                      setSelectedActivityCircleId('all');
                      setVisibleActivityLimit(ACTIVITY_VISIBLE_STEP);
                    }}
                    selected={selectedActivityCircleId === 'all'}
                  />
                  {circles.map((circle) => (
                    <ActivityFilterChip
                      key={circle.id}
                      label={circle.name}
                      onPress={() => {
                        setSelectedActivityCircleId(circle.id);
                        setVisibleActivityLimit(ACTIVITY_VISIBLE_STEP);
                      }}
                      selected={selectedActivityCircleId === circle.id}
                    />
                  ))}
                </ScrollView>
              ) : null}

              {isRefreshing && activityItems.length === 0 ? (
                <LoadingBlock
                  description="Checking for shared clears and misses."
                  layout="compact"
                  title="Loading activity"
                  variant="inline"
                />
              ) : displayedActivityItems.length > 0 ? (
                <>
                  <FlowPanel style={styles.activityPanel}>
                    {displayedActivityItems.map((item, index) => (
                      <View
                        key={item.id}
                        style={[
                          styles.activityRowWrap,
                          index < displayedActivityItems.length - 1 && {
                            borderBottomColor: colors.line,
                            borderBottomWidth: 1,
                          },
                        ]}>
                        <CircleActivityRow
                          colors={colors}
                          hasNudged={nudgedEventIds.has(item.id)}
                          isNudging={nudgingEventId === item.id}
                          item={item}
                          onSendNudge={handleSendNudge}
                          showCircleName
                        />
                      </View>
                    ))}
                  </FlowPanel>
                  {canLoadOlderActivity ? (
                    <AppButton
                      disabled={isLoadingOlderActivity}
                      label={isLoadingOlderActivity ? 'Loading...' : 'Load older activity'}
                      onPress={() => {
                        void handleLoadOlderActivity();
                      }}
                      size="compact"
                      style={styles.loadOlderButton}
                      variant="ghost"
                    />
                  ) : null}
                </>
              ) : (
                <View style={styles.emptyActivityState}>
                  <Text style={[TextPresets.body, styles.emptyActivityText, { color: colors.textSoft }]}>
                    {activityItems.length > 0
                      ? 'No activity for this circle in the loaded updates.'
                      : 'Shared clears and misses will appear here after a circle checkpoint runs.'}
                  </Text>
                  {canLoadOlderActivity ? (
                    <AppButton
                      disabled={isLoadingOlderActivity}
                      label={isLoadingOlderActivity ? 'Loading...' : 'Look further back'}
                      onPress={() => {
                        void handleLoadOlderActivity();
                      }}
                      size="compact"
                      variant="ghost"
                    />
                  ) : null}
                </View>
              )}
            </View>
          ) : null}
        </>
      )}
      <Modal
        animationType="none"
        onRequestClose={closeCircleSheet}
        transparent
        visible={isCircleSheetMounted}>
        <View style={styles.sheetOverlay}>
          <Animated.View style={[styles.sheetBackdrop, { opacity: circleSheetAnimation }]}>
            <Pressable
              accessibilityLabel="Close circle form"
              accessibilityRole="button"
              onPress={closeCircleSheet}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.sheetStack,
              {
                opacity: circleSheetAnimation,
                transform: [{ translateY: circleSheetTranslateY }],
              },
            ]}>
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.elevated,
                  borderColor: colors.line,
                  transform: [{ scale: circleSheetScale }],
                },
              ]}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <View style={styles.sheetTitleWrap}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>Add a circle</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textSoft }]}>
                    Create a group or use an invite link.
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close circle form"
                  accessibilityRole="button"
                  onPress={closeCircleSheet}
                  style={({ pressed }) => [styles.sheetCloseButton, pressed ? styles.pressed : null]}>
                  <Ionicons color={colors.textSoft} name="close" size={18} />
                </Pressable>
              </View>

              <View style={[styles.sheetModePicker, { backgroundColor: colors.panelMuted }]}>
                {(['create', 'join'] as const).map((mode) => {
                  const isSelected = circleSheetMode === mode;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={mode}
                      onPress={() => setCircleSheetMode(mode)}
                      style={[
                        styles.sheetModeButton,
                        { backgroundColor: isSelected ? colors.elevated : 'transparent' },
                      ]}>
                      <Text style={[styles.sheetModeLabel, { color: isSelected ? colors.text : colors.textSoft }]}>
                        {mode === 'create' ? 'Create new' : 'Join a circle'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {circleSheetMode === 'create' ? (
                <View style={styles.sheetForm}>
                  <AppInput
                    autoCapitalize="words"
                    inputStyle={styles.sheetInput}
                    label="Circle name"
                    onChangeText={setCircleName}
                    placeholder="Morning crew"
                    value={circleName}
                  />
                  <AppInput
                    inputStyle={[styles.sheetInput, styles.sheetMultilineInput]}
                    label="Description"
                    multiline
                    onChangeText={setCircleDescription}
                    placeholder="Optional"
                    value={circleDescription}
                  />
                  <AppButton
                    disabled={isSubmitting}
                    label={isSubmitting ? 'Working...' : 'Create circle'}
                    onPress={handleCreateCircle}
                    style={styles.sheetButton}
                  />
                </View>
              ) : (
                <View style={styles.sheetForm}>
                  <AppInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputStyle={styles.sheetInput}
                    label="Invite link or code"
                    onChangeText={setInviteCode}
                    placeholder="Paste your invite"
                    value={inviteCode}
                  />
                  {!inviteCode.trim() ? (
                    <AppIconButton
                      accessibilityLabel="Paste invite code from clipboard"
                      icon="clipboard-outline"
                      onPress={() => {
                        void handlePasteInvite();
                      }}
                      size="compact"
                      style={styles.pasteAction}
                      variant="ghost"
                    />
                  ) : null}
                  <AppButton
                    disabled={isSubmitting}
                    label={isSubmitting ? 'Working...' : 'Join circle'}
                    onPress={handleJoinCircle}
                    style={styles.sheetButton}
                  />
                </View>
              )}
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.sheetKeyboardFill,
                {
                  backgroundColor: colors.elevated,
                  height: circleSheetKeyboardOffset,
                },
              ]}
            />
          </Animated.View>
        </View>
      </Modal>
    </AppScreen>
  );
}

function ActivityFilterChip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.activityFilterChip,
        {
          backgroundColor: selected ? colors.text : colors.panelMuted,
        },
        pressed && styles.pressed,
      ]}>
      <Text
        numberOfLines={1}
        style={[styles.activityFilterLabel, { color: selected ? colors.elevated : colors.textSoft }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CircleActivityRow({
  colors,
  hasNudged,
  isNudging,
  item,
  onSendNudge,
  showCircleName,
}: {
  colors: AppColors;
  hasNudged: boolean;
  isNudging: boolean;
  item: CircleActivityItem;
  onSendNudge: (item: CircleActivityItem) => void;
  showCircleName: boolean;
}) {
  return (
    <View style={styles.activityItem}>
      <FlowIconBadge
        icon={item.outcome === 'confirmed' ? 'checkmark' : 'alert'}
        size="small"
        tone={item.outcome === 'confirmed' ? 'success' : 'danger'}
      />
      <View style={styles.activityCopy}>
        <Text style={styles.activityTitle}>
          <Text style={[styles.activityPerson, { color: colors.primary }]}>{item.person}</Text>
          <Text style={[styles.activityAction, { color: colors.textSoft }]}>
            {item.outcome === 'confirmed' ? ' cleared ' : ' missed '}
          </Text>
          <Text style={[styles.activityCheckpoint, { color: colors.text }]}>{item.checkpointLabel}</Text>
        </Text>
        <Text style={[styles.activityMeta, { color: colors.textSoft }]}>
          {showCircleName ? `${item.circleName} · ` : ''}
          {formatActivityTime(item.resolvedAt)}
          {item.isPending ? ' · Pending sync' : ''}
        </Text>
        {item.canSendNudge ? (
          <AppButton
            disabled={isNudging || hasNudged}
            label={hasNudged ? 'Nudge sent' : isNudging ? 'Sending...' : 'Send nudge'}
            onPress={() => {
              onSendNudge(item);
            }}
            size="compact"
            style={styles.nudgeAction}
            variant={hasNudged ? 'secondary' : 'ghost'}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: Spacing.xl,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  createCtaFooter: {
    marginBottom: 68,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  compactSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  screenSection: {
    gap: Spacing.md,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  sectionTitle: {
    ...TextPresets.label,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  sectionHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  sectionCount: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  circleCards: {
    gap: Spacing.md,
  },
  circleCard: {
    borderRadius: Radius.lg,
    gap: Spacing.lg,
    padding: Spacing.lg,
  },
  circleFlowItem: {
    gap: Spacing.sm,
    paddingHorizontal: 2,
    paddingTop: Spacing.xs,
  },
  circleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  circleAvatar: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  circleCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  circleTitle: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
  },
  circleDescription: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  circleActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  circleAction: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  circleActionLabel: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 16,
  },
  circleDivider: {
    height: 1,
    marginLeft: 42,
    marginTop: Spacing.sm,
  },
  actionFill: {
    flexBasis: 140,
    flexGrow: 1,
  },
  copiedButton: {
    borderColor: 'transparent',
  },
  activityList: {
    gap: Spacing.lg,
  },
  activityPanel: {
    gap: 0,
    paddingHorizontal: Spacing.md,
    paddingVertical: 0,
  },
  activityFilters: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  activityFilterChip: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: Spacing.md,
  },
  activityFilterLabel: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 150,
  },
  activityRowWrap: {
    paddingVertical: Spacing.md,
  },
  loadOlderButton: {
    alignSelf: 'center',
    minWidth: 190,
  },
  activityGroup: {
    gap: Spacing.lg,
  },
  activityGroupSection: {
    gap: Spacing.md,
  },
  activityGroupHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  activityGroupTitleWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  activityGroupTitle: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
  },
  activityGroupMeta: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  activityGroupCount: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 14,
  },
  activityGroupItems: {
    gap: Spacing.lg,
  },
  activityGroupDivider: {
    height: 1,
  },
  activityItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  activityCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  activityTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  activityPerson: {
    fontWeight: '800',
  },
  activityAction: {
    fontWeight: '600',
  },
  activityCheckpoint: {
    fontWeight: '800',
  },
  activityMeta: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  nudgeAction: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xs,
    minHeight: 34,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  emptyActivityText: {
    fontSize: 13,
    lineHeight: 19,
  },
  emptyActivityState: {
    gap: Spacing.md,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  sheetStack: {
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: Spacing.md,
    paddingBottom: 34,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  sheetKeyboardFill: {
    width: '100%',
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(142, 142, 147, 0.45)',
    borderRadius: Radius.pill,
    height: 4,
    width: 38,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitleWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sheetTitle: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 24,
  },
  sheetSubtitle: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  sheetCloseButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  sheetModePicker: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  sheetModeButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  sheetModeLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  sheetForm: {
    gap: Spacing.md,
  },
  pasteAction: {
    alignSelf: 'flex-end',
  },
  sheetInput: {
    borderRadius: 12,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  sheetMultilineInput: {
    minHeight: 82,
  },
  sheetButton: {
    borderRadius: 8,
    minHeight: 46,
  },
});
