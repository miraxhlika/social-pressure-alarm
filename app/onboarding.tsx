import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppScreen } from '@/components/ui/app-screen';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { CHECKPOINT_TEMPLATES, formatGracePeriodLabel } from '@/lib/checkpoint-templates';
import { markOnboardingActive, markOnboardingSkipped, readOnboardingState } from '@/lib/onboarding';
import { UseCaseType } from '@/types/alarm';

const DEMO_DURATION_SECONDS = 18;
const TIER_ONE_TEMPLATES = CHECKPOINT_TEMPLATES;

type OnboardingPhase = 'choose' | 'practice' | 'cleared';

function getRepeatLabel(value: string) {
  if (value === 'daily') {
    return 'Daily';
  }

  if (value === 'weekdays') {
    return 'Weekdays';
  }

  return 'Once';
}

export default function OnboardingScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [selectedUseCaseType, setSelectedUseCaseType] = useState<UseCaseType>('wake_up');
  const [phase, setPhase] = useState<OnboardingPhase>('choose');
  const [remainingSeconds, setRemainingSeconds] = useState(DEMO_DURATION_SECONDS);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const onboardingTrackedRef = useRef(false);
  const selectedTemplate = useMemo(
    () => TIER_ONE_TEMPLATES.find((template) => template.id === selectedUseCaseType) ?? TIER_ONE_TEMPLATES[0],
    [selectedUseCaseType]
  );

  useEffect(() => {
    let isMounted = true;

    const beginOnboarding = async () => {
      const onboardingState = await readOnboardingState();

      if (!isMounted || onboardingTrackedRef.current || onboardingState.status !== 'pending') {
        return;
      }

      onboardingTrackedRef.current = true;
      await markOnboardingActive();
      await trackAnalyticsEvent('onboarding_started', {
        source: 'app_launch',
      });
    };

    void beginOnboarding();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'practice' || startedAt === null) {
      return;
    }

    const interval = setInterval(() => {
      const secondsLeft = Math.max(0, DEMO_DURATION_SECONDS - Math.floor((Date.now() - startedAt) / 1000));
      setRemainingSeconds(secondsLeft);

      if (secondsLeft === 0) {
        clearInterval(interval);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [phase, startedAt]);

  const handleSkip = async () => {
    await markOnboardingSkipped();
    router.replace('/');
  };

  const handleUseCaseSelect = async (useCaseType: UseCaseType) => {
    setSelectedUseCaseType(useCaseType);
    await trackAnalyticsEvent('use_case_selected', {
      source: 'onboarding',
      useCaseType,
    });
  };

  const handleStartPractice = async () => {
    setPhase('practice');
    setStartedAt(Date.now());
    setRemainingSeconds(DEMO_DURATION_SECONDS);

    await trackAnalyticsEvent('demo_checkpoint_created', {
      useCaseType: selectedTemplate.id,
    });
  };

  const handleClearPractice = async () => {
    const timeToClearSeconds =
      startedAt === null ? undefined : Math.max(1, Math.round((Date.now() - startedAt) / 1000));

    await trackAnalyticsEvent('demo_checkpoint_cleared', {
      useCaseType: selectedTemplate.id,
      timeToClearSeconds,
    });

    setPhase('cleared');
  };

  const handleBuildRealCheckpoint = () => {
    router.push({
      pathname: '/create',
      params: {
        onboardingMode: 'convert_demo',
        prefillUseCaseType: selectedTemplate.id,
        prefillLabel: selectedTemplate.defaultLabel,
        prefillRepeatSchedule: selectedTemplate.repeatSchedule,
        prefillGracePeriodSeconds: String(selectedTemplate.gracePeriodSeconds),
      },
    });
  };

  return (
    <AppScreen>
      <PageHeader
        action={<AppButton label="Skip" onPress={() => void handleSkip()} size="compact" variant="ghost" />}
        badgeLabel="First run"
        badgeTone="primary"
        eyebrow="Start here"
        title="Build follow-through before you need it."
        description="Pick one routine, feel the live checkpoint loop in practice, then save the real recurring version."
      />

      <AppCard elevated tone="primary" variant="hero" style={styles.heroCard}>
        <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>What this app actually does</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>It protects a real commitment with physical proof.</Text>
        <Text style={[TextPresets.body, { color: colors.textSoft }]}>
          When the checkpoint goes live, you have a short window to reach the saved place and scan the exact QR code there.
        </Text>
        <View style={styles.heroPillRow}>
          <StatusPill label="No account required" tone="success" />
          <StatusPill label="Practice first" tone="primary" />
          <StatusPill label="Real schedule next" tone="default" />
        </View>
      </AppCard>

      <AppCard elevated tone="canvas" style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionCopy}>
            <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Step 1</Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose the routine you want to protect</Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              This decides the default cadence and coaching in the next step.
            </Text>
          </View>
          <StatusPill label={selectedTemplate.title} tone="primary" />
        </View>

        <View style={styles.templateGrid}>
          {TIER_ONE_TEMPLATES.map((template) => {
            const isSelected = template.id === selectedUseCaseType;

            return (
              <Pressable
                key={template.id}
                accessibilityLabel={`Choose ${template.title}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  void handleUseCaseSelect(template.id);
                }}
                style={[
                  styles.templateCard,
                  {
                    backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                    borderColor: isSelected ? colors.primary : colors.line,
                  },
                ]}>
                <View style={styles.templateHeader}>
                  <Text style={[styles.templateTitle, { color: isSelected ? colors.primary : colors.text }]}>
                    {template.id === 'custom' ? 'Other' : template.title}
                  </Text>
                  <StatusPill label={getRepeatLabel(template.repeatSchedule)} tone={isSelected ? 'primary' : 'default'} />
                </View>
                <Text style={[TextPresets.body, { color: colors.textSoft }]}>{template.description}</Text>
                <Text style={[styles.templateMeta, { color: colors.muted }]}>
                  {template.defaultLabel ? `Starts at ${template.defaultLabel}` : 'Starts with your own label'} ·{' '}
                  {formatGracePeriodLabel(template.gracePeriodSeconds)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </AppCard>

      {phase === 'choose' ? (
        <AppCard elevated tone="canvas" style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Step 2</Text>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Run a short practice checkpoint</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                This walkthrough is a safe rehearsal. It does not schedule notifications or require a real QR code yet.
              </Text>
            </View>
            <StatusPill label={`${DEMO_DURATION_SECONDS}s practice`} tone="warning" />
          </View>

          <View style={[styles.practicePlan, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Practice plan</Text>
            <Text style={[styles.practiceTitle, { color: colors.text }]}>
              {selectedTemplate.title} at a saved checkpoint like {selectedTemplate.defaultLabel || 'your own spot'}
            </Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>{selectedTemplate.coaching}</Text>
          </View>

          <View style={styles.buttonStack}>
            <AppButton label="Start practice run" onPress={() => void handleStartPractice()} />
            <AppButton label="Skip practice and set up the real one" onPress={handleBuildRealCheckpoint} variant="secondary" />
          </View>
        </AppCard>
      ) : null}

      {phase === 'practice' ? (
        <AppCard elevated tone="primary" variant="hero" style={styles.practiceStage}>
          <View style={styles.practiceStageHeader}>
            <View style={styles.sectionCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.warning }]}>Practice run live</Text>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Imagine the real QR is at {selectedTemplate.defaultLabel || 'your checkpoint'}.</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                In the real product, this is when you would physically move and scan. Here, clear the practice run to learn the rhythm.
              </Text>
            </View>
            <StatusPill label="Practice only" tone="warning" />
          </View>

          <View style={styles.practiceCountdownWrap}>
            <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>Time left</Text>
            <Text style={[styles.practiceCountdown, { color: colors.text }]}>{remainingSeconds}s</Text>
            <Text style={[styles.practiceCountdownCopy, { color: colors.textSoft }]}>
              Short window, exact place, no ambiguity.
            </Text>
          </View>

          <View style={styles.buttonStack}>
            <AppButton label="Practice clear" onPress={() => void handleClearPractice()} />
            <AppButton label="Restart practice" onPress={() => void handleStartPractice()} variant="secondary" />
          </View>
        </AppCard>
      ) : null}

      {phase === 'cleared' ? (
        <AppCard elevated tone="success" variant="hero" style={styles.practiceStage}>
          <View style={styles.practiceStageHeader}>
            <View style={styles.sectionCopy}>
              <Text style={[TextPresets.eyebrow, { color: colors.success }]}>Practice cleared</Text>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Now turn that into a real recurring checkpoint.</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                The next screen will already carry this use case forward. You only need to set the real time and scan the real QR.
              </Text>
            </View>
            <StatusPill label="Ready for real setup" tone="success" />
          </View>

          <View style={[styles.practicePlan, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <Text style={[TextPresets.label, { color: colors.text }]}>What will be prefilled</Text>
            <Text style={[styles.practiceTitle, { color: colors.text }]}>
              {selectedTemplate.title} · {getRepeatLabel(selectedTemplate.repeatSchedule)} ·{' '}
              {formatGracePeriodLabel(selectedTemplate.gracePeriodSeconds)}
            </Text>
            <Text style={[TextPresets.body, { color: colors.textSoft }]}>
              You can still change the schedule, checkpoint name, and reach window before saving.
            </Text>
          </View>

          <View style={styles.buttonStack}>
            <AppButton label="Build the real checkpoint" onPress={handleBuildRealCheckpoint} />
            <AppButton label="Explore the app first" onPress={() => void handleSkip()} variant="secondary" />
          </View>
        </AppCard>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    gap: Spacing.md,
  },
  heroTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  heroPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  sectionCard: {
    gap: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  sectionCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 29,
  },
  templateGrid: {
    gap: Spacing.md,
  },
  templateCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  templateHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  templateTitle: {
    ...TextPresets.label,
    fontSize: 15,
  },
  templateMeta: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  practicePlan: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  practiceTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  buttonStack: {
    gap: Spacing.sm,
  },
  practiceStage: {
    gap: Spacing.lg,
  },
  practiceStageHeader: {
    gap: Spacing.md,
  },
  practiceCountdownWrap: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  practiceCountdown: {
    fontFamily: Fonts.rounded,
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -1.6,
    lineHeight: 60,
  },
  practiceCountdownCopy: {
    ...TextPresets.body,
    textAlign: 'center',
  },
});
