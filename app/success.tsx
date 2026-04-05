import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, DimensionValue, Easing, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, readAlarmStore } from '@/lib/alarms';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { Alarm, SuccessHistoryEntry } from '@/types/alarm';

type SuccessState = {
  currentStreak: number;
  longestStreak: number;
  summary: ProgressSummary;
  successEntry: SuccessHistoryEntry | null;
  shareStatus: SuccessShareStatus | null;
  nextAlarm: Alarm | null;
};

type SuccessShareStatus = {
  tone: 'private' | 'queued' | 'shared';
  title: string;
  copy: string;
};

function formatTimeToScan(successEntry: SuccessHistoryEntry | null) {
  if (!successEntry) {
    return '--';
  }

  return `${successEntry.timeToScanSeconds}s`;
}

function getSuccessShareStatus(
  alarm: Alarm | null,
  successEntry: SuccessHistoryEntry | null,
  queuedEvent: { lastSyncError?: string } | null
): SuccessShareStatus | null {
  if (!alarm || !successEntry) {
    return null;
  }

  if (!alarm.socialSettings?.circleId || !alarm.socialSettings.shareSuccesses) {
    return {
      tone: 'private',
      title: 'Private',
      copy: 'Saved only to your account.',
    };
  }

  if (queuedEvent) {
    return {
      tone: 'queued',
      title: 'Queued',
      copy: queuedEvent.lastSyncError ? 'Circle sync will retry automatically.' : 'Syncing to your circle.',
    };
  }

  return {
    tone: 'shared',
    title: 'Shared',
    copy: 'Available in your circle.',
  };
}

function getShareTone(tone?: SuccessShareStatus['tone']) {
  switch (tone) {
    case 'shared':
      return 'success' as const;
    case 'queued':
      return 'primary' as const;
    default:
      return 'default' as const;
  }
}

function getHeroKicker(successState: SuccessState | null) {
  if (!successState) {
    return 'Checkpoint cleared';
  }

  return successState.currentStreak >= 2 ? 'Streak extended' : 'Checkpoint cleared';
}

function getHeroBody(successState: SuccessState | null, label?: string) {
  if (!successState) {
    return label ? `${label} matched before the timer expired.` : 'The checkpoint matched before the timer expired.';
  }

  if (successState.currentStreak >= 2) {
    return successState.summary.nextGoalCopy;
  }

  if (successState.successEntry) {
    return label
      ? `${label} cleared in ${successState.successEntry.timeToScanSeconds}s.`
      : `Cleared in ${successState.successEntry.timeToScanSeconds}s.`;
  }

  return label ? `${label} matched before time ran out.` : 'The checkpoint matched before time ran out.';
}

