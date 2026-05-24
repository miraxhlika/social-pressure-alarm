import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, DimensionValue, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Fonts, Radius, Spacing, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatAlarmTime, readAlarmStore } from '@/lib/alarms';
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
  const successesToday = successHistory.filter((entry) => isSameLocalDay(entry.confirmedAt));
  const failuresToday = failureHistory.filter((entry) => isSameLocalDay(entry.failedAt));
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

  return `Due around ${formatAlarmTime(nextAlarm.hour, nextAlarm.minute)}`;
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
  const params = useLocalSearchParams<{ alarmId?: string; label?: string; mode?: string; promptSecondCheckpoint?: string }>();
  const colors = getAppColors(useColorScheme());
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
      <AppScreen backgroundColor="#FFFCF7">
        <LoadingBlock
          description={isSetupComplete ? 'Preparing your first real checkpoint.' : 'Saving this clear to your progress.'}
          title={isSetupComplete ? 'Finishing setup' : 'Saving the win'}
          tone={isSetupComplete ? 'primary' : 'success'}
        />
      </AppScreen>
    );
  }

  const title = isSetupComplete ? 'Ready!' : 'Cleared!';
  const subtitle = isSetupComplete ? 'Proof saved' : 'Proof verified';
  const completionLabel = isSetupComplete
    ? successState.alarm?.scheduledFor
      ? `Scheduled ${formatTimestampLabel(successState.alarm.scheduledFor)}`
      : 'Saved just now'
    : formatCompletedAt(successState.successEntry);
  const streakValue = successState.currentStreak === 1 ? '1 day' : `${successState.currentStreak} days`;
  const progressCopy = `${successState.completedToday} of ${successState.totalToday} checkpoints`;
  const nextTitle = shouldPromptSecondCheckpoint ? 'Add another checkpoint' : successState.nextAlarm?.label ?? 'All clear';
  const nextSubtitle = shouldPromptSecondCheckpoint ? 'Protect one more routine while setup is fresh.' : getNextDueLabel(successState.nextAlarm);
  const continueTarget = shouldPromptSecondCheckpoint ? '/create' : '/';

  return (
    <AppScreen backgroundColor="#FFFCF7" contentStyle={styles.content}>
      <Animated.View
        style={[
          styles.shell,
          {
            opacity: arrivalOpacity,
            transform: [{ translateY: arrivalTranslateY }],
          },
        ]}>
        <View style={styles.celebrationWrap}>
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.primary }, getConfettiMotion(-82, -42, -22)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: '#D9B46F' }, getConfettiMotion(74, -34, 18)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: colors.success }, getConfettiMotion(-94, 24, 30)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: '#D9B46F' }, getConfettiMotion(88, 18, -28)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: '#45B890' }, getConfettiMotion(-58, 48, -42)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: '#D88755' }, getConfettiMotion(54, 42, 36)]} />
          <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: colors.primary }, getConfettiMotion(-108, -8, -48)]} />
          <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: '#D9B46F' }, getConfettiMotion(104, -2, 44)]} />
          <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: '#D88755' }, getConfettiMotion(86, -54, -18)]} />
          <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: '#45B890' }, getConfettiMotion(-78, -58, 26)]} />
          <Animated.View style={[styles.confettiDash, styles.confettiAnchor, { backgroundColor: '#C9A052' }, getConfettiMotion(28, -74, 66)]} />
          <Animated.View style={[styles.confettiDot, styles.confettiAnchor, { backgroundColor: '#59BFA3' }, getConfettiMotion(-22, -82, -52)]} />

          <Animated.View style={[styles.medalOuter, { transform: [{ scale: medalScale }] }]}>
            <View style={styles.medalInner}>
              <Ionicons color="#FFFFFF" name="checkmark" size={54} />
            </View>
          </Animated.View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.summaryCard}>
          <SummaryRow icon="time-outline" label={isSetupComplete ? 'Scheduled' : 'Completed'} value={completionLabel} />
          <View style={styles.summaryDivider} />
          <SummaryRow
            badgeLabel={isSetupComplete ? undefined : '+1'}
            icon="calendar-outline"
            label="Streak"
            value={isSetupComplete ? 'Starts after first clear' : streakValue}
          />
          {!isSetupComplete ? (
            <>
              <View style={styles.summaryDivider} />
              <SummaryRow icon="people-outline" label="Sharing" value={successState.shareConfirmation} />
            </>
          ) : null}
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>{"Today's progress"}</Text>
            <Text style={styles.progressValue}>{progressCopy}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          {successState.failuresToday > 0 ? (
            <Text style={styles.progressNote}>{successState.failuresToday} missed checkpoint still needs a reset.</Text>
          ) : null}
        </View>

        <View style={styles.nextCard}>
          <View style={styles.nextIcon}>
            <Ionicons color="#D79C38" name="sunny" size={22} />
          </View>
          <View style={styles.nextCopy}>
            <Text style={styles.nextEyebrow}>Up next</Text>
            <Text style={styles.nextTitle}>{nextTitle}</Text>
            <Text style={styles.nextSubtitle}>{nextSubtitle}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <AppButton
            label="Continue"
            onPress={() => {
              router.replace(continueTarget);
            }}
            style={styles.continueButton}
            textStyle={styles.primaryButtonText}
          />
          <AppButton
            label="View today"
            onPress={() => {
              router.replace('/');
            }}
            style={styles.secondaryButton}
            textStyle={styles.secondaryButtonText}
            variant="secondary"
          />
        </View>
      </Animated.View>
    </AppScreen>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  badgeLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  badgeLabel?: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryIcon}>
        <Ionicons color="#313946" name={icon} size={20} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryValue}>
        {value}
      </Text>
      {badgeLabel ? (
        <View style={styles.summaryBadge}>
          <Text style={styles.summaryBadgeText}>{badgeLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  shell: {
    gap: Spacing.lg,
  },
  celebrationWrap: {
    alignItems: 'center',
    height: 122,
    justifyContent: 'center',
    position: 'relative',
  },
  medalOuter: {
    alignItems: 'center',
    backgroundColor: '#EAD4B3',
    borderColor: '#F7E9D5',
    borderRadius: Radius.pill,
    borderWidth: 8,
    height: 96,
    justifyContent: 'center',
    shadowColor: '#8A5A24',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    width: 96,
  },
  medalInner: {
    alignItems: 'center',
    backgroundColor: '#D1A05E',
    borderColor: '#B98745',
    borderRadius: Radius.pill,
    borderWidth: 2,
    height: 66,
    justifyContent: 'center',
    width: 66,
  },
  confettiDot: {
    borderRadius: Radius.pill,
    height: 5,
    position: 'absolute',
    width: 5,
  },
  confettiAnchor: {
    left: '50%',
    top: 58,
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
    gap: 2,
  },
  title: {
    color: '#101722',
    fontFamily: Fonts.serif,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 40,
    textAlign: 'center',
  },
  subtitle: {
    color: '#A57944',
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
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
    backgroundColor: '#FFFFFF',
    borderColor: '#EFE7DC',
    borderRadius: 14,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.md,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressTitle: {
    color: '#101722',
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  progressValue: {
    color: '#6B7280',
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  progressTrack: {
    backgroundColor: '#F1EADF',
    borderRadius: Radius.pill,
    height: 9,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#D3A04E',
    borderRadius: Radius.pill,
    height: '100%',
  },
  progressNote: {
    color: '#A26245',
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  nextCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EFE7DC',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  nextIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF1D5',
    borderRadius: Radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  nextCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  nextEyebrow: {
    color: '#7D6A58',
    fontFamily: Fonts.rounded,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  nextTitle: {
    color: '#101722',
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
  nextSubtitle: {
    color: '#6B7280',
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  actions: {
    gap: Spacing.sm,
  },
  continueButton: {
    backgroundColor: '#101827',
    borderColor: '#101827',
    borderRadius: 9,
  },
  secondaryButton: {
    backgroundColor: '#FFFCF7',
    borderColor: '#E6DDD0',
    borderRadius: 9,
  },
  secondaryButtonText: {
    color: '#101827',
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '900',
  },
});
