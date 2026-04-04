import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Shadows, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore, formatAlarmTime } from '@/lib/alarms';
import {
  formatSocialTimestamp,
  getAlarmPhaseLabel,
  getAlarmPhaseTone,
  getPrimaryAlarm,
  getPrimaryAlarmCopy,
  getSocialStatusLabel,
  getSocialStatusTone,
} from '@/lib/dashboard';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { listMySocialCircles } from '@/lib/social/circles';
import { getSocialRuntimeSnapshot } from '@/lib/social/queue';
import { SocialRuntimeSnapshot } from '@/lib/social/types';
import { useSocialSession } from '@/providers/social-session-provider';
import { Alarm, FailureHistoryEntry, FREE_ALARM_LIMIT, SuccessHistoryEntry } from '@/types/alarm';

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

export default function TodayScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const { configured, profile, user } = useSocialSession();
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
  }, [configured, user]);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome])
  );

  const primaryAlarm = useMemo(() => getPrimaryAlarm(state.alarms), [state.alarms]);
  const freeSlotsRemaining = Math.max(0, FREE_ALARM_LIMIT - state.lifetimeAlarmCreations);
  const socialStatusLabel = getSocialStatusLabel(state.socialRuntime);
  const socialStatusTone = getSocialStatusTone(state.socialRuntime);
  const latestOutcome = getLatestOutcome(state.latestSuccess, state.latestFailure);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropTop, { backgroundColor: colors.primary }]} />
      <View pointerEvents="none" style={[styles.backdropOrb, styles.backdropBottom, { backgroundColor: colors.accent }]} />

      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <PageHeader
          eyebrow="Today"
          title="Your morning at a glance"
          description="Next alarm, streak, and latest result."
          badgeLabel={user ? `@${profile?.handle ?? 'account'}` : configured ? 'Guest' : 'Offline'}
          badgeTone={user ? 'success' : configured ? 'warning' : 'default'}
        />

        <AppCard elevated style={[styles.heroCard, Shadows.hero]} tone="primary">
          <View style={styles.heroHeader}>
            <View style={styles.heroCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Next checkpoint</Text>
              <Text style={[styles.heroTime, { color: colors.text }]}>
                {primaryAlarm ? formatAlarmTime(primaryAlarm.hour, primaryAlarm.minute) : 'No alarm'}
              </Text>
              <Text style={[styles.heroLabel, { color: colors.text }]}>
                {primaryAlarm ? primaryAlarm.label : 'Create your first alarm'}
              </Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>{getPrimaryAlarmCopy(primaryAlarm)}</Text>
            </View>
            <StatusPill label={getAlarmPhaseLabel(primaryAlarm)} tone={getAlarmPhaseTone(primaryAlarm)} />
          </View>

          <View style={styles.heroActions}>
            <AppButton
              label="New alarm"
              onPress={() => router.push('/create')}
              style={styles.heroAction}
            />
            <AppButton
              label="Manage alarms"
              onPress={() => router.push('/alarms')}
              style={styles.heroAction}
              variant="secondary"
            />
          </View>
        </AppCard>

        <View style={styles.metricGrid}>
          <StatTile label="Current streak" tone="primary" value={`${state.currentStreak}`} />
          <StatTile
            helper={`${state.progressSummary?.weeklyStats.successes ?? 0}/${state.progressSummary?.weeklyStats.attempts ?? 0} clears`}
            label="This week"
            tone="success"
            value={`${state.progressSummary?.weeklyStats.completionRate ?? 0}%`}
          />
          <StatTile
            helper={`${Math.min(state.lifetimeAlarmCreations, FREE_ALARM_LIMIT)} of ${FREE_ALARM_LIMIT} used`}
            label="Free slots"
            value={`${freeSlotsRemaining}`}
          />
        </View>

        <SectionHeader
          kicker="Today"
          title="At a glance"
          description="Only the essentials."
        />

        <View style={styles.glanceGrid}>
          <AppCard elevated style={styles.glanceCard}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Latest result</Text>
            {latestOutcome ? (
              <>
                <StatusPill label={latestOutcome.tone === 'success' ? 'Cleared' : 'Missed'} tone={latestOutcome.tone} />
                <Text style={[styles.glanceTitle, { color: colors.text }]}>{latestOutcome.title}</Text>
                <Text style={[TextPresets.body, { color: colors.muted }]}>{latestOutcome.detail}</Text>
              </>
            ) : (
              <Text style={[TextPresets.body, { color: colors.muted }]}>
                Complete a checkpoint and the latest result will appear here.
              </Text>
            )}
          </AppCard>

          <AppCard elevated style={styles.glanceCard}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Circles</Text>
            <StatusPill label={socialStatusLabel} tone={socialStatusTone} />
            <Text style={[styles.glanceTitle, { color: colors.text }]}>
              {state.circleCount} circle{state.circleCount === 1 ? '' : 's'}
            </Text>
            <Text style={[TextPresets.body, { color: colors.muted }]}>
              Last delivery {formatSocialTimestamp(state.socialRuntime?.queue.lastSuccessfulSyncAt)}
            </Text>
          </AppCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  backdropOrb: {
    borderRadius: 240,
    height: 260,
    opacity: 0.1,
    position: 'absolute',
    width: 260,
  },
  backdropTop: {
    right: -70,
    top: 12,
  },
  backdropBottom: {
    bottom: 180,
    left: -100,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: 128,
  },
  heroCard: {
    gap: Spacing.lg,
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroTime: {
    fontFamily: Fonts.rounded,
    fontSize: Type.hero,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  heroLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  heroActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  heroAction: {
    flex: 1,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  glanceGrid: {
    gap: Spacing.md,
  },
  glanceCard: {
    gap: Spacing.sm,
  },
  glanceTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
});