async function triggerSuccessArrival() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are best-effort only.
  }
}

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string; label?: string }>();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslateY = useRef(new Animated.Value(24)).current;
  const heroScale = useRef(new Animated.Value(0.94)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const detailOpacity = useRef(new Animated.Value(0)).current;
  const detailTranslateY = useRef(new Animated.Value(20)).current;
  const didCelebrateRef = useRef(false);

  useEffect(() => {
    const loadProgress = async () => {
      setIsLoading(true);

      try {
        const [store, socialQueue] = await Promise.all([readAlarmStore(), getSocialQueueSummary()]);
        const summary = getProgressSummary(store);
        const alarm = store.alarms.find((entry) => entry.id === params.alarmId) ?? null;
        const successEntry =
          store.successHistory.find((entry) => entry.alarmId === params.alarmId) ?? summary.latestSuccess;
        const eventId =
          params.alarmId && successEntry ? `${params.alarmId}-${successEntry.confirmedAt}` : null;
        const queuedEvent =
          eventId ? socialQueue.queuedEvents.find((entry) => entry.id === eventId) ?? null : null;

        setSuccessState({
          currentStreak: store.currentStreak,
          longestStreak: store.longestStreak,
          summary,
          successEntry,
          shareStatus: getSuccessShareStatus(alarm, successEntry, queuedEvent),
          nextAlarm: getPrimaryAlarm(store.alarms),
        });
      } finally {
        setIsLoading(false);
      }
    };

    void loadProgress();
  }, [params.alarmId]);

  const progressWidth = useMemo(() => {
    if (!successState) {
      return '8%' as DimensionValue;
    }

    return `${Math.max(8, Math.round(successState.summary.milestoneProgress.progressRatio * 100))}%` as DimensionValue;
  }, [successState]);

  const shareTone = getShareTone(successState?.shareStatus?.tone);
  const heroKicker = getHeroKicker(successState);
  const heroBody = getHeroBody(successState, params.label);
  const keyStatLabel =
    successState && successState.currentStreak >= 2 ? 'Current streak' : 'Time to scan';
  const keyStatValue =
    successState && successState.currentStreak >= 2
      ? `${successState.currentStreak}`
      : formatTimeToScan(successState?.successEntry ?? null);

  useEffect(() => {
    if (isLoading || !successState || didCelebrateRef.current) {
      return;
    }

    didCelebrateRef.current = true;
    void triggerSuccessArrival();

    Animated.parallel([
      Animated.spring(heroOpacity, {
        toValue: 1,
        friction: 8,
        tension: 70,
        useNativeDriver: true,
      }),
      Animated.spring(heroTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 70,
        useNativeDriver: true,
      }),
      Animated.spring(heroScale, {
        toValue: 1,
        friction: 7,
        tension: 85,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0.25,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.timing(detailOpacity, {
            toValue: 1,
            duration: 360,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(detailTranslateY, {
            toValue: 0,
            duration: 360,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [detailOpacity, detailTranslateY, glowPulse, heroOpacity, heroScale, heroTranslateY, isLoading, successState]);

  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1.08],
  });
  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.1, 0.28],
  });

  return (
    <AppScreen>
      {isLoading ? (
        <LoadingBlock
          description="Adding this clear to your streak."
          style={styles.loadingCard}
          title="Saving the win"
          tone="success"
        />
      ) : null}

      {!isLoading && successState ? (
        <>
          <Animated.View
            style={[
              styles.heroShell,
              {
                opacity: heroOpacity,
                transform: [{ translateY: heroTranslateY }, { scale: heroScale }],
              },
            ]}>
            <View pointerEvents="none" style={[styles.heroBackdropOrb, styles.heroBackdropTop, { backgroundColor: colors.success }]} />
            <View pointerEvents="none" style={[styles.heroBackdropOrb, styles.heroBackdropBottom, { backgroundColor: colors.primary }]} />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.heroGlow,
                {
                  backgroundColor: colors.success,
                  opacity: glowOpacity,
                  transform: [{ scale: glowScale }],
                },
              ]}
            />

            <AppCard elevated style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <View style={styles.heroTopRow}>
                <Text style={[TextPresets.eyebrow, { color: colors.success }]}>{heroKicker}</Text>
                <StatusPill label="Cleared" tone="success" />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>Checkpoint cleared</Text>
              <Text style={[styles.heroBody, { color: colors.textSoft }]}>{heroBody}</Text>

              <View style={styles.heroHighlights}>
                <StatTile label={keyStatLabel} tone="success" value={keyStatValue} />
                <StatTile label="Best streak" tone="primary" value={`${successState.longestStreak}`} />
              </View>

              {successState.shareStatus ? (
                <View style={[styles.heroFooter, { borderTopColor: colors.line }]}>
                  <StatusPill label={successState.shareStatus.title} tone={shareTone} />
                  <Text style={[styles.shareCopy, { color: colors.textSoft }]}>{successState.shareStatus.copy}</Text>
                </View>
              ) : null}
            </AppCard>
          </Animated.View>

          <Animated.View
            style={[
              styles.detailStack,
              {
                opacity: detailOpacity,
                transform: [{ translateY: detailTranslateY }],
              },
            ]}>
            <AppCard elevated tone="canvas" style={styles.nextCard}>
              <View style={styles.nextHeader}>
                <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next</Text>
                <Text style={[styles.nextTitle, { color: colors.text }]}>
                  {successState.nextAlarm
                    ? `${formatAlarmTime(successState.nextAlarm.hour, successState.nextAlarm.minute)} · ${successState.nextAlarm.label}`
                    : 'Schedule the next checkpoint'}
                </Text>
                <Text style={[styles.nextBody, { color: colors.textSoft }]}>{successState.summary.nextGoalCopy}</Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: progressWidth }]} />
              </View>
              <Text style={[styles.progressCaption, { color: colors.textSoft }]}>
                {successState.summary.currentStreakMilestone?.title ??
                  successState.summary.milestoneProgress.currentLabel ??
                  'Getting started'}
                {successState.summary.milestoneProgress.nextLabel
                  ? ` · ${successState.summary.milestoneProgress.remainingWins} to go`
                  : ''}
              </Text>
              <View style={styles.buttonRow}>
                <AppButton
                  label={successState.nextAlarm ? 'Manage alarms' : 'Create next alarm'}
                  onPress={() => router.replace(successState.nextAlarm ? '/alarms' : '/create')}
                  style={styles.buttonFill}
                />
                <AppButton
                  label="Back to today"
                  onPress={() => router.replace('/')}
                  style={styles.buttonFill}
                  variant="secondary"
                />
              </View>
            </AppCard>
          </Animated.View>
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    minHeight: 200,
  },
  heroShell: {
    overflow: 'hidden',
    position: 'relative',
  },
  heroBackdropOrb: {
    borderRadius: 180,
    height: 180,
    opacity: 0.1,
    position: 'absolute',
    width: 180,
  },
  heroBackdropTop: {
    right: -36,
    top: -12,
  },
  heroBackdropBottom: {
    bottom: 18,
    left: -48,
  },
  heroGlow: {
    alignSelf: 'center',
    borderRadius: 200,
    height: 200,
    position: 'absolute',
    top: 36,
    width: 200,
  },
  heroCard: {
    gap: Spacing.md,
  },
  heroTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  heroBody: {
    ...TextPresets.body,
  },
  heroHighlights: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  heroFooter: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  shareCopy: {
    ...TextPresets.body,
    flex: 1,
  },
  detailStack: {
    gap: Spacing.lg,
  },
  nextCard: {
    gap: Spacing.md,
  },
  nextHeader: {
    gap: Spacing.xs,
  },
  nextTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  nextBody: {
    ...TextPresets.body,
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
  },
  progressCaption: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  buttonFill: {
    flexBasis: 180,
    flexGrow: 1,
  },
});
