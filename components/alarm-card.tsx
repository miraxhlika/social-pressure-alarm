import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { AppButton } from '@/components/ui/app-button';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { formatGracePeriodLabel } from '@/lib/checkpoint-templates';
import { getAlarmPhase, formatAlarmRuntimeTime, formatRepeatSchedule, formatScheduledFor } from '@/lib/alarms';
import {
  getCheckpointSocialDescription,
  getCheckpointSocialLabel,
  isCheckpointShared,
} from '@/lib/social/settings';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm } from '@/types/alarm';

type AlarmCardProps = {
  alarm: Alarm;
  circleName?: string;
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
  return phase === 'missed' || phase === 'inactive' ? 'Reschedule' : phase === 'ringing' ? 'Open live run' : 'Edit schedule';
}

function getPrimaryActionIcon(phase: keyof typeof STATUS_COPY): keyof typeof Ionicons.glyphMap {
  return phase === 'missed' || phase === 'inactive'
    ? 'calendar-outline'
    : phase === 'ringing'
      ? 'scan-outline'
      : 'create-outline';
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

function AlarmCardComponent({ alarm, circleName, onDelete, onDetails, onEdit, onOpen, onReschedule, onReuse }: AlarmCardProps) {
  const colors = getAppColors(useColorScheme());
  const phase = getAlarmPhase(alarm);
  const sharesToCircle = isCheckpointShared(alarm.socialSettings);
  const primaryActionLabel = getPrimaryActionLabel(phase);
  const primaryActionIcon = getPrimaryActionIcon(phase);
  const primaryAction = useCallback(() => {
    if (phase === 'missed' || phase === 'inactive') {
      onReschedule(alarm);
      return;
    }

    if (phase === 'ringing') {
      onOpen(alarm);
      return;
    }

    onEdit(alarm);
  }, [alarm, onEdit, onOpen, onReschedule, phase]);
  const handleDetailsPress = useCallback(() => {
    onDetails(alarm);
  }, [alarm, onDetails]);
  const handleReusePress = useCallback(() => {
    onReuse(alarm);
  }, [alarm, onReuse]);
  const handleDeletePress = useCallback(() => {
    onDelete(alarm);
  }, [alarm, onDelete]);
  const accountabilityLabel = getCheckpointSocialLabel(alarm.socialSettings, circleName);
  const accountabilityDescription = getCheckpointSocialDescription(alarm.socialSettings);
  const accountabilityCopy = sharesToCircle ? accountabilityLabel : accountabilityDescription;

  return (
    <AppCard elevated style={styles.card}>
      <Pressable
        accessibilityHint="Opens schedule, proof, and result details."
        accessibilityLabel={`View details for ${alarm.label}`}
        accessibilityRole="button"
        onPress={handleDetailsPress}
        style={({ pressed }) => [styles.detailsLink, pressed && styles.contentPressed]}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>{alarm.label}</Text>
          <View style={styles.headerTrailing}>
            <StatusPill label={STATUS_COPY[phase]} tone={STATUS_TONES[phase]} />
            <Ionicons color={colors.muted} name="chevron-forward" size={17} />
          </View>
        </View>

        <View style={styles.scheduleHero}>
          <Text style={[styles.time, { color: colors.text }]}>{formatAlarmRuntimeTime(alarm)}</Text>
          <View style={styles.scheduleCopy}>
            <Text style={[styles.repeatText, { color: colors.textSoft }]}>
              {formatRepeatSchedule(alarm.repeatSchedule)}
            </Text>
            <Text style={[styles.nextRunText, { color: colors.muted }]}>
              {alarm.isActive ? `Next ${formatScheduledFor(alarm.scheduledFor)}` : 'Ready to schedule again'}
            </Text>
          </View>
        </View>

        <View style={[styles.detailsPanel, { backgroundColor: colors.panelMuted }]}>
          {alarm.placeObject && alarm.placeObject.trim().toLocaleLowerCase() !== alarm.label.trim().toLocaleLowerCase() ? (
            <MetaItem color={colors.textSoft} icon="location-outline" text={alarm.placeObject} />
          ) : null}
          <MetaItem
            color={colors.textSoft}
            icon="timer-outline"
            text={`${formatGracePeriodLabel(alarm.gracePeriodSeconds)} window`}
          />
          <MetaItem
            color={sharesToCircle ? colors.primary : colors.textSoft}
            icon={sharesToCircle ? 'people-outline' : 'lock-closed-outline'}
            text={accountabilityCopy}
          />
          <MetaItem color={colors.textSoft} icon="checkmark-circle-outline" text={getLastOutcomeCopy(alarm)} />
        </View>
      </Pressable>

      <View style={styles.actionRow}>
        <AppButton
          icon={primaryActionIcon}
          label={primaryActionLabel}
          onPress={primaryAction}
          size="compact"
          style={styles.primaryAction}
          variant={phase === 'ringing' ? 'primary' : phase === 'missed' || phase === 'inactive' ? 'tonal' : 'secondary'}
        />
      </View>

      <View style={[styles.utilityRow, { borderTopColor: colors.line ?? colors.border }]}>
        <UtilityAction
          accessibilityHint={`Creates a new checkpoint from ${alarm.label}.`}
          accessibilityLabel={`Duplicate ${alarm.label}`}
          color={colors.textSoft}
          icon="copy-outline"
          label="Duplicate"
          onPress={handleReusePress}
        />
        <View style={[styles.utilityDivider, { backgroundColor: colors.line }]} />
        <UtilityAction
          accessibilityHint={`Deletes ${alarm.label}. This action cannot be undone.`}
          accessibilityLabel={`Delete ${alarm.label}`}
          color={colors.danger}
          icon="trash-outline"
          label="Delete"
          onPress={handleDeletePress}
        />
      </View>
    </AppCard>
  );
}

export const AlarmCard = memo(AlarmCardComponent);

function MetaItem({
  color,
  icon,
  text,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.metaItem}>
      <Ionicons color={color} name={icon} size={15} />
      <Text numberOfLines={1} style={[styles.metaText, { color }]}>{text}</Text>
    </View>
  );
}

function UtilityAction({
  accessibilityHint,
  accessibilityLabel,
  label,
  icon,
  onPress,
  color,
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.utilityAction, pressed && styles.pressed]}>
      <Ionicons color={color} name={icon} size={17} />
      <Text style={[styles.utilityLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  detailsLink: {
    gap: Spacing.lg,
  },
  contentPressed: {
    opacity: 0.82,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  headerTrailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  label: {
    flex: 1,
    fontFamily: Fonts.rounded,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.25,
    lineHeight: 24,
    minWidth: 0,
  },
  scheduleHero: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  time: {
    fontFamily: Fonts.rounded,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 42,
  },
  scheduleCopy: {
    flex: 1,
    gap: 1,
    paddingBottom: 3,
  },
  repeatText: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  nextRunText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  detailsPanel: {
    borderRadius: Radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    maxWidth: '100%',
  },
  metaText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryAction: {
    flex: 1,
  },
  utilityRow: {
    borderTopWidth: 1,
    alignItems: 'center',
    flexDirection: 'row',
    paddingTop: Spacing.md,
  },
  utilityAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  utilityDivider: {
    height: 20,
    width: 1,
  },
  utilityLabel: {
    ...TextPresets.label,
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
});
