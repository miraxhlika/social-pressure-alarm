import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppScreen } from '@/components/ui/app-screen';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FlowIconBadge,
  FlowSectionLabel,
  FlowTopBar,
} from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  formatScheduledFor,
  getAlarmById,
  hydrateAlarmRuntimeForCurrentUser,
  readAlarmStore,
  rescheduleAlarm,
} from '@/lib/alarms';
import { getCheckpointRoutineCopy } from '@/lib/checkpoint-templates';
import { getProgressSummary, ProgressSummary } from '@/lib/progress';
import { Alarm, FailureHistoryEntry } from '@/types/alarm';

type MissedScreenState = {
  alarm: Alarm | null;
  latestFailure: FailureHistoryEntry | null;
  progressSummary: ProgressSummary | null;
};

type RecoveryAction = 'restart' | 'adjust' | 'tomorrow';

const ANALYTICS_ACTION_BY_RECOVERY_ACTION: Record<RecoveryAction, 'retry' | 'reschedule' | 'edit'> = {
  adjust: 'edit',
  restart: 'retry',
  tomorrow: 'reschedule',
};

function getTomorrowRetryDate(alarm: Alarm) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(alarm.hour, alarm.minute, 0, 0);
  return tomorrow;
}

function getRestartDate() {
  const restartAt = new Date(Date.now() + 60 * 1000);
  restartAt.setSeconds(0, 0);
  return restartAt;
}

