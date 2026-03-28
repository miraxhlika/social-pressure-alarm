import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAlarmPhase, formatAlarmTime, formatRepeatSchedule, formatScheduledFor } from '@/lib/alarms';
import { getAppColors } from '@/constants/theme';
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
  ringing: 'Scan checkpoint',
  scheduled: 'Scheduled',
  unscheduled: 'Draft',
} as const;

export function AlarmCard({ alarm, onDelete, onEdit, onReschedule, onReuse }: AlarmCardProps) {
  const colors = getAppColors(useColorScheme());
  const phase = getAlarmPhase(alarm);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}>
      <View style={styles.row}>
        <Text style={[styles.time, { color: colors.text }]}>
          {formatAlarmTime(alarm.hour, alarm.minute)}
        </Text>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: phase === 'missed' ? `${colors.danger}20` : `${colors.primary}18`,
            },
          ]}>
          <Text
            style={[
              styles.badgeText,
              {
                color: phase === 'missed' ? colors.danger : colors.primary,
              },
            ]}>
            {STATUS_COPY[phase]}
          </Text>
        </View>
      </View>

      <Text style={[styles.label, { color: colors.text }]}>{alarm.label}</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        QR payload: {alarm.expectedQrPayload || 'Needs update'}
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Grace period: {alarm.gracePeriodSeconds} seconds
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Repeat: {formatRepeatSchedule(alarm.repeatSchedule)}
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Next trigger: {formatScheduledFor(alarm.scheduledFor)}
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Last run: {alarm.lastOutcome === 'missed' ? 'Missed' : alarm.lastOutcome === 'confirmed' ? 'Cleared' : 'Not completed yet'}
      </Text>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onEdit(alarm)}
          style={[styles.utilityButton, { borderColor: colors.border }]}>
          <Text style={[styles.utilityButtonText, { color: colors.text }]}>Edit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onReschedule(alarm)}
          style={[styles.utilityButton, { borderColor: colors.border }]}>
          <Text style={[styles.utilityButtonText, { color: colors.text }]}>Reschedule</Text>
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onReuse(alarm)}
          style={[styles.utilityButton, { borderColor: colors.border }]}>
          <Text style={[styles.utilityButtonText, { color: colors.text }]}>Reuse</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDelete(alarm)}
          style={[styles.utilityButton, { borderColor: colors.border }]}>
          <Text style={[styles.utilityButtonText, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 28,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
  },
  meta: {
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  utilityButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginTop: 8,
    paddingVertical: 12,
  },
  utilityButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
