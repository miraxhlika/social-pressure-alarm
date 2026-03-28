import { useEffect, useMemo, useState } from 'react';
import { DimensionValue, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import { readAlarmStore } from '@/lib/alarms';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SuccessHistoryEntry } from '@/types/alarm';

type SuccessState = {
  currentStreak: number;
  longestStreak: number;
  summary: ProgressSummary;
  successEntry: SuccessHistoryEntry | null;
};

function formatTimeToScan(successEntry: SuccessHistoryEntry | null) {
  if (!successEntry) {
    return '--';
  }

  return `${successEntry.timeToScanSeconds}s`;
}

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string; label?: string }>();
  const colors = getAppColors(useColorScheme());
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  useEffect(() => {
    const loadProgress = async () => {
      const store = await readAlarmStore();
      const summary = getProgressSummary(store);
      const successEntry =
        store.successHistory.find((entry) => entry.alarmId === params.alarmId) ?? summary.latestSuccess;

      setSuccessState({
        currentStreak: store.currentStreak,
        longestStreak: store.longestStreak,
        summary,
        successEntry,
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.kicker, { color: colors.success }]}>QR validated</Text>
        <Text style={[styles.title, { color: colors.text }]}>Checkpoint cleared.</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {params.label
            ? `The ${params.label} checkpoint was scanned in time. Your streak keeps going.`
            : 'The correct QR checkpoint was scanned before the timer expired.'}
        </Text>

        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.heroLabel, { color: colors.muted }]}>Checkpoint title</Text>
          <Text style={[styles.heroValue, { color: colors.text }]}>
            {successState?.summary.checkpointTitle ?? 'Rookie Scanner'}
          </Text>
          <Text style={[styles.heroHelp, { color: colors.muted }]}>
            {successState?.summary.nextGoalCopy ?? 'Keep stacking clears to unlock the next milestone.'}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {successState?.currentStreak ?? '--'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Current streak</Text>
          </View>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {successState?.longestStreak ?? '--'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Best streak</Text>
          </View>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {formatTimeToScan(successState?.successEntry ?? null)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Time to scan</Text>
          </View>
        </View>

        <View
          style={[
            styles.milestoneCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Milestone progress</Text>
          <Text style={[styles.milestoneTitle, { color: colors.primary }]}>
            {successState?.summary.currentStreakMilestone?.title ??
              successState?.summary.milestoneProgress.currentLabel ??
              'Rookie Scanner'}
          </Text>
          <Text style={[styles.milestoneSubtitle, { color: colors.muted }]}>
            {successState?.summary.nextStreakMilestone
              ? `Next up: ${successState.summary.nextStreakMilestone.title}`
              : 'You have cleared every currently defined streak milestone.'}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: progressWidth }]} />
          </View>
          <Text style={[styles.progressCopy, { color: colors.muted }]}>
            {successState?.summary.nextGoalCopy ?? 'Keep going to unlock the next reward tier.'}
          </Text>
        </View>

        <View
          style={[
            styles.badgesCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Unlocked today</Text>
          <View style={styles.badgeList}>
            {(badgeList.length > 0
              ? badgeList
              : [
                  {
                    id: 'showed-up',
                    label: 'Showed Up',
                    description: 'You cleared the checkpoint before the timer hit zero.',
                  },
                ]
            ).map((badge) => (
              <View key={badge.id} style={[styles.badgeChip, { backgroundColor: `${colors.primary}14` }]}>
                <Text style={[styles.badgeLabel, { color: colors.primary }]}>{badge.label}</Text>
                <Text style={[styles.badgeDescription, { color: colors.muted }]}>
                  {badge.description}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
            Back Home
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 24,
    paddingBottom: 40,
  },
  kicker: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    lineHeight: 42,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  heroCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  heroValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  heroHelp: {
    fontSize: 14,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    padding: 16,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  milestoneCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  milestoneTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  milestoneSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  progressTrack: {
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressCopy: {
    fontSize: 14,
    lineHeight: 20,
  },
  badgesCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  badgeList: {
    gap: 10,
  },
  badgeChip: {
    borderRadius: 18,
    gap: 4,
    padding: 14,
  },
  badgeLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  badgeDescription: {
    fontSize: 13,
    lineHeight: 18,
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
});
