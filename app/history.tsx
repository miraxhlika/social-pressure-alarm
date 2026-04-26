import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { AlarmStore } from '@/types/alarm';

type HistoryState = {
  store: AlarmStore | null;
  summary: ProgressSummary | null;
};

type HistoryEvent = {
  id: string;
  alarmId: string;
  title: string;
  detail: string;
  resolvedAt: string;
  tone: 'success' | 'danger';
  label: string;
};

function formatShortDate(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getHistoryEvents(store: AlarmStore): HistoryEvent[] {
  const successes = store.successHistory.map<HistoryEvent>((entry) => ({
    id: `success-${entry.alarmId}-${entry.confirmedAt}`,
    alarmId: entry.alarmId,
    title: entry.label,
    detail: `Cleared in ${entry.timeToScanSeconds}s`,
    resolvedAt: entry.confirmedAt,
    tone: 'success',
    label: 'Cleared',
  }));
  const failures = store.failureHistory.map<HistoryEvent>((entry) => ({
    id: `failure-${entry.alarmId}-${entry.failedAt}`,
    alarmId: entry.alarmId,
    title: entry.label,
    detail: 'Missed before proof matched',
    resolvedAt: entry.failedAt,
    tone: 'danger',
    label: 'Missed',
  }));

  return [...successes, ...failures].sort(
    (left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime()
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<HistoryState>({ store: null, summary: null });

  const loadHistory = useCallback(async () => {
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();
      setState({ store, summary: getProgressSummary(store) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory])
  );

  const events = useMemo(() => (state.store ? getHistoryEvents(state.store) : []), [state.store]);
  const weeklyStats = state.summary?.weeklyStats;
  const weeklyReview = state.summary?.weeklyReview;

  if (isLoading) {
    return (
      <AppScreen>
        <LoadingBlock title="Loading history" description="Building your clears, misses, and weekly review." />
      </AppScreen>
    );
  }

  if (!state.store || events.length === 0) {
    return (
      <AppScreen>
        <PageHeader
          eyebrow="History"
          title="History starts after the first live run."
          description="Clears, misses, reliability, and category performance will appear here once a checkpoint resolves."
        />
        <EmptyState
          actionLabel="Back to today"
          description="Create or run a checkpoint to start building proof history."
          onAction={() => router.replace('/')}
          title="No history yet"
          tone="primary"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <PageHeader
        badgeLabel={`${events.length} event${events.length === 1 ? '' : 's'}`}
        badgeTone="primary"
        eyebrow="History"
        title="Proof history"
        description="Review weekly reliability, misses, clear speed, category performance, and recent checkpoint events."
      />

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{weeklyReview?.title ?? 'Weekly review'}</Text>
        <Text style={[TextPresets.body, { color: colors.textSoft }]}>
          {weeklyReview?.body ?? 'More runs are needed before there is a useful weekly insight.'}
        </Text>
        <View style={styles.statRow}>
          <StatTile
            helper={weeklyStats?.attempts ? `${weeklyStats.successes}/${weeklyStats.attempts} cleared` : 'No attempts this week'}
            label="Reliability"
            progress={weeklyStats?.attempts ? weeklyStats.completionRate / 100 : 0}
            progressLabel="Weekly reliability progress"
            tone="primary"
            value={weeklyStats?.attempts ? `${weeklyStats.completionRate}%` : '—'}
          />
          <StatTile
            helper={weeklyStats?.averageTimeToClearSeconds === null ? 'No clear-time baseline' : 'Average time to proof'}
            label="Clear speed"
            tone="success"
            value={weeklyStats?.averageTimeToClearSeconds === null ? '—' : `${weeklyStats?.averageTimeToClearSeconds}s`}
          />
        </View>
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Category performance</Text>
        {state.summary?.useCaseReliability.length ? (
          <View style={styles.categoryRows}>
            {state.summary.useCaseReliability.map((entry) => (
              <View key={entry.useCaseType} style={[styles.categoryRow, { borderColor: colors.line }]}>
                <View style={styles.categoryCopy}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{entry.label}</Text>
                  <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                    {entry.successes}/{entry.attempts} cleared
                    {entry.averageTimeToClearSeconds === null ? '' : ` · avg ${entry.averageTimeToClearSeconds}s`}
                  </Text>
                </View>
                <StatusPill label={`${entry.completionRate}%`} tone={entry.failures > 0 ? 'warning' : 'success'} />
              </View>
            ))}
          </View>
        ) : (
          <Text style={[TextPresets.body, { color: colors.textSoft }]}>
            Category performance appears after at least one checkpoint resolves this week.
          </Text>
        )}
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent activity</Text>
        <View style={styles.eventRows}>
          {events.map((event) => (
            <Pressable
              key={event.id}
              accessibilityHint="Opens checkpoint details for this history event."
              accessibilityLabel={`${event.label}: ${event.title}. ${event.detail}. ${formatShortDate(event.resolvedAt)}.`}
              accessibilityRole="button"
              onPress={() => router.push(`/checkpoint/${event.alarmId}`)}
              style={({ pressed }) => [
                styles.eventRow,
                { borderColor: colors.line, opacity: pressed ? 0.82 : 1 },
              ]}>
              <View style={[styles.eventDot, { backgroundColor: event.tone === 'success' ? colors.success : colors.danger }]} />
              <View style={styles.eventCopy}>
                <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{formatShortDate(event.resolvedAt)}</Text>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{event.title}</Text>
                <Text style={[TextPresets.body, { color: colors.textSoft }]}>{event.detail}</Text>
              </View>
              <StatusPill label={event.label} tone={event.tone} />
            </Pressable>
          ))}
        </View>
      </AppCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    gap: Spacing.md,
  },
  sectionTitle: {
    ...TextPresets.title,
    fontSize: 22,
    lineHeight: 28,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  categoryRows: {
    gap: Spacing.sm,
  },
  categoryRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  categoryCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  rowTitle: {
    ...TextPresets.label,
    fontSize: 16,
  },
  eventRows: {
    gap: Spacing.sm,
  },
  eventRow: {
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  eventDot: {
    borderRadius: Radius.pill,
    height: 10,
    marginTop: 7,
    width: 10,
  },
  eventCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
});
