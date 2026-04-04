import { useEffect, useMemo, useState } from 'react';
import { DimensionValue, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { SectionHeader } from '@/components/ui/section-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Radius, Spacing, TextPresets, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readAlarmStore } from '@/lib/alarms';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { Alarm, SuccessHistoryEntry } from '@/types/alarm';

type SuccessState = {
  currentStreak: number;
  longestStreak: number;
  summary: ProgressSummary;
  successEntry: SuccessHistoryEntry | null;
  shareStatus: SuccessShareStatus | null;
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
      copy: 'This result was saved only to your account.',
    };
  }

  if (queuedEvent) {
    return {
      tone: 'queued',
      title: 'Queued',
      copy: queuedEvent.lastSyncError
        ? 'Sharing hit a sync issue and will retry automatically.'
        : 'This result is waiting to sync to your circle.',
    };
  }

  return {
    tone: 'shared',
    title: 'Shared',
    copy: 'This result is already available in your circle.',
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

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string; label?: string }>();
  const colors = getAppColors(useColorScheme());
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  useEffect(() => {
    const loadProgress = async () => {
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
      });
    };

    void loadProgress();
  }, [params.alarmId]);

  const progressWidth = useMemo(() => {
    if (!successState) {
      return '8%' as DimensionValue;
    }

    return `${Math.max(8, Math.round(successState.summary.milestoneProgress.progressRatio * 100))}%` as DimensionValue;
  }, [successState]);

  const badgeList = successState?.summary.activeBadges ?? [];
  const shareTone = getShareTone(successState?.shareStatus?.tone);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <AppCard elevated tone="success" style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.success }]}>Alarm cleared</Text>
              <Text style={[styles.title, { color: colors.text }]}>On time.</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                {params.label
                  ? `${params.label} was cleared in time.`
                  : 'The QR code matched before the timer expired.'}
              </Text>
            </View>
            <StatusPill label="Validated" tone="success" />
          </View>

          <View style={[styles.heroPanel, { backgroundColor: colors.elevated, borderColor: colors.success }]}>
            <Text style={[TextPresets.label, { color: colors.muted }]}>Current level</Text>
            <Text style={[styles.heroValue, { color: colors.text }]}>
              {successState?.summary.checkpointTitle ?? 'Getting Started'}
            </Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              {successState?.summary.nextGoalCopy ?? 'Keep going to reach the next level.'}
            </Text>
          </View>
        </AppCard>

        <SectionHeader
          kicker="Result"
          title="This run"
          description="What counted and what changed."
        />

        <View style={styles.statGrid}>
          <StatTile label="Current streak" tone="primary" value={`${successState?.currentStreak ?? '--'}`} />
          <StatTile label="Best streak" value={`${successState?.longestStreak ?? '--'}`} />
          <StatTile
            helper={successState?.successEntry ? 'Time from ring to valid QR scan' : undefined}
            label="Time to scan"
            tone="success"
            value={formatTimeToScan(successState?.successEntry ?? null)}
          />
        </View>

        {successState?.shareStatus ? (
          <AppCard elevated tone={shareTone === 'success' ? 'success' : shareTone === 'primary' ? 'primary' : 'default'}>
            <View style={styles.shareHeader}>
              <SectionHeader
                title="Social result"
                description={successState.shareStatus.copy}
              />
              <StatusPill
                label={successState.shareStatus.tone === 'shared' ? 'Delivered' : successState.shareStatus.tone === 'queued' ? 'Queued' : 'Private'}
                tone={shareTone}
              />
            </View>
            <Text style={[styles.shareTitle, { color: shareTone === 'success' ? colors.success : shareTone === 'primary' ? colors.primary : colors.text }]}>
              {successState.shareStatus.title}
            </Text>
          </AppCard>
        ) : null}

        <AppCard elevated>
          <SectionHeader
            kicker="Progress"
            title="Progress"
            description={
              successState?.summary.nextStreakMilestone
                ? `Next up: ${successState.summary.nextStreakMilestone.title}`
                : 'You are in the highest streak tier.'
            }
          />
          <Text style={[styles.milestoneTitle, { color: colors.primary }]}>
            {successState?.summary.currentStreakMilestone?.title ??
              successState?.summary.milestoneProgress.currentLabel ??
              'Getting Started'}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: progressWidth }]} />
          </View>
          <Text style={[TextPresets.body, { color: colors.muted }]}>
            {successState?.summary.nextGoalCopy ?? 'Keep going to reach the next level.'}
          </Text>
        </AppCard>

        <AppCard elevated>
          <SectionHeader
            kicker="Badges"
            title="Recent badges"
            description="Small progress markers."
          />
          <View style={styles.badgeList}>
            {(badgeList.length > 0
              ? badgeList
              : [
                  {
                    id: 'showed-up',
                    label: 'Cleared',
                    description: 'You finished before the timer ran out.',
                  },
                ]
            ).map((badge) => (
              <View
                key={badge.id}
                style={[
                  styles.badgeChip,
                  {
                    backgroundColor: colors.elevated,
                    borderColor: colors.border,
                  },
                ]}>
                <Text style={[TextPresets.label, { color: colors.primary }]}>{badge.label}</Text>
                <Text style={[TextPresets.body, { color: colors.muted }]}>{badge.description}</Text>
              </View>
            ))}
          </View>
        </AppCard>

        <AppButton label="Back to today" onPress={() => router.replace('/')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
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
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 40,
  },
  heroPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.lg,
  },
  heroValue: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  shareHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  shareTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  milestoneTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
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
  badgeList: {
    gap: Spacing.sm,
  },
  badgeChip: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
  },
});