export default function MissedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ alarmId?: string }>();
  const colors = getAppColors(useColorScheme());
  const loadedMissedAlarmIdRef = useRef<string | null>(null);
  const loadMissedRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [processingAction, setProcessingAction] = useState<RecoveryAction | null>(null);
  const [state, setState] = useState<MissedScreenState>({
    alarm: null,
    latestFailure: null,
    progressSummary: null,
  });

  const loadScreen = useCallback(async () => {
    const requestId = loadMissedRequestRef.current + 1;
    loadMissedRequestRef.current = requestId;

    const alarmId = params.alarmId;

    if (!alarmId) {
      loadedMissedAlarmIdRef.current = null;
      setState({ alarm: null, latestFailure: null, progressSummary: null });
      setIsLoading(false);
      return;
    }

    if (loadedMissedAlarmIdRef.current !== alarmId) {
      setIsLoading(true);
    }

    try {
      await hydrateAlarmRuntimeForCurrentUser().catch(() => null);
      const [store, alarm] = await Promise.all([readAlarmStore(), getAlarmById(alarmId)]);
      const latestFailure = store.failureHistory.find((entry) => entry.alarmId === alarmId) ?? null;

      if (loadMissedRequestRef.current === requestId) {
        setState({
          alarm,
          latestFailure,
          progressSummary: getProgressSummary(store),
        });
      }
    } finally {
      if (loadMissedRequestRef.current === requestId) {
        loadedMissedAlarmIdRef.current = alarmId;
        setIsLoading(false);
      }
    }
  }, [params.alarmId]);

  useFocusEffect(
    useCallback(() => {
      void loadScreen();
    }, [loadScreen])
  );

  const missedAtLabel = state.latestFailure
    ? state.latestFailure.scheduledFor
      ? formatScheduledFor(state.latestFailure.scheduledFor)
      : new Date(state.latestFailure.failedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
    : 'recently';
  const routineCopy = useMemo(() => getCheckpointRoutineCopy(state.alarm?.useCaseType), [state.alarm?.useCaseType]);

  const handleRecoveryAction = useCallback(
    async (action: RecoveryAction, runAction: () => Promise<void>) => {
      if (!state.alarm || processingAction) {
        return;
      }

      setProcessingAction(action);

      try {
        await runAction();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The recovery action could not be completed right now.';
        Alert.alert('Unable to update checkpoint', message);
      } finally {
        setProcessingAction(null);
      }
    },
    [processingAction, state.alarm]
  );

  const trackRecovery = useCallback(
    async (action: RecoveryAction) => {
      if (!state.alarm) {
        return;
      }

      await trackAnalyticsEvent('miss_recovery_action', {
        checkpointId: state.alarm.id,
        useCaseType: state.alarm.useCaseType,
        repeatSchedule: state.alarm.repeatSchedule,
        gracePeriodSeconds: state.alarm.gracePeriodSeconds,
        action: ANALYTICS_ACTION_BY_RECOVERY_ACTION[action],
      });
    },
    [state.alarm]
  );

  const handleRestartNow = useCallback(() => {
    void handleRecoveryAction('restart', async () => {
      if (!state.alarm) {
        return;
      }

      await rescheduleAlarm(state.alarm, { scheduledFor: getRestartDate().toISOString() });
      await trackRecovery('restart');
      router.replace(`/ringing?alarmId=${state.alarm.id}`);
    });
  }, [handleRecoveryAction, router, state.alarm, trackRecovery]);

  const handleAdjustCheckpoint = useCallback(() => {
    void handleRecoveryAction('adjust', async () => {
      if (!state.alarm) {
        return;
      }

      router.push({
        pathname: '/create',
        params: {
          alarmId: state.alarm.id,
          mode: 'edit',
          returnTo: `/missed?alarmId=${state.alarm.id}`,
        },
      });
      await trackRecovery('adjust');
    });
  }, [handleRecoveryAction, router, state.alarm, trackRecovery]);

  const handleTryTomorrow = useCallback(() => {
    void handleRecoveryAction('tomorrow', async () => {
      if (!state.alarm) {
        return;
      }

      await rescheduleAlarm(state.alarm, { scheduledFor: getTomorrowRetryDate(state.alarm).toISOString() });
      await trackRecovery('tomorrow');
      router.replace('/');
    });
  }, [handleRecoveryAction, router, state.alarm, trackRecovery]);

  if (isLoading) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <LoadingBlock
          description="Loading the missed checkpoint and recovery options."
          style={styles.loadingBlock}
          title="Preparing recovery"
          tone="canvas"
        />
      </AppScreen>
    );
  }

  if (!state.alarm) {
    return (
      <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
        <FlowTopBar
          leftAccessibilityLabel="Go back"
          leftIcon="chevron-back"
          onLeftPress={() => router.back()}
          title="Missed Checkpoint"
        />
        <EmptyState
          actionLabel="Back to today"
          description="The missed run was recorded, but the checkpoint itself is no longer available."
          onAction={() => router.replace('/')}
          title="Checkpoint not found"
          tone="danger"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen backgroundColor={colors.elevated} contentStyle={styles.screenContent}>
      <FlowTopBar
        leftAccessibilityLabel="Back to today"
        leftIcon="chevron-back"
        onLeftPress={() => router.replace('/')}
        rightAccessibilityLabel="Open checkpoint details"
        rightIcon="ellipsis-vertical"
        onRightPress={() => router.push(`/checkpoint/${state.alarm?.id}`)}
        title="Missed Checkpoint"
      />

      <View style={styles.heroCopy}>
        <Text style={[styles.title, { color: colors.text }]}>Missed Checkpoint</Text>
        <Text style={[styles.subtitle, { color: colors.textSoft }]}>
          It happens. You&apos;re doing great by getting back on track.
        </Text>
      </View>

      <MissedLandscape />

      <View style={styles.actionGroup}>
        <FlowSectionLabel>WHAT WOULD YOU LIKE TO DO?</FlowSectionLabel>
        <RecoveryRow
          description={processingAction === 'restart' ? 'Starting scanner...' : 'Mark it clear and continue'}
          icon="refresh"
          isPrimary
          onPress={handleRestartNow}
          title="Restart now"
        />
        <RecoveryRow
          description={processingAction === 'adjust' ? 'Opening checkpoint...' : 'Change time, schedule, or code location'}
          icon="options-outline"
          onPress={handleAdjustCheckpoint}
          title="Adjust checkpoint"
        />
        <RecoveryRow
          description={processingAction === 'tomorrow' ? 'Scheduling tomorrow...' : "We'll remind you then"}
          icon="partly-sunny-outline"
          onPress={handleTryTomorrow}
          title="Try again tomorrow"
        />
      </View>

      <View style={styles.bottomCopy}>
        <View style={styles.recoveryFootnote}>
          <Ionicons color={colors.muted} name="heart-outline" size={15} />
          <Text style={[styles.footnoteText, { color: colors.textSoft }]}>
            Small resets lead to big consistency.
          </Text>
        </View>

        <Text style={[styles.contextCopy, { color: colors.muted }]}>
          {state.alarm.label} missed {missedAtLabel}. Protect the next {routineCopy}.
        </Text>
      </View>
    </AppScreen>
  );
}

