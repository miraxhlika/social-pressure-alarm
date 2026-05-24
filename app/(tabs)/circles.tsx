import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowFooterButton,
  FlowIconBadge,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { StateCard } from '@/components/ui/state-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  buildCircleInviteUrl,
  createSocialCircle,
  joinSocialCircleWithInviteCode,
  listMySocialCircles,
} from '@/lib/social/circles';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { SocialCircleSummary, SocialFeedItem } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { QueuedAlarmEvent } from '@/types/alarm';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMemberCount(count: number) {
  return `${count} member${count === 1 ? '' : 's'}`;
}

type CircleActivityItem = {
  id: string;
  circleId: string;
  circleName: string;
  context: string;
  isPending: boolean;
  outcome: 'confirmed' | 'missed';
  person: string;
  checkpointLabel: string;
  resolvedAt: string;
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

function formatFeedContext(item: Pick<SocialFeedItem, 'outcome' | 'sharePayload'>) {
  const streakCopy = `${item.sharePayload.currentStreak}-clear streak`;

  if (item.outcome === 'confirmed') {
    const scanCopy =
      typeof item.sharePayload.timeToScanSeconds === 'number'
        ? `${item.sharePayload.timeToScanSeconds}s to clear`
        : 'Cleared on time';

    return `${scanCopy} · ${streakCopy}`;
  }

  return item.sharePayload.currentStreak > 0
    ? `${streakCopy} before this miss`
    : 'Miss recorded';
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
      context: formatFeedContext(event),
      isPending: true,
      outcome: event.outcome,
      person: 'You',
      checkpointLabel: event.alarmLabel,
      resolvedAt: event.resolvedAt,
    }));
  const queuedIds = new Set(queuedItems.map((item) => item.id));
  const deliveredItems: CircleActivityItem[] = remoteItems
    .filter((item) => !queuedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      circleId: item.circleId,
      circleName: item.circleName,
      context: formatFeedContext(item),
      isPending: false,
      outcome: item.outcome,
      person: item.isOwnEvent ? 'You' : item.actorDisplayName,
      checkpointLabel: item.alarmLabel,
      resolvedAt: item.resolvedAt,
    }));

  return [...queuedItems, ...deliveredItems]
    .sort((left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime())
    .slice(0, 8);
}

const COPY_FEEDBACK_MS = 2200;
const SHEET_OPEN_DURATION_MS = 300;
const SHEET_CLOSE_DURATION_MS = 220;

