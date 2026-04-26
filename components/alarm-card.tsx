import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { AppButton } from '@/components/ui/app-button';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Spacing, TextPresets } from '@/constants/theme';
import { formatGracePeriodLabel, getUseCaseShortLabel } from '@/lib/checkpoint-templates';
import { getAlarmPhase, formatAlarmTime, formatRepeatSchedule, formatScheduledFor } from '@/lib/alarms';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

type AlarmCardProps = {
  alarm: Alarm;
  onEdit: (alarm: Alarm) => void;
  onDetails: (alarm: Alarm) => void;
  onOpen: (alarm: Alarm) => void;
  onReschedule: (alarm: Alarm) => void;
  onReuse: (alarm: Alarm) => void;
  onDelete: (alarm: Alarm) => void;
};

const STATUS_COPY = {
  inactive: 'Cleared',
  missed: 'Missed',
  ringing: 'Scan now',
  scheduled: 'Scheduled',
  unscheduled: 'Draft',
} as const;

const STATUS_TONES = {
  inactive: 'default',
  missed: 'danger',
  ringing: 'warning',
  scheduled: 'primary',
  unscheduled: 'default',
} as const;

function getPrimaryActionLabel(phase: keyof typeof STATUS_COPY) {
  return phase === 'missed' || phase === 'inactive' ? 'Reschedule' : phase === 'ringing' ? 'Open live run' : 'Adjust';
}

function getLastOutcomeCopy(alarm: Alarm) {
  if (alarm.lastOutcome === 'missed') {
    return 'Last run missed';
  }

  if (alarm.lastOutcome === 'confirmed') {
    return 'Last run cleared';
  }

  return 'Awaiting first result';
}

export function AlarmCard({ alarm, onDelete, onDetails, onEdit, onOpen, onReschedule, onReuse }: AlarmCardProps) {
  const colors = getAppColors(useColorScheme());
  const phase = getAlarmPhase(alarm);
  const sharesToCircle = Boolean(
    alarm.socialSettings?.circleId && (alarm.socialSettings.shareSuccesses || alarm.socialSettings.shareMisses)
  );
  const primaryActionLabel = getPrimaryActionLabel(phase);
  const primaryAction =
    phase === 'missed' || phase === 'inactive'
      ? () => onReschedule(alarm)
      : phase === 'ringing'
        ? () => onOpen(alarm)
        : () => onEdit(alarm);
  const secondaryActionLabel = phase === 'ringing' ? 'Adjust' : 'Reuse';
  const secondaryAction = phase === 'ringing' ? () => onEdit(alarm) : () => onReuse(alarm);
  const accountabilityLabel = sharesToCircle ? 'Accountability on' : 'Private';

  return (
    <AppCard elevated style={styles.card}>
      <View style={styles.header}>
        <Text style={[styles.time, { color: colors.text }]}>{formatAlarmTime(alarm.hour, alarm.minute)}</Text>
        <StatusPill label={STATUS_COPY[phase]} tone={STATUS_TONES[phase]} />
      </View>

      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.text }]}>{alarm.label}</Text>
        {alarm.placeObject ? (
          <Text style={[styles.placeObject, { color: colors.primary }]}>Proof place: {alarm.placeObject}</Text>
        ) : null}
        <Text style={[TextPresets.body, { color: colors.textSoft }]}>
          {getUseCaseShortLabel(alarm.useCaseType)} · {formatRepeatSchedule(alarm.repeatSchedule)}
        </Text>
        <Text style={[styles.scheduleText, { color: colors.muted }]}>Next run {formatScheduledFor(alarm.scheduledFor)}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaText, { color: colors.muted }]}>
          {formatGracePeriodLabel(alarm.gracePeriodSeconds)} reach window · {getLastOutcomeCopy(alarm)}
        </Text>
        <Text style={[styles.circleMeta, { color: sharesToCircle ? colors.primary : colors.muted }]}>{accountabilityLabel}</Text>
      </View>

      <View style={styles.actionRow}>
        <AppButton label={primaryActionLabel} onPress={primaryAction} size="compact" style={styles.primaryAction} />
        <AppButton
          label={secondaryActionLabel}
          onPress={secondaryAction}
          size="compact"
          style={styles.secondaryAction}
          variant="secondary"
        />
      </View>

      <View style={[styles.utilityRow, { borderTopColor: colors.line ?? colors.border }]}>
        <UtilityAction
          accessibilityHint={`Opens schedule, proof, and history details for ${alarm.label}.`}
          accessibilityLabel={`View details for ${alarm.label}`}
          color={colors.primary}
          label="Details"
          onPress={() => onDetails(alarm)}
        />
        <UtilityAction
          accessibilityHint={`Deletes ${alarm.label}. This action cannot be undone.`}
          accessibilityLabel={`Delete ${alarm.label}`}
          color={colors.danger}
          label="Delete"
          onPress={() => onDelete(alarm)}
        />
      </View>
    </AppCard>
  );
}

function UtilityAction({
  accessibilityHint,
  accessibilityLabel,
  label,
  onPress,
  color,
}: {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.utilityAction}>
      <Text style={[styles.utilityLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    gap: Spacing.xs,
    minWidth: 0,
  },
  time: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  scheduleText: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  placeObject: {
    ...TextPresets.label,
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  metaText: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  circleMeta: {
    ...TextPresets.label,
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  primaryAction: {
    flexBasis: 160,
    flex: 1.2,
  },
  secondaryAction: {
    flexBasis: 132,
    flex: 1,
  },
  utilityRow: {
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
    justifyContent: 'flex-end',
    paddingTop: Spacing.xs,
  },
  utilityAction: {
    paddingVertical: 6,
  },
  utilityLabel: {
    ...TextPresets.label,
    fontSize: 13,
  },
});
