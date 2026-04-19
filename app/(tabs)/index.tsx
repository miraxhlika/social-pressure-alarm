import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { formatGracePeriodLabel, getUseCaseLabel } from '@/lib/checkpoint-templates';
import {
  formatSocialTimestamp,
  getAlarmPhaseLabel,
  getAlarmPhaseTone,
  getPrimaryAlarm,
  getPrimaryAlarmCopy,
  getSocialStatusLabel,
  getSocialStatusTone,
} from '@/lib/dashboard';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { listMySocialCircles } from '@/lib/social/circles';
import { getSocialRuntimeSnapshot } from '@/lib/social/queue';
import { SocialRuntimeSnapshot } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type HomeState = {
  alarms: Alarm[];
  currentStreak: number;
  lifetimeAlarmCreations: number;
  progressSummary: ProgressSummary | null;
  socialRuntime: SocialRuntimeSnapshot | null;
  circleCount: number;
  latestSuccess: SuccessHistoryEntry | null;
  latestFailure: FailureHistoryEntry | null;
};

function getLatestOutcome(
  success: SuccessHistoryEntry | null,
  failure: FailureHistoryEntry | null
): { tone: 'success' | 'danger'; title: string; detail: string } | null {
  if (!success && !failure) {
    return null;
  }

  const successTime = success ? new Date(success.confirmedAt).getTime() : 0;
  const failureTime = failure ? new Date(failure.failedAt).getTime() : 0;

  if (successTime >= failureTime && success) {
    return {
      tone: 'success',
      title: success.label,
      detail: `Cleared in ${success.timeToScanSeconds}s · ${formatSocialTimestamp(success.confirmedAt)}`,
    };
  }

  if (failure) {
    return {
      tone: 'danger',
      title: failure.label,
      detail: `Missed · ${formatSocialTimestamp(failure.failedAt)}`,
    };
  }

  return null;
}

function getCircleSummary(circleCount: number, lastSuccessfulSyncAt?: string | null) {
  if (circleCount === 0) {
    return 'Private until you add a circle for accountability.';
  }

  if (!lastSuccessfulSyncAt) {
    return `${circleCount} circle${circleCount === 1 ? '' : 's'} ready`;
  }

  return `${circleCount} circle${circleCount === 1 ? '' : 's'} · ${formatSocialTimestamp(lastSuccessfulSyncAt)}`;
}

function getWeeklyReliabilityCopy(progressSummary: ProgressSummary | null) {
  const weeklyStats = progressSummary?.weeklyStats;
  const weeklyReview = progressSummary?.weeklyReview;

  if (!weeklyStats || !weeklyReview || weeklyStats.attempts === 0) {
    return {
      title: 'No reliability baseline yet',
      body: 'Your first live clear or miss will turn this into a useful reliability view instead of a setup placeholder.',
      value: '—',
      helper: 'No attempts recorded',
    };
  }

  return {
    title: weeklyReview.title,
    body: weeklyReview.body,
    value: `${weeklyStats.completionRate}%`,
    helper:
      weeklyStats.averageTimeToClearSeconds === null
        ? `${weeklyStats.successes}/${weeklyStats.attempts} cleared`
        : `Avg clear ${weeklyStats.averageTimeToClearSeconds}s`,
  };
}

function getCurrentRunCopy(progressSummary: ProgressSummary | null, currentStreak: number) {
  if (!progressSummary || currentStreak === 0) {
    return {
      value: '0',
      helper: 'Next clear starts a new run',
    };
  }

  if (!progressSummary.milestoneProgress.nextLabel) {
    return {
      value: `${currentStreak}`,
      helper: 'Highest streak tier reached',
    };
  }

  return {
    value: `${currentStreak}`,
    helper: `${progressSummary.milestoneProgress.remainingWins} to ${progressSummary.milestoneProgress.nextLabel}`,
  };
}

