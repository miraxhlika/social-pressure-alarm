import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
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
    return 'No circles linked yet';
  }

  if (!lastSuccessfulSyncAt) {
    return `${circleCount} circle${circleCount === 1 ? '' : 's'} ready`;
  }

  return `${circleCount} circle${circleCount === 1 ? '' : 's'} · ${formatSocialTimestamp(lastSuccessfulSyncAt)}`;
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
  const primaryActionLabel = primaryAlarm && getAlarmPhaseLabel(primaryAlarm) === 'Scan now' ? 'Open scanner' : 'Create alarm';

  return (
    <AppScreen>
      <PageHeader
        badgeLabel={user ? `@${profile?.handle ?? 'account'}` : configured ? 'Local' : 'Offline'}
        badgeTone={user ? 'success' : configured ? 'warning' : 'default'}
        eyebrow="Today"
        title="One next step."
        description="Your next checkpoint first."
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
          actionLabel="Create your first alarm"
          description="Set one checkpoint alarm and Today becomes your calm starting point."
          eyebrow="Today"
          onAction={() => router.push('/create')}
          title="No alarm scheduled"
          tone="primary"
        />
      ) : (
        <>
          <AppCard elevated tone="primary" variant="hero" style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next checkpoint</Text>
              <StatusPill label={getAlarmPhaseLabel(primaryAlarm)} tone={getAlarmPhaseTone(primaryAlarm)} />
            </View>

            <View style={styles.heroCopy}>
              <Text style={[styles.heroTime, { color: colors.text }]}>
                {primaryAlarm ? formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute) : 'No alarm'}
              </Text>
              <Text style={[styles.heroLabel, { color: colors.text }]}>
                {primaryAlarm ? primaryAlarm.label : 'Create your first alarm'}
              </Text>
              <Text style={[TextPresets.bodyLg, { color: colors.textSoft }]}>{getPrimaryAlarmCopy(primaryAlarm)}</Text>
            </View>

            <View style={styles.heroFooter}>
              <View style={styles.heroMeta}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Library</Text>
                <Text style={[styles.heroMetaValue, { color: colors.text }]}>
                  {state.alarms.length} alarm{state.alarms.length === 1 ? '' : 's'} saved
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
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Momentum</Text>
            <View style={styles.secondaryRows}>
              <SupportRow
                body={latestOutcome ? latestOutcome.detail : 'Your latest result appears here after the first clear or miss.'}
                label="Latest result"
                onPress={() => router.push('/alarms')}
                pillLabel={latestOutcome ? (latestOutcome.tone === 'success' ? 'Cleared' : 'Missed') : 'Waiting'}
                pillTone={latestOutcome ? latestOutcome.tone : 'default'}
                title={latestOutcome ? latestOutcome.title : 'No completed run yet'}
              />
              <SupportRow
                body={getCircleSummary(state.circleCount, state.socialRuntime?.queue.lastSuccessfulSyncAt)}
                label="Circles"
                onPress={() => router.push('/circles')}
                pillLabel={socialStatusLabel}
                pillTone={socialStatusTone}
                title={state.circleCount === 0 ? 'Private' : `${state.circleCount} circle${state.circleCount === 1 ? '' : 's'}`}
              />
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroMeta: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroMetaValue: {
    ...TextPresets.title,
    fontSize: 20,
    lineHeight: 26,
  },
  heroAction: {
    minWidth: 160,
  },
  secondaryCard: {
    gap: Spacing.md,
  },
  secondaryRows: {
    gap: Spacing.sm,
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
