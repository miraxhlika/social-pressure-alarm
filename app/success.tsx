import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, DimensionValue, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Shadows, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getFailureOccurrenceTimestamp,
  getSuccessOccurrenceTimestamp,
} from '@/lib/alarm-history';
import { formatAlarmRuntimeTime, readAlarmStore } from '@/lib/alarms';
import { getPrimaryAlarm } from '@/lib/dashboard';
import { ProgressSummary, getProgressSummary } from '@/lib/progress';
import { listMySocialCircles } from '@/lib/social/circles';
import { findCircleName, getOutcomeShareConfirmation } from '@/lib/social/settings';
import { Alarm, FailureHistoryEntry, SuccessHistoryEntry } from '@/types/alarm';

type SuccessState = {
  alarm: Alarm | null;
  completedToday: number;
  currentStreak: number;
  failuresToday: number;
  isFirstClear: boolean;
  nextAlarm: Alarm | null;
  summary: ProgressSummary;
  successEntry: SuccessHistoryEntry | null;
  shareConfirmation: string;
  totalToday: number;
};

function isSameLocalDay(timestamp: string, day = new Date()) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function getScheduledDateForToday(alarm: Alarm, day = new Date()) {
  if (alarm.scheduledFor) {
    return new Date(alarm.scheduledFor);
  }

  const scheduledDate = new Date(day);
  scheduledDate.setHours(alarm.hour, alarm.minute, 0, 0);
  return scheduledDate;
}

function getLatestSuccessForAlarm(successHistory: SuccessHistoryEntry[], alarmId?: string) {
  const entries = alarmId ? successHistory.filter((entry) => entry.alarmId === alarmId) : successHistory;

  return [...entries].sort((left, right) => new Date(right.confirmedAt).getTime() - new Date(left.confirmedAt).getTime())[0] ?? null;
}

function getTodayProgress(
  alarms: Alarm[],
  successHistory: SuccessHistoryEntry[],
  failureHistory: FailureHistoryEntry[]
) {
  const successesToday = successHistory.filter((entry) => isSameLocalDay(getSuccessOccurrenceTimestamp(entry)));
  const failuresToday = failureHistory.filter((entry) => isSameLocalDay(getFailureOccurrenceTimestamp(entry)));
  const resolvedAlarmIds = new Set([
    ...successesToday.map((entry) => entry.alarmId),
    ...failuresToday.map((entry) => entry.alarmId),
  ]);
  const pendingToday = alarms.filter((alarm) => {
    if (!alarm.isActive || resolvedAlarmIds.has(alarm.id)) {
      return false;
    }

    return isSameLocalDay(getScheduledDateForToday(alarm).toISOString());
  });

  return {
    completedToday: successesToday.length,
    failuresToday: failuresToday.length,
    totalToday: Math.max(1, successesToday.length + failuresToday.length + pendingToday.length),
  };
}

function formatTimestampLabel(timestamp: string) {
  const completedAt = new Date(timestamp);
  const prefix = isSameLocalDay(completedAt.toISOString())
    ? 'Today'
    : completedAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = completedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return `${prefix}, ${time}`;
}

function formatCompletedAt(successEntry: SuccessHistoryEntry | null) {
  return formatTimestampLabel(successEntry?.confirmedAt ?? new Date().toISOString());
}