function getWeeklyReviewCards(progressSummary: ProgressSummary | null) {
  const weeklyReview = progressSummary?.weeklyReview;

  if (!weeklyReview) {
    return {
      strongestTitle: 'No leading routine yet',
      strongestBody: 'Once a routine repeats, this card will show which commitment is holding best.',
      recoveryTitle: 'No weak spot yet',
      recoveryBody: 'Misses and low-reliability routines will show up here when the setup needs work.',
      speedLabel: 'No clear-time baseline yet',
      speedBody: 'Clear-time context appears after the first successful run.',
    };
  }

  return {
    strongestTitle: weeklyReview.strongestUseCase ? weeklyReview.strongestUseCase.label : 'No leading routine yet',
    strongestBody: weeklyReview.strongestUseCase
      ? `${weeklyReview.strongestUseCase.completionRate}% reliable across ${weeklyReview.strongestUseCase.attempts} attempt${
          weeklyReview.strongestUseCase.attempts === 1 ? '' : 's'
        }.`
      : 'Once one routine repeats enough, it will become the weekly anchor here.',
    recoveryTitle: weeklyReview.recoveryUseCase ? weeklyReview.recoveryUseCase.label : 'No weak spot right now',
    recoveryBody: weeklyReview.recoveryUseCase
      ? `${weeklyReview.recoveryUseCase.failures} miss${weeklyReview.recoveryUseCase.failures === 1 ? '' : 'es'} this week. Tighten the timing or reach window next.`
      : 'No routine is slipping hard enough to demand a reset.',
    speedLabel: weeklyReview.speedLabel,
    speedBody: weeklyReview.speedBody,
  };
}

