import { StyleSheet, Text, View } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { AppButton } from '@/components/ui/app-button';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, getAppColors, Spacing, TextPresets, Type } from '@/constants/theme';
import { getAlarmPhase, formatAlarmTime, formatRepeatSchedule, formatScheduledFor } from '@/lib/alarms';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

type AlarmCardProps = {
  alarm: Alarm;
  onEdit: (alarm: Alarm) => void;
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

export function AlarmCard({ alarm, onDelete, onEdit, onReschedule, onReuse }: AlarmCardProps) {
  const colors = getAppColors(useColorScheme());
  const phase = getAlarmPhase(alarm);
  const sharesToCircle = Boolean(
    alarm.socialSettings?.circleId && (alarm.socialSettings.shareSuccesses || alarm.socialSettings.shareMisses)
  );

  return (
    <AppCard elevated style={styles.card}>
      <View style={styles.header}>
        <View style={styles.timeBlock}>
          <Text style={[styles.time, { color: colors.text }]}>{formatAlarmTime(alarm.hour, alarm.minute)}</Text>
          <Text style={[TextPresets.body, { color: colors.muted }]}>
            {formatRepeatSchedule(alarm.repeatSchedule)}
          </Text>
        </View>
        <StatusPill label={STATUS_COPY[phase]} tone={STATUS_TONES[phase]} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.label, { color: colors.text }]}>{alarm.label}</Text>
        <Text numberOfLines={1} style={[TextPresets.body, { color: colors.textSoft }]}>
          QR checkpoint: {alarm.expectedQrPayload || 'Needs update'}
        </Text>
      </View>

      <View style={styles.metaGrid}>
        <View style={[styles.metaChip, { backgroundColor: colors.cardMuted, borderColor: colors.border }]}>
          <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Grace</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{alarm.gracePeriodSeconds}s</Text>
        </View>
        <View style={[styles.metaChip, styles.metaChipWide, { backgroundColor: colors.cardMuted, borderColor: colors.border }]}>
          <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Next trigger</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{formatScheduledFor(alarm.scheduledFor)}</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <Text style={[TextPresets.body, { color: colors.muted }]}>
          Last run:{' '}
          {alarm.lastOutcome === 'missed'
            ? 'Missed'
            : alarm.lastOutcome === 'confirmed'
              ? 'Cleared'
              : 'Not completed yet'}
        </Text>
        {sharesToCircle ? <StatusPill label="Circle" tone="primary" /> : null}
      </View>

      <View style={styles.actions}>
        <AppButton
          label="Edit"
          onPress={() => onEdit(alarm)}
          size="compact"
          style={styles.actionButton}
          variant="secondary"
        />
        <AppButton
          label="Reschedule"
          onPress={() => onReschedule(alarm)}
          size="compact"
          style={styles.actionButton}
          variant="secondary"
        />
      </View>

      <View style={styles.actions}>
        <AppButton
          label="Reuse"
          onPress={() => onReuse(alarm)}
          size="compact"
          style={styles.actionButton}
          variant="ghost"
        />
        <AppButton
          label="Delete"
          onPress={() => onDelete(alarm)}
          size="compact"
          style={styles.actionButton}
          variant="danger"
        />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  timeBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  time: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  body: {
    gap: Spacing.xs,
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  metaChip: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    minHeight: 72,
    padding: Spacing.md,
  },
  metaChipWide: {
    flex: 1,
  },
  metaValue: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
