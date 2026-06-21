import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowIconBadge,
  FlowListRow,
  FlowPanel,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { AlarmStore } from '@/types/alarm';

type TodayActivityEvent = {
  id: string;
  alarmId: string;
  description: string;
  resolvedAt: string;
  statusLabel: string;
  statusTone: 'success' | 'danger';
  title: string;
  type: 'cleared' | 'missed';
};

function isSameLocalDay(timestamp: string, day = new Date()) {
  const date = new Date(timestamp);

  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function formatEventTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getTodayActivityEvents(store: AlarmStore): TodayActivityEvent[] {
  const clears = store.successHistory
    .filter((entry) => isSameLocalDay(entry.confirmedAt))
    .map<TodayActivityEvent>((entry) => ({
      alarmId: entry.alarmId,
      description: `Cleared in ${entry.timeToScanSeconds}s`,
      id: `clear-${entry.alarmId}-${entry.confirmedAt}`,
      resolvedAt: entry.confirmedAt,
      statusLabel: 'Cleared',
      statusTone: 'success',
      title: entry.label,
      type: 'cleared',
    }));
  const misses = store.failureHistory
    .filter((entry) => isSameLocalDay(entry.failedAt))
    .map<TodayActivityEvent>((entry) => ({
      alarmId: entry.alarmId,
      description: 'Missed before the saved proof matched',
      id: `miss-${entry.alarmId}-${entry.failedAt}`,
      resolvedAt: entry.failedAt,
      statusLabel: 'Missed',
      statusTone: 'danger',
      title: entry.label,
      type: 'missed',
    }));

  return [...clears, ...misses].sort(
    (left, right) => new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime()
  );
}

export default function TodayActivityScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const hasLoadedActivityRef = useRef(false);
  const loadActivityRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [store, setStore] = useState<AlarmStore | null>(null);

  const loadActivity = useCallback(async () => {
    const requestId = loadActivityRequestRef.current + 1;
    loadActivityRequestRef.current = requestId;

    if (!hasLoadedActivityRef.current) {
      setIsLoading(true);
    }

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const nextStore = await readAlarmStore();
      if (loadActivityRequestRef.current === requestId) {
        setStore(nextStore);
      }
    } finally {
      if (loadActivityRequestRef.current === requestId) {
        hasLoadedActivityRef.current = true;
        setIsLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadActivity();
    }, [loadActivity])
  );

  const events = useMemo(() => (store ? getTodayActivityEvents(store) : []), [store]);
  const clears = events.filter((event) => event.type === 'cleared').length;
  const misses = events.filter((event) => event.type === 'missed').length;

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock
          description="Collecting today’s clears and misses."
          layout="list"
          title="Loading today"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
      <FlowTopBar
        leftAccessibilityLabel="Go back"
        leftLabel="Back"
        onLeftPress={() => router.back()}
        title="Today's Activity"
      />

      <FlowPanel style={styles.summaryPanel}>
        <View style={styles.summaryHeader}>
          <FlowIconBadge icon="calendar-outline" size="large" tone="muted" />
          <View style={styles.summaryCopy}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>Today’s checkpoint outcomes</Text>
            <Text style={[styles.summaryBody, { color: colors.textSoft }]}>
              {clears} cleared · {misses} missed
            </Text>
          </View>
        </View>
      </FlowPanel>

      {events.length === 0 ? (
        <EmptyState
          actionLabel="Back to today"
          description="Clears and misses from today will appear here as checkpoints resolve."
          onAction={() => router.replace('/')}
          title="No outcomes yet today"
          tone="primary"
        />
      ) : (
        <FlowPanel style={styles.eventsPanel}>
          <FlowSectionLabel>RESOLVED TODAY</FlowSectionLabel>
          {events.map((event) => (
            <FlowListRow
              description={`${event.description} · ${formatEventTime(event.resolvedAt)}`}
              key={event.id}
              leading={
                <FlowIconBadge
                  icon={event.type === 'cleared' ? 'checkmark' : 'close'}
                  size="small"
                  tone={event.type === 'cleared' ? 'success' : 'danger'}
                />
              }
              onPress={() =>
                router.push(event.type === 'missed' ? `/missed?alarmId=${event.alarmId}` : `/checkpoint/${event.alarmId}`)
              }
              statusLabel={event.statusLabel}
              statusTone={event.statusTone}
              style={styles.inlineFlowRow}
              title={event.title}
            />
          ))}
        </FlowPanel>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 10,
    paddingBottom: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  summaryPanel: {
    padding: 12,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  summaryTitle: {
    fontFamily: Fonts.serif,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  summaryBody: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
  eventsPanel: {
    gap: 8,
  },
  inlineFlowRow: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 0,
    paddingHorizontal: 2,
  },
});