function getNextDueLabel(nextAlarm: Alarm | null) {
  if (!nextAlarm) {
    return 'No more checkpoints today';
  }

  if (nextAlarm.scheduledFor) {
    return `Due around ${new Date(nextAlarm.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  return `Due around ${formatAlarmRuntimeTime(nextAlarm)}`;
}

function getPracticeDeferredCopy(timestamp: string) {
  const scheduledFor = new Date(timestamp);

  if (Number.isNaN(scheduledFor.getTime())) {
    return null;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    scheduledFor.getFullYear() === tomorrow.getFullYear() &&
    scheduledFor.getMonth() === tomorrow.getMonth() &&
    scheduledFor.getDate() === tomorrow.getDate();
  const dayLabel = isTomorrow
    ? 'tomorrow'
    : scheduledFor.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeLabel = scheduledFor.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return `First reminder ${dayLabel} at ${timeLabel}. Today was skipped because you just completed practice.`;
}

async function triggerSuccessArrival() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are best-effort only.
  }
}

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    alarmId?: string;
    label?: string;
    mode?: string;
    practiceDeferredUntil?: string;
    promptSecondCheckpoint?: string;
  }>();
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);
  const isDark = colorScheme === 'dark';
  const [isLoading, setIsLoading] = useState(true);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const arrivalOpacity = useRef(new Animated.Value(0)).current;
  const arrivalTranslateY = useRef(new Animated.Value(20)).current;
  const confettiBurst = useRef(new Animated.Value(0)).current;
  const medalScale = useRef(new Animated.Value(0.86)).current;
  const didCelebrateRef = useRef(false);
  const isSetupComplete = params.mode === 'setup_complete';
  const shouldPromptSecondCheckpoint = params.promptSecondCheckpoint === '1';

  useEffect(() => {
    const loadProgress = async () => {
      setIsLoading(true);

      try {
        const store = await readAlarmStore();
        const summary = getProgressSummary(store);
        const alarm = store.alarms.find((entry) => entry.id === params.alarmId) ?? null;
        const successEntry = isSetupComplete
          ? null
          : getLatestSuccessForAlarm(store.successHistory, params.alarmId) ?? summary.latestSuccess;
        const todayProgress = getTodayProgress(store.alarms, store.successHistory, store.failureHistory);
        const circles = alarm?.socialSettings?.circleId ? await listMySocialCircles().catch(() => []) : [];
        const circleName = findCircleName(circles, alarm?.socialSettings?.circleId);

        setSuccessState({
          alarm,
          completedToday: todayProgress.completedToday,
          currentStreak: store.currentStreak,
          failuresToday: todayProgress.failuresToday,
          isFirstClear: !isSetupComplete && store.successHistory.length === 1,
          nextAlarm: getPrimaryAlarm(store.alarms),
          summary,
          successEntry,
          shareConfirmation: getOutcomeShareConfirmation(alarm?.socialSettings, 'confirmed', circleName),
          totalToday: todayProgress.totalToday,
        });
      } finally {
        setIsLoading(false);
      }
    };

    void loadProgress();
  }, [isSetupComplete, params.alarmId]);

  useEffect(() => {
    if (isLoading || !successState || didCelebrateRef.current) {
      return;
    }

    didCelebrateRef.current = true;
    confettiBurst.setValue(0);
    void triggerSuccessArrival();

    Animated.parallel([
      Animated.timing(arrivalOpacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(arrivalTranslateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(medalScale, {
        toValue: 1,
        friction: 7,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(80),
        Animated.timing(confettiBurst, {
          toValue: 1,
          duration: 950,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [arrivalOpacity, arrivalTranslateY, confettiBurst, isLoading, medalScale, successState]);

  const progressWidth = useMemo(() => {
    if (!successState) {
      return '8%' as DimensionValue;
    }

    return `${Math.max(8, Math.round((successState.completedToday / successState.totalToday) * 100))}%` as DimensionValue;
  }, [successState]);
  const confettiOpacity = confettiBurst.interpolate({
    inputRange: [0, 0.12, 0.72, 1],
    outputRange: [0, 1, 1, 0.55],
  });
  const getConfettiMotion = (x: number, y: number, rotation: number) => ({
    opacity: confettiOpacity,
    transform: [
      {
        translateX: confettiBurst.interpolate({
          inputRange: [0, 1],
          outputRange: [0, x],
        }),
      },
      {
        translateY: confettiBurst.interpolate({
          inputRange: [0, 0.45, 1],
          outputRange: [8, y - 8, y],
        }),
      },
      {
        rotate: confettiBurst.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${rotation}deg`],
        }),
      },
      {
        scale: confettiBurst.interpolate({
          inputRange: [0, 0.16, 1],
          outputRange: [0.35, 1.15, 1],
        }),
      },
    ],
  });

  if (isLoading || !successState) {
    return (
      <AppScreen backgroundColor={colors.canvas}>
        <LoadingBlock
          description={isSetupComplete ? 'Preparing your first real checkpoint.' : 'Saving this clear to your progress.'}
          layout="hero"
          title={isSetupComplete ? 'Finishing setup' : 'Saving the win'}
          tone={isSetupComplete ? 'primary' : 'success'}
        />
      </AppScreen>
    );
  }

  const isFirstClear = successState.isFirstClear;
  const title = isSetupComplete
    ? 'Your checkpoint is ready.'
    : isFirstClear
      ? 'That’s your first clear.'
      : 'Checkpoint cleared.';
  const subtitle = isSetupComplete
    ? 'The reminder and proof code are set.'
    : isFirstClear
      ? `You reached ${successState.alarm?.label ?? 'the checkpoint'} and matched the exact code.`
      : `Proof verified for ${successState.alarm?.label ?? 'this checkpoint'}.`;
  const completionLabel = isSetupComplete
    ? successState.alarm?.scheduledFor
      ? `Scheduled ${formatTimestampLabel(successState.alarm.scheduledFor)}`
      : 'Saved just now'
    : formatCompletedAt(successState.successEntry);
  const streakValue = successState.currentStreak === 1 ? '1 clear' : `${successState.currentStreak} clears`;
  const progressCopy = `${successState.completedToday} of ${successState.totalToday} checkpoints`;
  const nextTitle = shouldPromptSecondCheckpoint
    ? 'Add another checkpoint'
    : successState.nextAlarm?.label ?? 'You’re done for today';
  const practiceDeferredCopy = params.practiceDeferredUntil
    ? getPracticeDeferredCopy(params.practiceDeferredUntil)
    : null;
  const nextSubtitle = shouldPromptSecondCheckpoint
    ? 'Protect one more routine while setup is fresh.'
    : practiceDeferredCopy ?? getNextDueLabel(successState.nextAlarm);
  const primaryLabel = shouldPromptSecondCheckpoint ? 'Add another checkpoint' : 'Go to Today';
  const primaryTarget = shouldPromptSecondCheckpoint ? '/create' : '/';
  const showAccountabilityAction = isFirstClear && !shouldPromptSecondCheckpoint;
  const heroGradient = isDark
    ? (['#211B17', '#17191C', '#121518'] as const)
    : (['#FFF7ED', '#FBF5EE', '#F4F1ED'] as const);

  return (
    <AppScreen
      backgroundColor={colors.canvas}
      contentStyle={styles.content}
      scrollProps={{ contentInsetAdjustmentBehavior: 'never' }}>
      <Animated.View
        style={[
          styles.shell,
          {
            opacity: arrivalOpacity,
            transform: [{ translateY: arrivalTranslateY }],
          },
        ]}>
        <LinearGradient
          colors={heroGradient}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.hero, Shadows.hero, { borderColor: colors.line }]}>
          <View style={[styles.heroEyebrow, { backgroundColor: colors.successSurface }]}>
            <Ionicons color={colors.success} name="shield-checkmark" size={13} />
            <Text style={[styles.heroEyebrowText, { color: colors.success }]}>
              {isFirstClear ? 'FIRST CHECKPOINT CLEARED' : isSetupComplete ? 'SETUP COMPLETE' : 'PROOF VERIFIED'}
            </Text>
          </View>

          <View style={styles.celebrationWrap}>
            <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.primary }, getConfettiMotion(-72, -30, -22)]} />
            <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.warning }, getConfettiMotion(68, -26, 18)]} />
            <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.success }, getConfettiMotion(-78, 20, 30)]} />
            <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.primary }, getConfettiMotion(76, 16, -28)]} />
            <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: colors.primary }, getConfettiMotion(-90, -2, -48)]} />
            <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: colors.warning }, getConfettiMotion(88, 0, 44)]} />

            <Animated.View
              style={[
                styles.medalOuter,
                {
                  backgroundColor: colors.primarySurface,
                  borderColor: withAlpha(colors.primary, '42'),
                  shadowColor: colors.primary,
                  transform: [{ scale: medalScale }],
                },
              ]}>
              <View style={[styles.medalInner, { backgroundColor: colors.primary }]}>
                <Ionicons color={colors.primaryText} name="checkmark" size={42} />
              </View>
            </Animated.View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors.textSoft }]}>{subtitle}</Text>
          </View>
        </LinearGradient>

        <View style={styles.metricGrid}>
          <SummaryMetric
            colors={colors}
            icon="checkmark-circle-outline"
            label={isSetupComplete ? 'Scheduled' : 'Completed'}
            value={completionLabel}
          />
          <SummaryMetric
            colors={colors}
            icon="calendar-outline"
            label="Streak"
            value={isSetupComplete ? 'Starts after first clear' : streakValue}
          />
        </View>

        <View style={[styles.progressCard, Shadows.card, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={[styles.progressEyebrow, { color: colors.textSoft }]}>TODAY</Text>
              <Text style={[styles.progressTitle, { color: colors.text }]}>Your progress</Text>
            </View>
            <Text style={[styles.progressValue, { color: colors.primary }]}>{progressCopy}</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.panelMuted }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: progressWidth }]} />
          </View>
          {successState.failuresToday > 0 ? (
            <Text style={[styles.progressNote, { color: colors.warning }]}>
              {successState.failuresToday} missed checkpoint still needs a reset.
            </Text>
          ) : null}
        </View>

        <View style={[styles.nextCard, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
          <View style={[styles.nextIcon, { backgroundColor: colors.primarySurface }]}>
            <Ionicons
              color={colors.primary}
              name={shouldPromptSecondCheckpoint ? 'add' : successState.nextAlarm ? 'notifications-outline' : 'checkmark-done'}
              size={21}
            />
          </View>
          <View style={styles.nextCopy}>
            <Text style={[styles.nextEyebrow, { color: colors.textSoft }]}>
              {shouldPromptSecondCheckpoint ? 'NEXT STEP' : successState.nextAlarm ? 'NEXT REMINDER' : 'TODAY'}
            </Text>
            <Text style={[styles.nextTitle, { color: colors.text }]}>{nextTitle}</Text>
            <Text style={[styles.nextSubtitle, { color: colors.textSoft }]}>{nextSubtitle}</Text>
          </View>
        </View>

        {!isSetupComplete ? (
          <View style={styles.privacyRow}>
            <Ionicons color={colors.muted} name="lock-closed-outline" size={14} />
            <Text style={[styles.privacyText, { color: colors.textSoft }]}>{successState.shareConfirmation}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <AppButton
            icon={shouldPromptSecondCheckpoint ? 'add' : 'arrow-forward'}
            label={primaryLabel}
            onPress={() => {
              router.replace(primaryTarget);
            }}
            style={styles.primaryButton}
          />
          {showAccountabilityAction ? (
            <AppButton
              icon="people-outline"
              label="Add accountability (optional)"
              onPress={() => {
                router.replace('/circles');
              }}
              style={styles.secondaryButton}
              variant="secondary"
            />
          ) : null}
        </View>
      </Animated.View>
    </AppScreen>
  );
}

function SummaryMetric({
  colors,
  icon,
  label,
  value,
}: {
  colors: ReturnType<typeof getAppColors>;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.metricCard, Shadows.card, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <View style={[styles.metricIcon, { backgroundColor: colors.primarySurface }]}>
        <Ionicons color={colors.primary} name={icon} size={18} />
      </View>
      <Text style={[styles.metricLabel, { color: colors.textSoft }]}>{label}</Text>
      <Text numberOfLines={2} style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: 0,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  shell: {
    gap: 14,
  },
  hero: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: 1,
    gap: Spacing.sm,
    overflow: 'hidden',
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  heroEyebrow: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroEyebrowText: {
    ...TextPresets.eyebrow,
    fontSize: 9,
    lineHeight: 12,
  },
  celebrationWrap: {
    alignItems: 'center',
    height: 90,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  medalOuter: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 6,
    height: 82,
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    width: 82,
  },
  medalInner: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  confettiDot: {
    borderRadius: Radius.pill,
    height: 5,
    position: 'absolute',
    width: 5,
  },
  confettiAnchor: {
    left: '50%',
    top: 42,
  },
  confettiDotOne: {
    left: '32%',
    top: 18,
  },
  confettiDotTwo: {
    right: '30%',
    top: 28,
  },
  confettiDotThree: {
    bottom: 24,
    left: '26%',
  },
  confettiDotFour: {
    right: '23%',
    top: 70,
  },
  confettiDotFive: {
    left: '20%',
    top: 72,
  },
  confettiDotSix: {
    bottom: 42,
    right: '31%',
  },
  confettiDash: {
    borderRadius: Radius.pill,
    height: 4,
    position: 'absolute',
    width: 16,
  },
  confettiDashOne: {
    right: '25%',
    top: 58,
    transform: [{ rotate: '-26deg' }],
  },
  confettiDashTwo: {
    left: '24%',
    top: 56,
    transform: [{ rotate: '22deg' }],
  },
  confettiDashThree: {
    right: '18%',
    top: 42,
    transform: [{ rotate: '-18deg' }],
  },
  confettiDashFour: {
    bottom: 38,
    left: '34%',
    transform: [{ rotate: '32deg' }],
  },
  titleBlock: {
    alignItems: 'center',
    gap: Spacing.xs,
    maxWidth: 310,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
    lineHeight: 35,
    textAlign: 'center',
  },
  subtitle: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  metricGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  metricCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    minHeight: 112,
    padding: Spacing.md,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    marginBottom: 3,
    width: 34,
  },
  metricLabel: {
    ...TextPresets.eyebrow,
    fontSize: 9,
    lineHeight: 12,
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EFE7DC',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 56,
    paddingHorizontal: 14,
  },
  summaryIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  summaryLabel: {
    color: '#242B37',
    flex: 1,
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  summaryValue: {
    color: '#6D7280',
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    maxWidth: 140,
    textAlign: 'right',
  },
  summaryBadge: {
    backgroundColor: '#E9F7E8',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  summaryBadgeText: {
    color: '#2B9B63',
    fontFamily: Fonts.rounded,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 15,
  },
  summaryDivider: {
    backgroundColor: '#F1E9DD',
    height: 1,
    marginHorizontal: Spacing.md,
  },
  progressCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressEyebrow: {
    ...TextPresets.eyebrow,
    fontSize: 9,
    lineHeight: 12,
  },
  progressTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  progressValue: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
  },
  progressNote: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  nextCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 78,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  nextIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  nextCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  nextEyebrow: {
    ...TextPresets.eyebrow,
    fontSize: 9,
    lineHeight: 12,
  },
  nextTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  nextSubtitle: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  privacyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 20,
  },
  privacyText: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
  },
  actions: {
    gap: Spacing.sm,
    paddingTop: 2,
  },
  primaryButton: {
    borderRadius: Radius.md,
  },
  secondaryButton: {
    borderRadius: Radius.md,
  },
});
