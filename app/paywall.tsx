import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, hydrateAlarmRuntimeForCurrentUser, readAlarmStore } from '@/lib/alarms';
import { Alarm } from '@/types/alarm';

type PaywallState = {
  alarms: Alarm[];
  lifetimeAlarmCreations: number;
};

export default function PaywallScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<PaywallState>({
    alarms: [],
    lifetimeAlarmCreations: 0,
  });

  const loadPaywallState = useCallback(async () => {
    setIsLoading(true);

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const store = await readAlarmStore();

      setState({
        alarms: store.alarms,
        lifetimeAlarmCreations: store.lifetimeAlarmCreations,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPaywallState();
    }, [loadPaywallState])
  );

  const activeAlarmCount = state.alarms.length;

  return (
    <AppScreen>
      <PageHeader
        badgeLabel="Unlimited"
        badgeTone="success"
        eyebrow="Checkpoints"
        title="Checkpoint limits are removed."
        description="Create as many saved proof routines as you need."
      />

      {isLoading ? (
        <LoadingBlock
          description="Checking your saved checkpoints and current usage."
          title="Loading limit details"
          tone="canvas"
        />
      ) : (
        <>
          <AppCard elevated tone="success" style={styles.heroCard}>
            <View style={styles.heroHeader}>
              <View style={styles.heroCopy}>
                <Text style={[TextPresets.eyebrow, { color: colors.success }]}>No active cap</Text>
                <Text style={[styles.heroTitle, { color: colors.text }]}>You can keep building checkpoints.</Text>
                <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                  Saved checkpoints still work as before, and creating a new one no longer stops at three.
                </Text>
              </View>
              <StatusPill label="Open" tone="success" />
            </View>

            <View style={styles.metricGrid}>
              <UsageMetric colors={colors} helper="Total saves" label="Created" value={`${state.lifetimeAlarmCreations}`} />
              <UsageMetric colors={colors} helper="Saved right now" label="Active" value={`${activeAlarmCount}`} />
              <UsageMetric colors={colors} helper="New saves left" label="Left" value="∞" />
            </View>
          </AppCard>

          <AppCard elevated tone="canvas">
            <SectionHeader
              kicker="What changed"
              title="No checkpoint ceiling"
              description="This screen is kept as a status page in case an old route sends you here."
            />

            <View style={styles.noteList}>
              <InfoRow
                body="Create, edit, reuse, reschedule, and delete checkpoints without a preview save cap."
                colors={colors}
                title="Create freely"
              />
              <InfoRow
                body="Your existing local checkpoint data is unchanged."
                colors={colors}
                title="Existing data stays"
              />
              <InfoRow
                body={
                  state.alarms[0]
                    ? `Your next saved checkpoint is ${formatAlarmTime(state.alarms[0].hour, state.alarms[0].minute)}.`
                    : 'You can return to Today or your checkpoint library now.'
                }
                colors={colors}
                title="What is next"
              />
            </View>
          </AppCard>

          <View style={styles.buttonGroup}>
            <AppButton
              label="Create another checkpoint"
              onPress={() => router.replace('/create')}
            />
            <AppButton label="Back to today" onPress={() => router.replace('/')} variant="secondary" />
          </View>
        </>
      )}
    </AppScreen>
  );
}

function UsageMetric({
  label,
  value,
  helper,
  colors,
}: {
  label: string;
  value: string;
  helper: string;
  colors: ReturnType<typeof getAppColors>;
}) {
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[TextPresets.body, { color: colors.muted }]}>{helper}</Text>
    </View>
  );
}

function InfoRow({
  title,
  body,
  colors,
}: {
  title: string;
  body: string;
  colors: ReturnType<typeof getAppColors>;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoDot, { backgroundColor: colors.primary }]} />
      <View style={styles.infoCopy}>
        <Text style={[TextPresets.label, { color: colors.text }]}>{title}</Text>
        <Text style={[TextPresets.body, { color: colors.muted }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    gap: Spacing.lg,
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  heroTitle: {
    ...TextPresets.titleLg,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  metricCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: 120,
    flexGrow: 1,
    gap: Spacing.xs,
    minHeight: 96,
    padding: Spacing.md,
  },
  metricValue: {
    ...TextPresets.title,
    fontSize: 24,
    lineHeight: 30,
  },
  noteList: {
    gap: Spacing.md,
  },
  infoRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  infoDot: {
    borderRadius: Radius.pill,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  infoCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  alarmList: {
    gap: Spacing.sm,
  },
  alarmRow: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  alarmCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  actionCard: {
    gap: Spacing.lg,
  },
  buttonGroup: {
    gap: Spacing.sm,
  },
});
