import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { AlarmCard } from '@/components/alarm-card';
import { getAppColors } from '@/constants/theme';
import { deleteAlarm, readAlarmStore, resetAlarmStore, updateAlarm } from '@/lib/alarms';
import { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } from '@/lib/notifications';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { listMySocialCircles } from '@/lib/social/circles';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { getSocialRuntimeSnapshot, resetSocialSyncState } from '@/lib/social/queue';
import { SocialFeedItem, SocialRuntimeSnapshot } from '@/lib/social/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, FailureHistoryEntry, FREE_ALARM_LIMIT, SuccessHistoryEntry } from '@/types/alarm';

function formatFailureTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSuccessTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSocialTimestamp(timestamp?: string) {
  if (!timestamp) {
    return 'Not yet';
  }

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFeedInsight(item: SocialFeedItem) {
  if (item.outcome === 'confirmed') {
    const parts = [] as string[];

    if (typeof item.sharePayload.timeToScanSeconds === 'number') {
      parts.push(`${item.sharePayload.timeToScanSeconds}s scan`);
    }

    parts.push(`streak ${item.sharePayload.currentStreak}`);
    return parts.join(' · ');
  }

  return `${item.sharePayload.weeklyCompletionRate}% weekly completion`;
}

export default function HomeScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const {
    configured: isSocialConfigured,
    isLoading: isSocialSessionLoading,
    profile,
    user,
  } = useSocialSession();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [lifetimeAlarmCreations, setLifetimeAlarmCreations] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [failureHistory, setFailureHistory] = useState<FailureHistoryEntry[]>([]);
  const [successHistory, setSuccessHistory] = useState<SuccessHistoryEntry[]>([]);
  const [progressSummary, setProgressSummary] = useState<ProgressSummary | null>(null);
  const [socialRuntime, setSocialRuntime] = useState<SocialRuntimeSnapshot | null>(null);
  const [socialFeed, setSocialFeed] = useState<SocialFeedItem[]>([]);
  const [socialCircleCount, setSocialCircleCount] = useState(0);
  const [isSocialFeedLoading, setIsSocialFeedLoading] = useState(false);

  const loadData = useCallback(async () => {
    const shouldLoadSocialActivity = Boolean(isSocialConfigured && user);

    setIsSocialFeedLoading(shouldLoadSocialActivity);

    try {
      const [store, socialSnapshot, socialActivity] = await Promise.all([
        readAlarmStore(),
        getSocialRuntimeSnapshot(),
        shouldLoadSocialActivity
          ? Promise.all([
              listMySocialCircles().catch(() => []),
              listVisibleSocialFeed(6).catch(() => []),
            ])
          : Promise.resolve([[], []]),
      ]);

      setAlarms(store.alarms);
      setLifetimeAlarmCreations(store.lifetimeAlarmCreations);
      setCurrentStreak(store.currentStreak);
      setLongestStreak(store.longestStreak);
      setFailureHistory(store.failureHistory);
      setSuccessHistory(store.successHistory);
      setProgressSummary(getProgressSummary(store));
      setSocialRuntime(socialSnapshot);
      setSocialCircleCount(socialActivity[0].length);
      setSocialFeed(socialActivity[1]);
    } finally {
      setIsSocialFeedLoading(false);
    }
  }, [isSocialConfigured, user]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const handleCreateAlarmPress = () => {
    if (lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      router.push('/paywall');
      return;
    }

    router.push('/create');
  };

  const handleDeleteAlarm = (alarm: Alarm) => {
    Alert.alert('Delete alarm?', `Remove the ${alarm.label} checkpoint alarm?`, [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelAlarmNotificationAsync(alarm.notificationIds);
          await deleteAlarm(alarm.id);
          await loadData();
        },
      },
    ]);
  };

  const handleEditAlarm = (alarm: Alarm) => {
    router.push({
      pathname: '/create',
      params: {
        alarmId: alarm.id,
        mode: 'edit',
      },
    });
  };

  const handleReuseAlarm = (alarm: Alarm) => {
    router.push({
      pathname: '/create',
      params: {
        alarmId: alarm.id,
        mode: 'reuse',
      },
    });
  };

  const handleRescheduleAlarm = (alarm: Alarm) => {
    Alert.alert(
      'Reschedule alarm?',
      `Schedule the ${alarm.label} alarm for its next ${alarm.repeatSchedule === 'once' ? 'available slot' : 'repeat window'}?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reschedule',
          onPress: async () => {
            const scheduled = await scheduleAlarmNotificationAsync(alarm);
            await cancelAlarmNotificationAsync(alarm.notificationIds);
            await updateAlarm({
              ...alarm,
              isActive: true,
              lastOutcome: undefined,
              notificationIds: scheduled.notificationIds,
              scheduledFor: scheduled.scheduledFor,
            });
            await loadData();
          },
        },
      ]
    );
  };

  const handleResetDemoData = () => {
    Alert.alert(
      'Reset demo data?',
      'This clears saved alarms, resets the free limit, and cancels scheduled alarm notifications on this device.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Promise.all(
              alarms.map((alarm) => cancelAlarmNotificationAsync(alarm.notificationIds))
            );
            await Promise.all([resetAlarmStore(), resetSocialSyncState()]);
            await loadData();
          },
        },
      ]
    );
  };

  const socialAccountButtonLabel = !socialRuntime?.configured
    ? 'Supabase setup required'
    : isSocialSessionLoading
      ? 'Loading account...'
      : user
        ? profile?.handle
          ? `Signed in as @${profile.handle}`
          : 'Finish your profile'
        : 'Create or sign in';
  const showCirclesButton = Boolean(isSocialConfigured && user && profile?.handle);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}>
        <View style={styles.hero}>
          <Text style={[styles.title, { color: colors.text }]}>QR Checkpoint Alarm</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Put a QR checkpoint in another room and scan it before the grace period expires.
          </Text>
        </View>

        <View
          style={[
            styles.limitCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.limitTitle, { color: colors.text }]}>Free alarms used</Text>
          <Text style={[styles.limitValue, { color: colors.primary }]}>
            {Math.min(lifetimeAlarmCreations, FREE_ALARM_LIMIT)} / {FREE_ALARM_LIMIT}
          </Text>
          <Text style={[styles.limitHelp, { color: colors.muted }]}>
            Create up to 3 alarms free. The 4th creation attempt opens the paywall placeholder.
          </Text>
        </View>

        <View
          style={[
            styles.streakCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.streakTitle, { color: colors.text }]}>Streak summary</Text>
          <Text style={[styles.streakHero, { color: colors.primary }]}>
            {progressSummary?.checkpointTitle ?? 'Rookie Scanner'}
          </Text>
          <Text style={[styles.streakHelp, { color: colors.muted }]}>
            {progressSummary?.nextGoalCopy ?? 'Start stacking checkpoint clears to unlock titles.'}
          </Text>
          <View style={styles.streakRow}>
            <View style={styles.streakMetric}>
              <Text style={[styles.streakValue, { color: colors.primary }]}>{currentStreak}</Text>
              <Text style={[styles.streakLabel, { color: colors.muted }]}>Current streak</Text>
            </View>
            <View style={styles.streakMetric}>
              <Text style={[styles.streakValue, { color: colors.text }]}>{longestStreak}</Text>
              <Text style={[styles.streakLabel, { color: colors.muted }]}>Best streak</Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.weekCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.weekTitle, { color: colors.text }]}>This week</Text>
          <View style={styles.weekRow}>
            <View style={styles.weekMetric}>
              <Text style={[styles.weekValue, { color: colors.success }]}>
                {progressSummary?.weeklyStats.completionRate ?? 0}%
              </Text>
              <Text style={[styles.weekLabel, { color: colors.muted }]}>Completion rate</Text>
            </View>
            <View style={styles.weekMetric}>
              <Text style={[styles.weekValue, { color: colors.text }]}>
                {progressSummary?.weeklyStats.successes ?? 0}/{progressSummary?.weeklyStats.attempts ?? 0}
              </Text>
              <Text style={[styles.weekLabel, { color: colors.muted }]}>Wins this week</Text>
            </View>
          </View>
          <Text style={[styles.weekHelp, { color: colors.muted }]}>
            {progressSummary?.weeklyStats.attempts
              ? `You have ${progressSummary.weeklyStats.successes} clean clears and ${progressSummary.weeklyStats.failures} misses in the last 7 days.`
              : 'Your weekly stats will appear after your first completed checkpoint.'}
          </Text>
        </View>

        <View
          style={[
            styles.weekCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.weekTitle, { color: colors.text }]}>Circle activity</Text>
          {!isSocialConfigured ? (
            <>
              <Text style={[styles.weekHelp, { color: colors.muted }]}>
                Add Supabase first so wake-up results can sync into accountability circles.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/account')}
                style={[styles.inlineActionButton, { borderColor: colors.border }]}>
                <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>
                  {socialAccountButtonLabel}
                </Text>
              </Pressable>
            </>
          ) : isSocialSessionLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.weekHelp, { color: colors.muted }]}>Loading social activity...</Text>
            </View>
          ) : !user ? (
            <>
              <Text style={[styles.weekHelp, { color: colors.muted }]}>
                Sign in to see your circle feed and let other members see the alarms you choose to share.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/account')}
                style={[styles.inlineActionButton, { borderColor: colors.border }]}>
                <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>
                  {socialAccountButtonLabel}
                </Text>
              </Pressable>
            </>
          ) : isSocialFeedLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.weekHelp, { color: colors.muted }]}>Refreshing recent circle activity...</Text>
            </View>
          ) : socialCircleCount === 0 ? (
            <>
              <Text style={[styles.weekHelp, { color: colors.muted }]}>
                You have not joined any circles yet. Create one or join from an invite link before attaching alarms to it.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/circles' as never)}
                style={[styles.inlineActionButton, { borderColor: colors.border }]}>
                <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>Create or join circles</Text>
              </Pressable>
            </>
          ) : socialFeed.length === 0 ? (
            <>
              <Text style={[styles.weekHelp, { color: colors.muted }]}>
                Your circles are ready, but nobody has shared a wake-up result yet. Attach an alarm to a circle and enable success or miss sharing to start the feed.
              </Text>
              {showCirclesButton ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/circles' as never)}
                  style={[styles.inlineActionButton, { borderColor: colors.border }]}>
                  <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>Manage circles</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <View style={styles.feedList}>
              {socialFeed.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.feedCard,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.border,
                    },
                  ]}>
                  <View style={styles.feedHeader}>
                    <View style={styles.feedIdentity}>
                      <Text style={[styles.feedActorName, { color: colors.text }]}>
                        {item.isOwnEvent ? 'You' : item.actorDisplayName}
                      </Text>
                      <Text style={[styles.feedActorMeta, { color: colors.muted }]}>
                        @{item.actorHandle} · {item.circleName}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.feedOutcomeBadge,
                        {
                          backgroundColor:
                            item.outcome === 'confirmed' ? `${colors.success}16` : `${colors.danger}16`,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.feedOutcomeText,
                          { color: item.outcome === 'confirmed' ? colors.success : colors.danger },
                        ]}>
                        {item.outcome === 'confirmed' ? 'Cleared' : 'Missed'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.feedAlarmLabel, { color: colors.text }]}>{item.alarmLabel}</Text>
                  <Text style={[styles.feedEventMeta, { color: colors.muted }]}>
                    {formatFeedInsight(item)}
                  </Text>
                  <Text style={[styles.feedEventMeta, { color: colors.muted }]}>
                    {formatSocialTimestamp(item.resolvedAt)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View
          style={[
            styles.weekCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.weekTitle, { color: colors.text }]}>Social sync status</Text>
          <Text style={[styles.weekHelp, { color: colors.muted }]}>
            {!socialRuntime?.configured
              ? 'Social syncing is disabled until Supabase is configured.'
              : !socialRuntime.authenticated
                ? 'Alarm outcomes will stay queued on-device until you sign in.'
                : 'Shared outcomes are retried through the local sync queue so alarms still work offline.'}
          </Text>
          <View style={styles.weekRow}>
            <View style={styles.weekMetric}>
              <Text style={[styles.weekValue, { color: colors.primary }]}>
                {socialRuntime?.queue.pendingCount ?? 0}
              </Text>
              <Text style={[styles.weekLabel, { color: colors.muted }]}>Queued events</Text>
            </View>
            <View style={styles.weekMetric}>
              <Text
                style={[
                  styles.weekValue,
                  { color: (socialRuntime?.queue.failedCount ?? 0) > 0 ? colors.danger : colors.text },
                ]}>
                {socialRuntime?.queue.failedCount ?? 0}
              </Text>
              <Text style={[styles.weekLabel, { color: colors.muted }]}>Failed syncs</Text>
            </View>
          </View>
          <Text style={[styles.weekHelp, { color: colors.muted }]}>
            Last attempt: {formatSocialTimestamp(socialRuntime?.queue.lastAttemptAt)}
          </Text>
          <Text style={[styles.weekHelp, { color: colors.muted }]}>
            Last delivered sync: {formatSocialTimestamp(socialRuntime?.queue.lastSuccessfulSyncAt)}
          </Text>
          {socialRuntime?.queue.latestError ? (
            <Text style={[styles.weekHelp, { color: colors.danger }]}>
              Latest sync error: {socialRuntime.queue.latestError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/account')}
            style={[
              styles.inlineActionButton,
              {
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>
              {socialAccountButtonLabel}
            </Text>
          </Pressable>
          {showCirclesButton ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/circles' as never)}
              style={[
                styles.inlineActionButton,
                {
                  borderColor: colors.border,
                },
              ]}>
              <Text style={[styles.inlineActionButtonText, { color: colors.text }]}>
                Manage circles
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleCreateAlarmPress}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
            Create Alarm
          </Text>
        </Pressable>

        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleResetDemoData}
            style={[styles.devButton, { borderColor: colors.border }]}>
            <Text style={[styles.devButtonText, { color: colors.muted }]}>Reset Demo Data</Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Active badges</Text>
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>
            Lightweight rewards that make consistency feel earned.
          </Text>
        </View>

        {progressSummary?.activeBadges.length ? (
          <View style={styles.badgeList}>
            {progressSummary.activeBadges.map((badge) => (
              <View
                key={badge.id}
                style={[
                  styles.badgeCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}>
                <Text style={[styles.badgeTitle, { color: colors.primary }]}>{badge.label}</Text>
                <Text style={[styles.badgeText, { color: colors.muted }]}>{badge.description}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No badges yet</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Build a streak, finish a perfect week, or bounce back after a miss to unlock them.
            </Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent wins</Text>
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>
            Quick proof that the checkpoint system is working.
          </Text>
        </View>

        {successHistory.length === 0 ? (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No wins yet</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Your successful wake-ups will show up here with scan speed.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {successHistory.slice(0, 3).map((success) => (
              <View
                key={`${success.alarmId}-${success.confirmedAt}`}
                style={[
                  styles.winCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}>
                <View style={styles.winHeader}>
                  <Text style={[styles.winLabel, { color: colors.text }]}>{success.label}</Text>
                  <Text style={[styles.winSpeed, { color: colors.success }]}>
                    {success.timeToScanSeconds}s
                  </Text>
                </View>
                <Text style={[styles.winMeta, { color: colors.muted }]}>
                  Cleared at {formatSuccessTimestamp(success.confirmedAt)}
                </Text>
                <Text style={[styles.winMeta, { color: colors.muted }]}>
                  Grace window: {success.gracePeriodSeconds}s
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent failures</Text>
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>
            Missed checkpoints reset the streak and stay visible here.
          </Text>
        </View>

        {failureHistory.length === 0 ? (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No failures yet</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Complete alarms in a row to build your streak.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {failureHistory.slice(0, 5).map((failure) => (
              <View
                key={`${failure.alarmId}-${failure.failedAt}`}
                style={[
                  styles.failureCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}>
                <Text style={[styles.failureLabel, { color: colors.text }]}>{failure.label}</Text>
                <Text style={[styles.failureMeta, { color: colors.muted }]}>
                  Missed at {formatFailureTimestamp(failure.failedAt)}
                </Text>
                <Text style={[styles.failureMeta, { color: colors.muted }]}>
                  Scheduled for {failure.scheduledFor ? formatFailureTimestamp(failure.scheduledFor) : 'Unknown time'}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Existing alarms</Text>
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>
            Notifications wake the user, then the app routes into the QR checkpoint scan flow.
          </Text>
        </View>

        {alarms.length === 0 ? (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No alarms yet</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Create your first QR checkpoint alarm to test the full MVP flow.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {alarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                onDelete={handleDeleteAlarm}
                onEdit={handleEditAlarm}
                onReschedule={handleRescheduleAlarm}
                onReuse={handleReuseAlarm}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  hero: {
    gap: 8,
    paddingTop: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  limitCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  limitTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  limitValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  limitHelp: {
    fontSize: 14,
    lineHeight: 20,
  },
  streakCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  streakTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  streakHero: {
    fontSize: 24,
    fontWeight: '800',
  },
  streakHelp: {
    fontSize: 14,
    lineHeight: 20,
  },
  streakRow: {
    flexDirection: 'row',
    gap: 12,
  },
  streakMetric: {
    flex: 1,
    gap: 4,
  },
  streakValue: {
    fontSize: 30,
    fontWeight: '800',
  },
  streakLabel: {
    fontSize: 14,
  },
  weekCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  weekTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  weekRow: {
    flexDirection: 'row',
    gap: 12,
  },
  weekMetric: {
    flex: 1,
    gap: 4,
  },
  weekValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  weekLabel: {
    fontSize: 14,
  },
  weekHelp: {
    fontSize: 14,
    lineHeight: 20,
  },
  loadingState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
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
  inlineActionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
    paddingVertical: 12,
  },
  inlineActionButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  feedList: {
    gap: 12,
  },
  feedCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  feedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  feedIdentity: {
    flex: 1,
    gap: 2,
    marginRight: 12,
  },
  feedActorName: {
    fontSize: 15,
    fontWeight: '700',
  },
  feedActorMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  feedOutcomeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  feedOutcomeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  feedAlarmLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  feedEventMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  devButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  devButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    gap: 6,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sectionCaption: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  failureCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  failureLabel: {
    fontSize: 17,
    fontWeight: '700',
  },
  failureMeta: {
    fontSize: 14,
    lineHeight: 20,
  },
  badgeList: {
    gap: 12,
  },
  badgeCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  badgeTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  badgeText: {
    fontSize: 14,
    lineHeight: 20,
  },
  winCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  winHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  winLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    marginRight: 12,
  },
  winSpeed: {
    fontSize: 16,
    fontWeight: '800',
  },
  winMeta: {
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    gap: 14,
  },
});