function RecoveryRow({
  description,
  icon,
  isPrimary,
  onPress,
  title,
}: {
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  isPrimary?: boolean;
  onPress: () => void;
  title: string;
}) {
  const colors = getAppColors(useColorScheme());

  if (!isPrimary) {
    return (
      <Pressable
        accessibilityLabel={`${title}. ${description}.`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.recoveryRow, pressed && styles.pressed]}>
        <FlowIconBadge icon={icon} size="small" tone="muted" />
        <View style={styles.recoveryCopy}>
          <Text style={[styles.recoveryTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.recoveryDescription, { color: colors.textSoft }]}>{description}</Text>
        </View>
        <Ionicons color={colors.muted} name="chevron-forward" size={17} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityLabel={`${title}. ${description}.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryRecoveryRow,
        { backgroundColor: colors.text, borderColor: colors.text },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.primaryIcon, { backgroundColor: withAlpha(colors.elevated, '18') }]}>
        <Ionicons color={colors.elevated} name={icon} size={18} />
      </View>
      <View style={styles.primaryRecoveryCopy}>
        <Text style={[styles.primaryRecoveryTitle, { color: colors.elevated }]}>{title}</Text>
        <Text style={[styles.primaryRecoveryDescription, { color: withAlpha(colors.elevated, 'B8') }]}>
          {description}
        </Text>
      </View>
      <Ionicons color={colors.elevated} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function MissedLandscape() {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.landscape, { backgroundColor: colors.panelMuted }]}>
      <View style={[styles.sunGlow, { backgroundColor: withAlpha(colors.warning, '22') }]} />
      <View style={[styles.mountainBack, { backgroundColor: withAlpha(colors.borderStrong, '38') }]} />
      <View style={[styles.mountainFront, { backgroundColor: withAlpha(colors.borderStrong, '24') }]} />
      <View style={[styles.path, { backgroundColor: withAlpha(colors.elevated, 'B8') }]} />
      <View style={[styles.pathShadow, { backgroundColor: withAlpha(colors.primary, '16') }]} />
      <View style={[styles.markerShadow, { backgroundColor: withAlpha(colors.primaryStrong, '20') }]} />
      <View style={[styles.markerPin, { backgroundColor: colors.warningSurface, borderColor: withAlpha(colors.warning, '45') }]}>
        <Text style={[styles.markerText, { color: colors.warning }]}>!</Text>
      </View>
      <View style={[styles.plantLeft, { backgroundColor: withAlpha(colors.success, '28') }]} />
      <View style={[styles.plantLeftTwo, { backgroundColor: withAlpha(colors.success, '22') }]} />
      <View style={[styles.plantRight, { backgroundColor: withAlpha(colors.success, '24') }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flexGrow: 1,
    gap: 10,
    paddingBottom: 32,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  loadingBlock: {
    minHeight: 220,
  },
  heroCopy: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 29,
    textAlign: 'center',
  },
  subtitle: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  landscape: {
    borderRadius: 22,
    height: 154,
    marginTop: 8,
    overflow: 'hidden',
  },
  sunGlow: {
    borderRadius: Radius.pill,
    height: 74,
    left: 120,
    position: 'absolute',
    top: 30,
    width: 74,
  },
  mountainBack: {
    borderRadius: 120,
    height: 115,
    left: -26,
    position: 'absolute',
    top: 44,
    transform: [{ rotate: '12deg' }],
    width: 185,
  },
  mountainFront: {
    borderRadius: 120,
    height: 122,
    position: 'absolute',
    right: -38,
    top: 54,
    transform: [{ rotate: '-13deg' }],
    width: 210,
  },
  path: {
    borderRadius: 65,
    bottom: -12,
    height: 150,
    left: 104,
    position: 'absolute',
    transform: [{ rotate: '12deg' }],
    width: 76,
  },
  pathShadow: {
    borderRadius: 65,
    bottom: -16,
    height: 154,
    left: 94,
    position: 'absolute',
    transform: [{ rotate: '11deg' }],
    width: 96,
  },
  markerShadow: {
    borderRadius: Radius.pill,
    height: 34,
    left: 128,
    position: 'absolute',
    top: 91,
    width: 54,
  },
  markerPin: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
    left: 128,
    position: 'absolute',
    top: 34,
    transform: [{ rotate: '45deg' }],
    width: 50,
  },
  markerText: {
    fontFamily: Fonts.rounded,
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 34,
    transform: [{ rotate: '-45deg' }],
  },
  plantLeft: {
    borderRadius: 14,
    bottom: -10,
    height: 72,
    left: 14,
    position: 'absolute',
    transform: [{ rotate: '-20deg' }],
    width: 18,
  },
  plantLeftTwo: {
    borderRadius: 14,
    bottom: -12,
    height: 58,
    left: 33,
    position: 'absolute',
    transform: [{ rotate: '18deg' }],
    width: 15,
  },
  plantRight: {
    borderRadius: 16,
    bottom: -12,
    height: 68,
    position: 'absolute',
    right: 22,
    transform: [{ rotate: '17deg' }],
    width: 18,
  },
  actionGroup: {
    gap: 7,
    marginTop: 2,
  },
  recoveryRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  recoveryCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  recoveryTitle: {
    ...TextPresets.label,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  recoveryDescription: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  primaryRecoveryRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryIcon: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  primaryRecoveryCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  primaryRecoveryTitle: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 17,
  },
  primaryRecoveryDescription: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  bottomCopy: {
    gap: 7,
    marginTop: 'auto',
    paddingTop: Spacing.md,
  },
  recoveryFootnote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingTop: 6,
  },
  footnoteText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  contextCopy: {
    ...TextPresets.body,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
});
