import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAlarmPhase, formatAlarmTime, formatScheduledFor } from '@/lib/alarms';
import { getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

type AlarmCardProps = {
  alarm: Alarm;
  onDelete: (alarm: Alarm) => void;
};

const STATUS_COPY = {
  inactive: 'Completed',
  missed: 'Missed',
  ringing: 'Needs confirmation',
  scheduled: 'Scheduled',
  unscheduled: 'Draft',
} as const;

export function AlarmCard({ alarm, onDelete }: AlarmCardProps) {
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

      <Text style={[styles.contactName, { color: colors.text }]}>{alarm.contactName}</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>{alarm.phoneNumber}</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Grace period: {alarm.gracePeriodSeconds} seconds
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        Next trigger: {formatScheduledFor(alarm.scheduledFor)}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => onDelete(alarm)}
        style={[styles.deleteButton, { borderColor: colors.border }]}>
        <Text style={[styles.deleteText, { color: colors.danger }]}>Delete</Text>
      </Pressable>
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
  contactName: {
    fontSize: 18,
    fontWeight: '600',
  },
  meta: {
    fontSize: 14,
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    paddingVertical: 12,
  },
  deleteText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
