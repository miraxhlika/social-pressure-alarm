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
import { Alarm, FREE_ALARM_LIMIT } from '@/types/alarm';

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

  const usedSlots = Math.min(state.lifetimeAlarmCreations, FREE_ALARM_LIMIT);
  const activeAlarmCount = state.alarms.length;
  const canCreateAnother = state.lifetimeAlarmCreations < FREE_ALARM_LIMIT;

  return (
    <AppScreen>
      <PageHeader
        badgeLabel={`${usedSlots}/${FREE_ALARM_LIMIT}`}
        badgeTone={canCreateAnother ? 'warning' : 'danger'}
        eyebrow="Checkpoint limit"
        title={canCreateAnother ? 'You still have room for another checkpoint.' : 'This preview build has reached its checkpoint limit.'}
        description="A local preview rule, not a checkout."
      />

      {isLoading ? (
        <LoadingBlock
          description="Checking your saved checkpoints and current usage."
          title="Loading limit details"
          tone="canvas"
        />
      ) : (
        <>
          <AppCard elevated tone="primary" style={styles.heroCard}>
            <View style={styles.heroHeader}>
              <View style={styles.heroCopy}>
                <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Current build rule</Text>
                <Text style={[styles.heroTitle, { color: colors.text }]}>
                  {canCreateAnother ? 'You can keep building for now.' : 'Your saved checkpoints still keep working.'}
                </Text>
                <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                  {canCreateAnother
                    ? `This preview build allows ${FREE_ALARM_LIMIT} total checkpoint saves on this device.`
                    : 'You can still edit, reuse, reschedule, and delete the checkpoints already on this device.'}
                </Text>
              </View>
              <StatusPill label={canCreateAnother ? 'Preview limit' : 'Limit reached'} tone={canCreateAnother ? 'warning' : 'danger'} />
            </View>

            <View style={styles.metricGrid}>
              <UsageMetric colors={colors} helper="Total saves" label="Used" value={`${usedSlots}`} />
              <UsageMetric colors={colors} helper="Saved right now" label="Active" value={`${activeAlarmCount}`} />
              <UsageMetric
                colors={colors}
                helper="New saves left"
                label="Left"
                value={`${Math.max(0, FREE_ALARM_LIMIT - state.lifetimeAlarmCreations)}`}
              />
            </View>
          </AppCard>

          <AppCard elevated tone="canvas">
            <SectionHeader
              kicker="What it means"
              title="No hidden checkout"
              description="This page explains the rule and sends you somewhere useful."
            />

            <View style={styles.noteList}>
              <InfoRow
                body="There is no payment flow behind this screen."
                colors={colors}
                title="No checkout"
              />
              <InfoRow
                body="Deleting a checkpoint does not reopen a slot because the cap is based on total saves in this build."
                colors={colors}
                title="Why a slot may stay used"
              />
              <InfoRow
                body={
                  state.alarms[0]
                    ? `Your next saved checkpoint is ${formatAlarmTime(state.alarms[0].hour, state.alarms[0].minute)}.`
                    : 'You can return to Today or your checkpoint library now.'
                }
                colors={colors}
                title="What still works"
              />
            </View>
          </AppCard>

          <View style={styles.buttonGroup}>
            <AppButton
              label={canCreateAnother ? 'Create another checkpoint' : 'Manage checkpoints'}
              onPress={() => router.replace(canCreateAnother ? '/create' : '/alarms')}
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