export default function TodayScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const { configured, profile, user } = useSocialSession();
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<HomeState>({
    alarms: [],
    currentStreak: 0,
    lifetimeAlarmCreations: 0,
    progressSummary: null,
    socialRuntime: null,
    circleCount: 0,
    latestSuccess: null,
    latestFailure: null,
  });

  const loadHome = useCallback(async () => {
    const shouldLoadCircles = Boolean(configured && user);
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);

      const [store, socialRuntime, circles] = await Promise.all([
        readAlarmStore(),
        getSocialRuntimeSnapshot(),
        shouldLoadCircles ? listMySocialCircles().catch(() => []) : Promise.resolve([]),
      ]);

      setState({
        alarms: store.alarms,
        currentStreak: store.currentStreak,
        lifetimeAlarmCreations: store.lifetimeAlarmCreations,
        progressSummary: getProgressSummary(store),
        socialRuntime,
        circleCount: circles.length,
        latestSuccess: store.successHistory[0] ?? null,
        latestFailure: store.failureHistory[0] ?? null,
      });
    } finally {
      setIsLoading(false);
    }
  }, [configured, user]);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome])
  );

  const primaryAlarm = useMemo(() => getPrimaryAlarm(state.alarms), [state.alarms]);
  const socialStatusLabel = getSocialStatusLabel(state.socialRuntime);
  const socialStatusTone = getSocialStatusTone(state.socialRuntime);
  const latestOutcome = getLatestOutcome(state.latestSuccess, state.latestFailure);
  const weeklyReliability = getWeeklyReliabilityCopy(state.progressSummary);
  const currentRun = getCurrentRunCopy(state.progressSummary, state.currentStreak);
  const weeklyReviewCards = getWeeklyReviewCards(state.progressSummary);
  const primaryActionLabel =
    primaryAlarm && getAlarmPhaseLabel(primaryAlarm) === 'Scan now' ? 'Open scanner' : 'Create checkpoint';

  return (
    <AppScreen>
      <PageHeader
        badgeLabel={user ? `@${profile?.handle ?? 'account'}` : configured ? 'Local' : 'Offline'}
        badgeTone={user ? 'success' : configured ? 'warning' : 'default'}
        eyebrow="Today"
        title="Follow through today."
        description="See the next commitment, what happened last, and whether your system is holding up."
      />

      {isLoading ? (
        <LoadingBlock
          description="Checking your next checkpoint and latest proof."
          style={styles.loadingHero}
          title="Loading today"
          tone="canvas"
        />
      ) : state.alarms.length === 0 ? (
        <EmptyState
          actionLabel="Create your first checkpoint"
          description="Start with one checkpoint tied to something real: waking up, medication, study, training, or leaving on time."
          eyebrow="Today"
          onAction={() => router.push('/create')}
          title="No commitment is protected yet"
          tone="primary"
        />
      ) : (
        <>
          <AppCard elevated tone="primary" variant="hero" style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next commitment</Text>
              <StatusPill label={getAlarmPhaseLabel(primaryAlarm)} tone={getAlarmPhaseTone(primaryAlarm)} />
            </View>

            <View style={styles.heroCopy}>
              <Text style={[styles.heroTime, { color: colors.text }]}>
                {primaryAlarm ? formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute) : 'No checkpoint'}
              </Text>
              <Text style={[styles.heroLabel, { color: colors.text }]}>
                {primaryAlarm ? primaryAlarm.label : 'Create your first checkpoint'}
              </Text>
              <Text style={[TextPresets.bodyLg, { color: colors.textSoft }]}>{getPrimaryAlarmCopy(primaryAlarm)}</Text>
            </View>

            {primaryAlarm ? (
              <View style={styles.heroMetaWrap}>
                <View style={[styles.heroMetaBlock, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                  <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Use case</Text>
                  <Text style={[styles.heroMetaValue, { color: colors.text }]}>{getUseCaseLabel(primaryAlarm.useCaseType)}</Text>
                </View>
                <View style={[styles.heroMetaBlock, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
                  <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Reach window</Text>
                  <Text style={[styles.heroMetaValue, { color: colors.text }]}>
                    {formatGracePeriodLabel(primaryAlarm.gracePeriodSeconds)}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.heroFooter}>
              <View style={styles.heroMeta}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Checkpoint library</Text>
                <Text style={[styles.heroMetaValue, { color: colors.text }]}>
                  {state.alarms.length} reusable checkpoint{state.alarms.length === 1 ? '' : 's'}
                </Text>
                <Text style={[styles.heroMetaBody, { color: colors.textSoft }]}>
                  Keep only the setups you want to repeat. Adjust the rest.
                </Text>
              </View>
              <AppButton
                label={primaryActionLabel}
                onPress={() => {
                  if (getAlarmPhaseLabel(primaryAlarm) === 'Scan now' && primaryAlarm) {
                    router.push(`/ringing?alarmId=${primaryAlarm.id}`);
                  } else {
                    router.push('/create');
                  }
                }}
                style={styles.heroAction}
              />
            </View>
          </AppCard>

          <AppCard elevated tone="canvas" style={styles.secondaryCard}>
            <View style={styles.secondaryHeader}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Reliability</Text>
              <Text style={[styles.secondaryTitle, { color: colors.text }]}>{weeklyReliability.title}</Text>
              <Text style={[styles.secondaryBody, { color: colors.textSoft }]}>{weeklyReliability.body}</Text>
            </View>

            <View style={styles.statRow}>
              <StatTile helper={weeklyReliability.helper} label="This week" tone="primary" value={weeklyReliability.value} variant="inline" />
              <StatTile helper={currentRun.helper} label="Current run" tone="success" value={currentRun.value} variant="inline" />
            </View>

            <View style={styles.secondaryRows}>
              <SupportRow
                body={latestOutcome ? latestOutcome.detail : 'Your first clear or miss will show up here with enough detail to judge the setup.'}
                label="Latest proof"
                onPress={() => router.push('/alarms')}
                pillLabel={latestOutcome ? (latestOutcome.tone === 'success' ? 'Cleared' : 'Missed') : 'Waiting'}
                pillTone={latestOutcome ? latestOutcome.tone : 'default'}
                title={latestOutcome ? latestOutcome.title : 'No completed run yet'}
              />
              <SupportRow
                body={getCircleSummary(state.circleCount, state.socialRuntime?.queue.lastSuccessfulSyncAt)}
                label="Accountability"
                onPress={() => router.push('/circles')}
                pillLabel={socialStatusLabel}
                pillTone={socialStatusTone}
                title={state.circleCount === 0 ? 'Private setup' : `${state.circleCount} circle${state.circleCount === 1 ? '' : 's'} connected`}
              />
            </View>
          </AppCard>

          <AppCard elevated tone="canvas" style={styles.reviewCard}>
            <View style={styles.secondaryHeader}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Weekly review</Text>
              <Text style={[styles.secondaryTitle, { color: colors.text }]}>
                {state.progressSummary?.weeklyReview.title ?? 'Your review builds here'}
              </Text>
              <Text style={[styles.secondaryBody, { color: colors.textSoft }]}>
                {state.progressSummary?.weeklyReview.body ??
                  'Repeat one real commitment and this space will start showing what is holding up and what needs tightening.'}
              </Text>
            </View>

            <View style={styles.reviewGrid}>
              <ReviewPanel
                body={weeklyReviewCards.strongestBody}
                kicker="Holding strongest"
                title={weeklyReviewCards.strongestTitle}
              />
              <ReviewPanel
                body={weeklyReviewCards.recoveryBody}
                kicker="Tighten next"
                title={weeklyReviewCards.recoveryTitle}
              />
            </View>

            <View style={[styles.reviewFooter, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Speed to proof</Text>
              <Text style={[styles.reviewFooterTitle, { color: colors.text }]}>{weeklyReviewCards.speedLabel}</Text>
              <Text style={[styles.supportRowBody, { color: colors.textSoft }]}>{weeklyReviewCards.speedBody}</Text>
            </View>
          </AppCard>
        </>
      )}
    </AppScreen>
  );
}

function SupportRow({
  label,
  title,
  body,
  pillLabel,
  pillTone,
  onPress,
}: {
  label: string;
  title: string;
  body: string;
  pillLabel: string;
  pillTone: 'default' | 'primary' | 'success' | 'danger' | 'warning';
  onPress: () => void;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.supportRow, { borderColor: colors.line }, pressed && styles.pressedRow]}>
      <View style={styles.supportRowCopy}>
        <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.supportRowTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.supportRowBody, { color: colors.textSoft }]}>{body}</Text>
      </View>
      <StatusPill label={pillLabel} tone={pillTone} />
    </Pressable>
  );
}

function ReviewPanel({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.reviewPanel, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{kicker}</Text>
      <Text style={[styles.reviewPanelTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.supportRowBody, { color: colors.textSoft }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingHero: {
    minHeight: 188,
  },
  heroCard: {
    gap: Spacing.xl,
  },
  heroTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroCopy: {
    gap: Spacing.sm,
  },
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: Type.hero,
    fontWeight: '800',
    letterSpacing: -1.4,
    lineHeight: 56,
  },
  heroLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  heroFooter: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroMeta: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroMetaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  heroMetaBlock: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    minWidth: 140,
    padding: Spacing.md,
  },
  heroMetaValue: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  heroMetaBody: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  heroAction: {
    flexGrow: 1,
    minWidth: 160,
  },
  secondaryCard: {
    gap: Spacing.md,
  },
  secondaryHeader: {
    gap: Spacing.xs,
  },
  secondaryTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  secondaryBody: {
    ...TextPresets.body,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  secondaryRows: {
    gap: Spacing.sm,
  },
  reviewCard: {
    gap: Spacing.md,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  reviewPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    minWidth: 150,
    padding: Spacing.md,
  },
  reviewPanelTitle: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  reviewFooter: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  reviewFooterTitle: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  supportRow: {
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  pressedRow: {
    opacity: 0.88,
  },
  supportRowCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  supportRowTitle: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  supportRowBody: {
    ...TextPresets.body,
    fontSize: 15,
    lineHeight: 22,
  },
});