export default function CirclesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteCode?: string }>();
  const colors = getAppColors(useColorScheme());
  const { configured, isLoading, isProfileComplete, user } = useSocialSession();
  const loadCirclesRequestRef = useRef(0);
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
  const circleSheetAnimation = useRef(new Animated.Value(0)).current;
  const circleSheetKeyboardOffset = useRef(new Animated.Value(0)).current;
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCircles = useCallback(async () => {
    const requestId = loadCirclesRequestRef.current + 1;
    loadCirclesRequestRef.current = requestId;

    if (!configured || !user?.id || !isProfileComplete) {
      setCircles([]);
      setActivityItems([]);
      setHasLoadedCircles(false);
      setIsRefreshing(false);
      setLoadError('');
      return;
    }

    setIsRefreshing(true);
    setLoadError('');

    try {
      const nextCircles = await listMySocialCircles();
      const [nextFeed, queueSummary] = await Promise.all([
        listVisibleSocialFeed({ limitCount: 12 }).catch(() => []),
        getSocialQueueSummary().catch(() => ({ queuedEvents: [] })),
      ]);

      if (loadCirclesRequestRef.current === requestId) {
        setCircles(nextCircles);
        setActivityItems(buildCircleActivityFeed(nextFeed, queueSummary.queuedEvents, nextCircles));
        setHasLoadedCircles(true);
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
  }, [configured, isProfileComplete, user?.id]);

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
      await loadCircles();
      closeCircleSheet();
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
      await loadCircles();
      closeCircleSheet();
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
    try {
      await Clipboard.setStringAsync(buildCircleInviteUrl(circle.inviteCode));
      setCopiedCircleId(circle.id);

      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedCircleId(null);
      }, COPY_FEEDBACK_MS);
    } catch (error) {
      Alert.alert('Unable to copy', getErrorMessage(error, 'The invite link could not be copied.'));
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

  return (
    <AppScreen
      backgroundColor={colors.elevated}
      contentStyle={styles.screenContent}
      footer={
        !configured || isLoading || !user || !isProfileComplete ? null : (
          <View style={styles.createCtaFooter}>
            <FlowFooterButton
              label="Create or Join Circle"
              onPress={openCircleSheet}
            />
          </View>
        )
      }>
      <FlowTopBar
        subtitle="Private. Optional. Yours."
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
        <EmptyState
          actionLabel="Go to account"
          description="Sign in if you want durable invites and small-group accountability."
          eyebrow="Circles"
          icon="people-outline"
          onAction={() => router.push('/account')}
          title="Sign in first"
          tone="primary"
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
          ) : null}

          {!loadError && !hasLoadedCircles && isRefreshing ? (
            <LoadingBlock description="Pulling in your circles and recent activity." title="Loading circles" />
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
            <FlowPanel>
              <View style={styles.compactSectionHeader}>
                <FlowSectionLabel>YOUR CIRCLES</FlowSectionLabel>
                <View style={styles.sectionHeaderActions}>
                  {isRefreshing ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.sectionCount, { color: colors.textSoft }]}>{circles.length} total</Text>}
                </View>
              </View>

              <View style={styles.circleList}>
                {circles.map((circle, index) => {
                  const isCopied = copiedCircleId === circle.id;

                  return (
                    <View key={circle.id} style={styles.circleFlowItem}>
                      <View style={styles.circleHeader}>
                        <FlowIconBadge icon="people-outline" size="small" tone="muted" />
                        <View style={styles.circleCopy}>
                          <Text style={[TextPresets.label, { color: colors.text }]}>{circle.name}</Text>
                          <Text numberOfLines={1} style={[styles.circleDescription, { color: colors.textSoft }]}>
                            {formatMemberCount(circle.memberCount)} · Code {circle.inviteCode}
                          </Text>
                        </View>
                        <StatusPill label={circle.myRole === 'owner' ? 'Owner' : 'Member'} tone="primary" />
                      </View>

                      <View style={styles.circleActions}>
                        <AppButton
                          label="Share"
                          onPress={() => {
                            void handleShareCircle(circle);
                          }}
                          size="compact"
                          style={styles.actionFill}
                          variant="secondary"
                        />
                        <AppButton
                          label={isCopied ? 'Copied' : 'Copy link'}
                          onPress={() => {
                            void handleCopyInviteLink(circle);
                          }}
                          size="compact"
                          style={[styles.actionFill, isCopied ? styles.copiedButton : null]}
                          variant={isCopied ? 'secondary' : 'ghost'}
                        />
                      </View>
                      {index < circles.length - 1 ? <View style={[styles.circleDivider, { backgroundColor: colors.line }]} /> : null}
                    </View>
                  );
                })}
              </View>
            </FlowPanel>
          ) : null}

          {!loadError && circles.length > 0 ? (
            <FlowPanel>
              <View style={styles.compactSectionHeader}>
                <FlowSectionLabel>ACTIVITY</FlowSectionLabel>
                {isRefreshing ? <ActivityIndicator color={colors.primary} /> : null}
              </View>

              {isRefreshing && activityItems.length === 0 ? (
                <LoadingBlock
                  description="Checking for shared clears and misses."
                  title="Loading activity"
                  variant="inline"
                />
              ) : activityItems.length > 0 ? (
                <View style={styles.activityList}>
                  {activityItems.map((item) => (
                    <View key={item.id} style={styles.activityItem}>
                      <FlowIconBadge
                        icon={item.outcome === 'confirmed' ? 'checkmark' : 'alert'}
                        size="small"
                        tone={item.outcome === 'confirmed' ? 'success' : 'danger'}
                      />
                      <View style={styles.activityCopy}>
                        <Text style={[styles.activityTitle, { color: colors.text }]}>
                          {item.person} {item.outcome === 'confirmed' ? 'cleared' : 'missed'} {item.checkpointLabel}
                        </Text>
                        <Text style={[styles.activityMeta, { color: colors.textSoft }]}>
                          {item.circleName} · {formatActivityTime(item.resolvedAt)}
                          {item.isPending ? ' · Pending sync' : ''}
                        </Text>
                        <Text style={[styles.activityContext, { color: colors.muted }]}>{item.context}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[TextPresets.body, styles.emptyActivityText, { color: colors.textSoft }]}>
                  Shared clears and misses will appear here after a circle checkpoint runs.
                </Text>
              )}
            </FlowPanel>
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
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>Circle</Text>
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
                        {mode === 'create' ? 'Create' : 'Join'}
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
                    label="Invite code"
                    onChangeText={setInviteCode}
                    placeholder="paste invite code"
                    value={inviteCode}
                  />
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

const styles = StyleSheet.create({
  screenContent: {
    gap: 10,
    paddingBottom: 150,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  createCtaFooter: {
    marginBottom: 56,
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
  circleList: {
    gap: Spacing.sm,
  },
  circleFlowItem: {
    gap: Spacing.sm,
    paddingHorizontal: 2,
    paddingTop: Spacing.xs,
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
  circleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingLeft: 42,
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
    gap: Spacing.md,
  },
  activityItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  activityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  activityTitle: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 19,
  },
  activityMeta: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  activityContext: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  emptyActivityText: {
    fontSize: 13,
    lineHeight: 19,
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  sheetTitle: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 24,
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
