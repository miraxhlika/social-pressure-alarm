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
import { getCheckpointRoutineCopy, getUseCaseLabel } from '@/lib/checkpoint-templates';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { Alarm, SuccessHistoryEntry } from '@/types/alarm';

type SuccessState = {
  currentStreak: number;
  longestStreak: number;
  alarm: Alarm | null;
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

function getRepeatScheduleLabel(value?: Alarm['repeatSchedule']) {
  if (value === 'daily') {
    return 'Daily';
  }

  if (value === 'weekdays') {
    return 'Weekdays';
  }

  return 'Once';
}

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

function getHeroKicker(successState: SuccessState | null, isSetupComplete: boolean) {
  if (isSetupComplete) {
    return 'Checkpoint saved';
  }

  if (!successState) {
    return 'Checkpoint cleared';
  }

  const weeklyStats = successState.summary.weeklyStats;
  const weeklyReview = successState.summary.weeklyReview;

  if (weeklyStats.attempts >= 3 && weeklyStats.completionRate === 100) {
    return weeklyReview.strongestUseCase ? `${weeklyReview.strongestUseCase.label} held` : 'Reliable this week';
  }

  if (weeklyStats.attempts >= 2 && weeklyStats.completionRate >= 75) {
    return 'Solid follow-through';
  }

  return successState.currentStreak >= 2 ? 'Back on track' : 'Checkpoint cleared';
}

function getHeroBody(successState: SuccessState | null, label: string | undefined, isSetupComplete: boolean) {
  if (isSetupComplete) {
    if (successState?.alarm?.scheduledFor) {
      return `${label ?? successState.alarm.label} is scheduled for ${new Date(
        successState.alarm.scheduledFor
      ).toLocaleString([], {
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      })}. You can still edit the timing or proof before the first live run.`;
    }

    return `${label ?? 'This checkpoint'} is saved. The next step is using it in a real routine, then adding one more commitment once the system feels real.`;
  }

  if (!successState) {
    return label ? `${label} matched before the timer expired.` : 'The checkpoint matched before the timer expired.';
  }

  if (successState.successEntry) {
    const routineCopy = getCheckpointRoutineCopy(successState.alarm?.useCaseType);

    return label
      ? `${label} cleared in ${successState.successEntry.timeToScanSeconds}s. Your ${routineCopy} held when it mattered.`
      : `Cleared in ${successState.successEntry.timeToScanSeconds}s. Your ${routineCopy} held when it mattered.`;
  }

  return label ? `${label} matched before time ran out.` : 'The checkpoint matched before time ran out.';
}

function getReliabilityStat(successState: SuccessState | null) {
  const weeklyStats = successState?.summary.weeklyStats;

  if (!weeklyStats || weeklyStats.attempts === 0) {
    return {
      value: '—',
      helper: 'No weekly history yet',
    };
  }

  return {
    value: `${weeklyStats.completionRate}%`,
    helper:
      weeklyStats.averageTimeToClearSeconds === null
        ? `${weeklyStats.successes}/${weeklyStats.attempts} cleared this week`
        : `Avg clear ${weeklyStats.averageTimeToClearSeconds}s`,
  };
}

function getNextRoutineCopy(successState: SuccessState | null, isSetupComplete: boolean, shouldPromptSecondCheckpoint: boolean) {
  if (isSetupComplete && shouldPromptSecondCheckpoint) {
    return 'The fastest way to make this stick is to protect one more routine while this setup is still fresh.';
  }

  if (isSetupComplete) {
    return 'Your first live run is scheduled. Edit the setup if needed, or add another checkpoint for a second commitment.';
  }

  if (!successState?.nextAlarm) {
    const routineCopy = getCheckpointRoutineCopy(successState?.alarm?.useCaseType);
    return `Turn this win into the next protected ${routineCopy} while the proof is still fresh.`;
  }

  const nextRoutine = getCheckpointRoutineCopy(successState.nextAlarm.useCaseType);
  return `${formatAlarmTime(successState.nextAlarm.hour, successState.nextAlarm.minute)} at ${
    successState.nextAlarm.label
  }. Keep your ${nextRoutine} protected.`;
}

function getWeeklyReliabilityCaption(successState: SuccessState | null) {
  const weeklyReview = successState?.summary.weeklyReview;
  const weeklyStats = successState?.summary.weeklyStats;

  if (!weeklyStats || weeklyStats.attempts === 0) {
    return 'First result recorded. Weekly reliability will build from here.';
  }

  return weeklyReview?.body ?? `${weeklyStats.completionRate}% reliable this week.`;
}

function getReviewPanels(successState: SuccessState | null) {
  const weeklyReview = successState?.summary.weeklyReview;

  if (!weeklyReview) {
    return {
      strongestTitle: 'No leading routine yet',
      strongestBody: 'Weekly patterning appears once this checkpoint has live history.',
      recoveryTitle: 'No weak spot yet',
      recoveryBody: 'Misses or shaky routines will show up here when they need work.',
    };
  }

  return {
    strongestTitle: weeklyReview.strongestUseCase ? weeklyReview.strongestUseCase.label : 'No leading routine yet',
    strongestBody: weeklyReview.strongestUseCase
      ? `${weeklyReview.strongestUseCase.completionRate}% reliable across ${weeklyReview.strongestUseCase.attempts} attempt${
          weeklyReview.strongestUseCase.attempts === 1 ? '' : 's'
        }.`
      : 'Repeat one commitment enough times and it will become the leading routine here.',
    recoveryTitle: weeklyReview.recoveryUseCase ? weeklyReview.recoveryUseCase.label : 'No weak spot right now',
    recoveryBody: weeklyReview.recoveryUseCase
      ? `${weeklyReview.recoveryUseCase.failures} miss${weeklyReview.recoveryUseCase.failures === 1 ? '' : 'es'} this week. Tighten that setup before it drags the rest down.`
      : 'Nothing is slipping hard enough to demand a reset right now.',
  };
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
  const params = useLocalSearchParams<{ alarmId?: string; label?: string; mode?: string; promptSecondCheckpoint?: string }>();
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
  const isSetupComplete = params.mode === 'setup_complete';
  const shouldPromptSecondCheckpoint = params.promptSecondCheckpoint === '1';

  useEffect(() => {
    const loadProgress = async () => {
      setIsLoading(true);

      try {
        const [store, socialQueue] = await Promise.all([readAlarmStore(), getSocialQueueSummary()]);
        const summary = getProgressSummary(store);
        const alarm = store.alarms.find((entry) => entry.id === params.alarmId) ?? null;
        const successEntry = isSetupComplete
          ? null
          : store.successHistory.find((entry) => entry.alarmId === params.alarmId) ?? summary.latestSuccess;
        const eventId =
          params.alarmId && successEntry ? `${params.alarmId}-${successEntry.confirmedAt}` : null;
        const queuedEvent =
          eventId ? socialQueue.queuedEvents.find((entry) => entry.id === eventId) ?? null : null;

        setSuccessState({
          currentStreak: store.currentStreak,
          longestStreak: store.longestStreak,
          alarm,
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
  }, [isSetupComplete, params.alarmId]);

  const progressWidth = useMemo(() => {
    if (!successState) {
      return '8%' as DimensionValue;
    }

    const weeklyAttempts = successState.summary.weeklyStats.attempts;
    const weeklyCompletionRate = successState.summary.weeklyStats.completionRate;

    return `${Math.max(8, weeklyAttempts === 0 ? 8 : weeklyCompletionRate)}%` as DimensionValue;
  }, [successState]);

  const shareTone = getShareTone(successState?.shareStatus?.tone);
  const heroKicker = getHeroKicker(successState, isSetupComplete);
  const heroBody = getHeroBody(successState, params.label, isSetupComplete);
  const reliabilityStat = getReliabilityStat(successState);
  const nextRoutineCopy = getNextRoutineCopy(successState, isSetupComplete, shouldPromptSecondCheckpoint);
  const weeklyReliabilityCaption = getWeeklyReliabilityCaption(successState);
  const reviewPanels = getReviewPanels(successState);
  const primaryStatLabel = isSetupComplete ? 'Repeat' : 'Time to clear';
  const primaryStatValue = isSetupComplete
    ? getRepeatScheduleLabel(successState?.alarm?.repeatSchedule)
    : formatTimeToScan(successState?.successEntry ?? null);
  const primaryStatTone = isSetupComplete ? ('primary' as const) : ('success' as const);
  const title = isSetupComplete ? 'Checkpoint ready' : 'Follow-through confirmed';
  const statusLabel = isSetupComplete ? 'Saved' : 'Cleared';
  const statusTone = isSetupComplete ? ('primary' as const) : ('success' as const);
  const nextCardTitle = shouldPromptSecondCheckpoint
    ? 'Add a second checkpoint'
    : successState?.nextAlarm
      ? `${formatAlarmTime(successState.nextAlarm.hour, successState.nextAlarm.minute)} · ${successState.nextAlarm.label}`
      : 'Schedule the next checkpoint';
  const primaryButtonLabel = shouldPromptSecondCheckpoint
    ? 'Add second checkpoint'
    : successState?.nextAlarm
      ? 'Manage checkpoints'
      : 'Create next checkpoint';

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
          description={isSetupComplete ? 'Preparing your first real checkpoint.' : 'Saving this clear to your progress.'}
          style={styles.loadingCard}
          title={isSetupComplete ? 'Finishing setup' : 'Saving the win'}
          tone={isSetupComplete ? 'primary' : 'success'}
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
                <Text style={[TextPresets.eyebrow, { color: isSetupComplete ? colors.primary : colors.success }]}>{heroKicker}</Text>
                <StatusPill label={statusLabel} tone={statusTone} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text style={[styles.heroBody, { color: colors.textSoft }]}>{heroBody}</Text>

              <View style={styles.heroHighlights}>
                <StatTile label={primaryStatLabel} tone={primaryStatTone} value={primaryStatValue} />
                <StatTile helper={reliabilityStat.helper} label="This week" tone="primary" value={reliabilityStat.value} />
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
                <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next routine</Text>
                <Text style={[styles.nextTitle, { color: colors.text }]}>{nextCardTitle}</Text>
                <Text style={[styles.nextBody, { color: colors.textSoft }]}>{nextRoutineCopy}</Text>
              </View>
              <View style={styles.nextMetaRow}>
                {!isSetupComplete ? (
                  <StatusPill
                    label={successState.currentStreak > 0 ? `Run ${successState.currentStreak}` : 'Fresh start'}
                    tone={successState.currentStreak > 0 ? 'success' : 'default'}
                  />
                ) : null}
                {successState.alarm ? (
                  <StatusPill label={getUseCaseLabel(successState.alarm.useCaseType)} tone="primary" />
                ) : null}
                {isSetupComplete && successState.alarm ? (
                  <StatusPill label={getRepeatScheduleLabel(successState.alarm.repeatSchedule)} tone="default" />
                ) : null}
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: progressWidth }]} />
              </View>
              <Text style={[styles.progressCaption, { color: colors.textSoft }]}>{weeklyReliabilityCaption}</Text>
              <View style={styles.reviewRow}>
                <ReviewPanel body={reviewPanels.strongestBody} label="Holding strongest" title={reviewPanels.strongestTitle} />
                <ReviewPanel body={reviewPanels.recoveryBody} label="Tighten next" title={reviewPanels.recoveryTitle} />
              </View>
              <View style={styles.buttonRow}>
                <AppButton
                  label={primaryButtonLabel}
                  onPress={() => router.replace(shouldPromptSecondCheckpoint || !successState.nextAlarm ? '/create' : '/alarms')}
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

function ReviewPanel({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.reviewPanel, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{label}</Text>
      <Text style={[styles.reviewTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.reviewBody, { color: colors.textSoft }]}>{body}</Text>
    </View>
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
  nextMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
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
  reviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  reviewPanel: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    minWidth: 150,
    padding: Spacing.md,
  },
  reviewTitle: {
    ...TextPresets.title,
    fontSize: 18,
    lineHeight: 24,
  },
  reviewBody: {
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
