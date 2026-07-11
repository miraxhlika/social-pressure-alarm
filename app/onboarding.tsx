import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  ensureNotificationPermissionsAsync,
  getNotificationPermissionState,
  isNotificationPermissionEnabled,
  NotificationPermissionState,
  openNotificationSettingsAsync,
} from '@/lib/notifications';
import {
  markOnboardingActive,
  markOnboardingCompleted,
  markOnboardingReturningFromSettings,
  OnboardingStep,
  readOnboardingState,
} from '@/lib/onboarding';

type CameraPermissionState = 'granted' | 'denied' | 'undetermined';

const STEPS: OnboardingStep[] = ['welcome', 'how', 'permissions'];
const ONBOARDING_HERO_IMAGE = require('../assets/Onboarding_Screen.png');

const palette = {
  canvas: '#FBFAF7',
  ink: '#151A25',
  inkSoft: '#626B78',
  muted: '#8B94A1',
  navy: '#111827',
  card: '#FFFFFF',
  line: '#E8E2DA',
  lineStrong: '#D8D0C7',
  gold: '#C7A46D',
  goldSoft: '#F4EDE2',
  lilac: '#ECEBFF',
  lilacInk: '#6973A6',
  blueWash: '#F3F6FF',
  green: '#3D9D70',
  greenSoft: '#EBF7F0',
  shadow: '#1F2937',
};

const HOW_STEPS = [
  {
    icon: 'calendar-outline',
    number: '1',
    title: 'Schedule checkpoint',
    description: "Set when you'll check in. We'll remind you.",
  },
  {
    icon: 'location-outline',
    number: '2',
    title: 'Go to the real place/object',
    description: 'Be at the right place or in front of the right thing.',
  },
  {
    icon: 'qr-code-outline',
    number: '3',
    title: 'Scan the saved code',
    description: 'Scan the QR code or barcode to clear the checkpoint.',
  },
] as const;

function getStepIndex(step: OnboardingStep) {
  return STEPS.indexOf(step);
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView | null>(null);
  const onboardingTrackedRef = useRef(false);
  const activeStepRef = useRef<OnboardingStep>('welcome');
  const programmaticScrollTargetRef = useRef<OnboardingStep | null>(null);
  const programmaticScrollClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeStep, setActiveStep] = useState<OnboardingStep>('welcome');
  const [isOnboardingReady, setIsOnboardingReady] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationPermissionState>('undetermined');
  const [cameraPermission, requestCameraPermission, getCameraPermission] = useCameraPermissions();
  const cameraState: CameraPermissionState = cameraPermission?.granted
    ? 'granted'
    : cameraPermission?.canAskAgain === false
      ? 'denied'
      : 'undetermined';

  const refreshNotificationPermission = useCallback(async () => {
    const permissionState = await getNotificationPermissionState().catch(
      () => 'undetermined' as NotificationPermissionState
    );
    setNotificationState(permissionState);
    return permissionState;
  }, []);

  const refreshCameraPermission = useCallback(async () => {
    const permissionState = await getCameraPermission().catch(() => null);
    return permissionState?.granted
      ? 'granted'
      : permissionState?.canAskAgain === false
        ? 'denied'
        : 'undetermined';
  }, [getCameraPermission]);

  const scrollPagerToStep = useCallback(
    (step: OnboardingStep, animated: boolean) => {
      pagerRef.current?.scrollTo({ animated, x: getStepIndex(step) * width });
    },
    [width]
  );

  const restorePagerPosition = useCallback(() => {
    if (!isOnboardingReady) {
      return;
    }

    const step = activeStepRef.current;
    scrollPagerToStep(step, false);
    requestAnimationFrame(() => scrollPagerToStep(step, false));
  }, [isOnboardingReady, scrollPagerToStep]);

  const clearProgrammaticScrollTarget = useCallback(() => {
    if (programmaticScrollClearTimerRef.current) {
      clearTimeout(programmaticScrollClearTimerRef.current);
      programmaticScrollClearTimerRef.current = null;
    }

    programmaticScrollTargetRef.current = null;
  }, []);

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  useEffect(() => clearProgrammaticScrollTarget, [clearProgrammaticScrollTarget]);

  useEffect(() => {
    let isMounted = true;

    const beginOnboarding = async () => {
      const [onboardingState, permissionState] = await Promise.all([
        readOnboardingState(),
        getNotificationPermissionState().catch(() => 'undetermined' as NotificationPermissionState),
      ]);

      if (!isMounted) {
        return;
      }

      const restoredStep =
        onboardingState.status === 'active' && onboardingState.returnToPermissionsAfterSettings
          ? 'permissions'
          : onboardingState.currentStep;

      activeStepRef.current = restoredStep;
      setActiveStep(restoredStep);
      setNotificationState(permissionState);
      setIsOnboardingReady(true);

      if (onboardingState.returnToPermissionsAfterSettings) {
        await markOnboardingActive(restoredStep);
      }

      if (
        onboardingTrackedRef.current ||
        onboardingState.status === 'active' ||
        onboardingState.status === 'completed' ||
        onboardingState.status === 'skipped'
      ) {
        return;
      }

      onboardingTrackedRef.current = true;
      await markOnboardingActive(restoredStep);
      await trackAnalyticsEvent('onboarding_started', { source: 'app_launch' });
    };

    void beginOnboarding();

    return () => {
      isMounted = false;
    };
  }, []);

  useLayoutEffect(() => {
    restorePagerPosition();
  }, [restorePagerPosition]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshNotificationPermission();
        void refreshCameraPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshCameraPermission, refreshNotificationPermission]);

  const persistOnboardingStep = useCallback((step: OnboardingStep) => {
    activeStepRef.current = step;
    setActiveStep(step);
    void markOnboardingActive(step);
  }, []);

  const navigateToStep = useCallback((step: OnboardingStep) => {
    clearProgrammaticScrollTarget();
    programmaticScrollTargetRef.current = step;
    programmaticScrollClearTimerRef.current = setTimeout(() => {
      if (programmaticScrollTargetRef.current === step) {
        programmaticScrollTargetRef.current = null;
      }
    }, 1000);
    persistOnboardingStep(step);
    scrollPagerToStep(step, true);
  }, [clearProgrammaticScrollTarget, persistOnboardingStep, scrollPagerToStep]);

  const handlePagerScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.max(0, Math.min(STEPS.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
      const nextStep = STEPS[nextIndex];

      if (programmaticScrollTargetRef.current) {
        if (nextStep === programmaticScrollTargetRef.current) {
          clearProgrammaticScrollTarget();
        }

        return;
      }

      if (nextStep && nextStep !== activeStepRef.current) {
        persistOnboardingStep(nextStep);
      }
    },
    [clearProgrammaticScrollTarget, persistOnboardingStep, width]
  );

  const handleContinueLocally = async () => {
    await markOnboardingCompleted();
    await trackAnalyticsEvent('onboarding_completed', {
      cameraPermission: cameraState,
      mode: 'local',
      notificationPermission: notificationState,
    });
    router.replace({
      pathname: '/create',
      params: {
        onboardingMode: 'convert_demo',
      },
    });
  };

  const handleOptionalSignIn = async () => {
    await markOnboardingCompleted();
    await trackAnalyticsEvent('onboarding_completed', {
      cameraPermission: cameraState,
      mode: 'optional_sign_in',
      notificationPermission: notificationState,
    });
    router.replace({
      pathname: '/sync',
      params: {
        next: 'first-checkpoint',
      },
    });
  };

  const handleRequestNotifications = async () => {
    const currentState = await refreshNotificationPermission();

    if (currentState === 'denied') {
      await markOnboardingReturningFromSettings();
      await openNotificationSettingsAsync().catch(() => null);
      return;
    }

    const granted = await ensureNotificationPermissionsAsync().catch(() => false);
    const nextState = granted
      ? await getNotificationPermissionState().catch(() => 'granted' as NotificationPermissionState)
      : await getNotificationPermissionState().catch(() => 'denied' as NotificationPermissionState);
    setNotificationState(nextState);
  };

  const handleRequestCamera = async () => {
    const currentState = await refreshCameraPermission();

    if (currentState === 'denied') {
      await markOnboardingReturningFromSettings();
      await Linking.openSettings().catch(() => null);
      return;
    }

    await requestCameraPermission();
  };

  if (!isOnboardingReady) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.pagerContent}
        horizontal
        keyboardShouldPersistTaps="handled"
        onLayout={restorePagerPosition}
        onMomentumScrollEnd={handlePagerScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}>
        <WelcomeStep width={width} onNext={() => navigateToStep('how')} />
        <HowItWorksStep width={width} onNext={() => navigateToStep('permissions')} />
        <PermissionsStep
          cameraState={cameraState}
          notificationState={notificationState}
          onContinueLocally={() => void handleContinueLocally()}
          onOptionalSignIn={() => void handleOptionalSignIn()}
          onRequestCamera={() => void handleRequestCamera()}
          onRequestNotifications={() => void handleRequestNotifications()}
          width={width}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function WelcomeStep({ onNext, width }: { onNext: () => void; width: number }) {
  return (
    <View style={[styles.screen, { width }]}>
      <Header
        title={
          <>
            Don’t dismiss it.{'\n'}Check in.
          </>
        }
        description="Clear a reminder by reaching a real place or object and scanning its saved code."
      />

      <View style={styles.heroArt}>
        <Image
          accessibilityLabel="Illustration of a QR code, barcode, checkpoint pin, and shield on a winding path"
          contentFit="cover"
          contentPosition="center"
          source={ONBOARDING_HERO_IMAGE}
          style={styles.heroImage}
        />
      </View>

      <View style={styles.actions}>
        <OnboardingButton icon="chevron-forward" label="Get Started" onPress={onNext} />
        <OnboardingButton label="See how it works" onPress={onNext} variant="secondary" />
      </View>
    </View>
  );
}

function HowItWorksStep({
  onNext,
  width,
}: {
  onNext: () => void;
  width: number;
}) {
  return (
    <View style={[styles.screen, styles.howScreen, { width }]}>
      <Header title="How it works" description="Three simple steps to confirm you reached your checkpoint." />

      <View style={styles.howList}>
        {HOW_STEPS.map((step) => (
          <View key={step.number} style={styles.howRow}>
            <View style={styles.howIcon}>
              {step.number === '3' ? <StepProofIcon /> : <Ionicons color={palette.navy} name={step.icon} size={43} />}
            </View>
            <View style={styles.rowCopy}>
              <View style={styles.titleRow}>
                <View style={styles.numberBadge}>
                  <Text style={styles.numberText}>{step.number}</Text>
                </View>
                <Text style={styles.rowTitle}>{step.title}</Text>
              </View>
              <Text style={styles.rowDescription}>{step.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.worksWithCard}>
        <View>
          <Text style={styles.worksLabel}>Works with</Text>
          <Text style={styles.worksBody}>QR codes and barcodes</Text>
        </View>
        <View style={styles.codeSamples}>
          <MiniQr />
          <MiniBarcode />
        </View>
      </View>

      <View style={styles.actions}>
        <OnboardingButton icon="chevron-forward" label="Continue" onPress={onNext} />
        <PaginationDots activeStep="how" />
      </View>
    </View>
  );
}

function PermissionsStep({
  cameraState,
  notificationState,
  onContinueLocally,
  onOptionalSignIn,
  onRequestCamera,
  onRequestNotifications,
  width,
}: {
  cameraState: CameraPermissionState;
  notificationState: NotificationPermissionState;
  onContinueLocally: () => void;
  onOptionalSignIn: () => void;
  onRequestCamera: () => void;
  onRequestNotifications: () => void;
  width: number;
}) {
  const isNotificationEnabled = isNotificationPermissionEnabled(notificationState);
  const isCameraEnabled = cameraState === 'granted';
  const arePermissionsReady = isNotificationEnabled && isCameraEnabled;
  const notificationBadge = isNotificationEnabled ? 'Enabled' : notificationState === 'denied' ? 'Denied' : 'Set up now';
  const cameraBadge = isCameraEnabled ? 'Enabled' : cameraState === 'denied' ? 'Denied' : 'Set up now';
  const requirementMessage = arePermissionsReady
    ? "You're ready. Sync is still optional."
    : 'You can continue now. The app will ask again when you create and schedule your first checkpoint.';

  return (
    <View style={[styles.screen, { width }]}>
      <Header
        title={
          <>
            Permissions &amp;{'\n'}Local-First
          </>
        }
        description="A few quick settings so you can start without an account."
      />

      <View style={styles.permissionList}>
        <PermissionRow
          badge={notificationBadge}
          badgeTone={notificationState === 'denied' ? 'danger' : isNotificationEnabled ? 'success' : 'warning'}
          description={
            notificationState === 'denied'
              ? 'Enable notifications in system settings before scheduling a checkpoint.'
              : isNotificationEnabled
                ? 'Checkpoint reminders are enabled.'
                : 'Needed when you schedule your first checkpoint.'
          }
          icon="notifications-outline"
          onPress={isNotificationEnabled ? undefined : onRequestNotifications}
          title="Notifications"
        />
        <PermissionRow
          badge={cameraBadge}
          badgeTone={cameraState === 'denied' ? 'danger' : isCameraEnabled ? 'success' : 'warning'}
          description={
            cameraState === 'denied'
              ? 'Enable camera access in system settings before linking a proof code.'
              : isCameraEnabled
                ? 'Camera access is enabled for scans.'
                : 'Needed when you link a QR code or barcode.'
          }
          icon="camera-outline"
          onPress={isCameraEnabled ? undefined : onRequestCamera}
          title="Camera Access"
        />
        <View style={styles.localCard}>
          <View style={styles.permissionIcon}>
            <Ionicons color={palette.lilacInk} name="lock-closed" size={29} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>Local-first by default</Text>
            <Text style={styles.rowDescription}>Your data stays on your device. You can sync later if you choose.</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <OnboardingButton
          icon="chevron-forward"
          label="Create First Checkpoint"
          onPress={onContinueLocally}
        />
        <OnboardingButton
          icon="person"
          iconPosition="left"
          label="Sign In Before Setup"
          onPress={onOptionalSignIn}
          variant="secondary"
        />
        <View style={[styles.controlNote, !arePermissionsReady ? styles.requirementNote : null]}>
          <Ionicons
            color={arePermissionsReady ? palette.muted : palette.gold}
            name={arePermissionsReady ? 'shield-checkmark-outline' : 'information-circle-outline'}
            size={18}
          />
          <Text style={[styles.controlText, !arePermissionsReady ? styles.requirementText : null]}>{requirementMessage}</Text>
        </View>
      </View>
    </View>
  );
}

function Header({
  description,
  title,
}: {
  description: string;
  title: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.rule} />
      <Text style={styles.subtitle}>{description}</Text>
    </View>
  );
}

function PermissionRow({
  badge,
  badgeTone,
  description,
  icon,
  onPress,
  title,
}: {
  badge: string;
  badgeTone: 'success' | 'warning' | 'danger';
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.permissionRow, pressed ? styles.pressed : null]}>
      <View style={styles.permissionIcon}>
        <Ionicons color={palette.lilacInk} name={icon} size={29} />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.permissionTitleRow}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {title}
          </Text>
          <View style={[styles.badge, styles[`${badgeTone}Badge`]]}>
            <Text style={[styles.badgeText, styles[`${badgeTone}BadgeText`]]}>{badge}</Text>
          </View>
        </View>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      {onPress ? <Ionicons color={palette.muted} name="chevron-forward" size={18} /> : null}
    </Pressable>
  );
}

function OnboardingButton({
  disabled = false,
  icon,
  iconPosition = 'right',
  label,
  onPress,
  variant = 'primary',
}: {
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.primaryButton : styles.secondaryButton,
        disabled ? styles.disabledButton : null,
        pressed && !disabled ? styles.pressed : null,
      ]}>
      {icon && iconPosition === 'left' ? (
        <Ionicons color={isPrimary ? palette.card : palette.navy} name={icon} size={18} />
      ) : null}
      <Text style={[styles.buttonText, isPrimary ? styles.primaryText : styles.secondaryText]}>{label}</Text>
      {icon && iconPosition === 'right' ? (
        <Ionicons color={isPrimary ? palette.card : palette.navy} name={icon} size={18} />
      ) : null}
    </Pressable>
  );
}

function PaginationDots({ activeStep }: { activeStep: OnboardingStep }) {
  const activeStepIndex = getStepIndex(activeStep);

  return (
    <View accessibilityLabel={`Onboarding step ${activeStepIndex + 1} of ${STEPS.length}`} style={styles.dots}>
      {STEPS.map((step, index) => (
        <View
          key={step}
          style={[styles.dot, index === activeStepIndex ? styles.dotActive : null]}
        />
      ))}
    </View>
  );
}

function StepProofIcon() {
  return (
    <View style={styles.stepProofIcon}>
      <QrCodeGlyph variant="step" />
      <BarcodeGlyph variant="step" />
    </View>
  );
}

function MiniQr() {
  return (
    <View style={styles.miniQr}>
      <QrCodeGlyph variant="mini" />
    </View>
  );
}

function MiniBarcode() {
  return (
    <View style={styles.miniBarcode}>
      <BarcodeGlyph variant="mini" />
    </View>
  );
}

function QrCodeGlyph({ variant }: { variant: 'mini' | 'step' }) {
  const cellStyle = variant === 'step' ? styles.qrCellStep : styles.qrCellMini;

  return (
    <View style={[styles.qrCodeGlyph, variant === 'step' ? styles.qrCodeStep : styles.qrCodeMini]}>
      {Array.from({ length: 49 }).map((_, index) => {
        const row = Math.floor(index / 7);
        const col = index % 7;

        return <View key={index} style={[cellStyle, isQrCellOn(row, col) ? styles.qrBitOn : null]} />;
      })}
    </View>
  );
}

function BarcodeGlyph({ variant }: { variant: 'mini' | 'step' }) {
  const bars = variant === 'step' ? STEP_BARCODE_BARS : MINI_BARCODE_BARS;

  return (
    <View style={[styles.barcodeGlyph, variant === 'step' ? styles.barcodeStep : styles.barcodeMini]}>
      {bars.map((bar, index) => (
        <View
          key={`${bar.height}-${bar.width}-${index}`}
          style={[styles.barcodeGlyphBar, { height: bar.height, width: bar.width }]}
        />
      ))}
    </View>
  );
}

function isQrCellOn(row: number, col: number) {
  const inTopLeft = row <= 2 && col <= 2;
  const inTopRight = row <= 2 && col >= 4;
  const inBottomLeft = row >= 4 && col <= 2;
  const inFinder = inTopLeft || inTopRight || inBottomLeft;

  if (inFinder) {
    return !((row === 1 && col === 1) || (row === 1 && col === 5) || (row === 5 && col === 1));
  }

  return QR_DETAIL_CELLS.some(([detailRow, detailCol]) => detailRow === row && detailCol === col);
}

const QR_DETAIL_CELLS = [
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 0],
  [3, 2],
  [3, 4],
  [3, 6],
  [4, 3],
  [4, 4],
  [5, 3],
  [5, 5],
  [6, 3],
  [6, 5],
] as const;
const STEP_BARCODE_BARS = [
  { height: 15, width: 2 },
  { height: 9, width: 1 },
  { height: 16, width: 3 },
  { height: 11, width: 1 },
  { height: 17, width: 2 },
  { height: 13, width: 3 },
  { height: 8, width: 1 },
  { height: 16, width: 2 },
  { height: 10, width: 1 },
] as const;
const MINI_BARCODE_BARS = [
  { height: 23, width: 2 },
  { height: 13, width: 1 },
  { height: 25, width: 3 },
  { height: 17, width: 1 },
  { height: 27, width: 2 },
  { height: 20, width: 3 },
  { height: 12, width: 1 },
  { height: 25, width: 2 },
  { height: 15, width: 1 },
] as const;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: palette.canvas,
    flex: 1,
  },
  pagerContent: {
    flexGrow: 1,
  },
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: Spacing.lg,
    paddingHorizontal: 26,
    paddingTop: Spacing.xl,
  },
  howScreen: {
    paddingBottom: Spacing.xxl,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  title: {
    color: palette.ink,
    fontFamily: Fonts.serif,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.7,
    lineHeight: 36,
    textAlign: 'center',
  },
  rule: {
    backgroundColor: palette.gold,
    borderRadius: Radius.pill,
    height: 2,
    width: 45,
  },
  subtitle: {
    color: palette.inkSoft,
    fontFamily: Fonts.sans,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    maxWidth: 260,
    textAlign: 'center',
  },
  heroArt: {
    alignItems: 'center',
    backgroundColor: palette.canvas,
    flex: 1,
    justifyContent: 'center',
    minHeight: 378,
    marginHorizontal: -26,
    overflow: 'hidden',
  },
  heroImage: {
    height: '112%',
    width: '116%',
  },
  heroGlow: {
    backgroundColor: 'rgba(244, 237, 226, 0.82)',
    borderRadius: 180,
    height: 310,
    position: 'absolute',
    top: 58,
    width: 340,
  },
  skyline: {
    alignItems: 'flex-end',
    bottom: 143,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    position: 'absolute',
  },
  tower: {
    backgroundColor: '#B8BBC9',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    width: 14,
  },
  roadOuter: {
    backgroundColor: '#ECE7E1',
    borderColor: '#DFD7CE',
    borderRadius: 130,
    borderWidth: 1,
    height: 154,
    position: 'absolute',
    right: -42,
    top: 166,
    transform: [{ rotate: '-17deg' }],
    width: 326,
  },
  roadInner: {
    backgroundColor: palette.canvas,
    borderRadius: 110,
    height: 102,
    position: 'absolute',
    right: -4,
    top: 188,
    transform: [{ rotate: '-17deg' }],
    width: 258,
  },
  foregroundHill: {
    backgroundColor: '#F2EEE8',
    borderColor: '#E6DED5',
    borderRadius: 160,
    borderWidth: 1,
    bottom: 18,
    height: 145,
    left: -84,
    position: 'absolute',
    transform: [{ rotate: '8deg' }],
    width: 338,
  },
  leftPlant: {
    bottom: 70,
    flexDirection: 'row',
    gap: 3,
    left: 3,
    position: 'absolute',
  },
  rightPlant: {
    bottom: 86,
    flexDirection: 'row',
    gap: 3,
    position: 'absolute',
    right: 12,
    transform: [{ scaleX: -1 }],
  },
  blade: {
    backgroundColor: '#A3A997',
    borderRadius: Radius.pill,
    width: 8,
  },
  bladeTall: {
    height: 48,
    transform: [{ rotate: '5deg' }],
  },
  bladeLeft: {
    height: 38,
    marginTop: 11,
    transform: [{ rotate: '-31deg' }],
  },
  bladeRight: {
    height: 32,
    marginTop: 17,
    transform: [{ rotate: '31deg' }],
  },
  pinShadow: {
    backgroundColor: 'rgba(34, 42, 54, 0.12)',
    borderRadius: Radius.pill,
    height: 14,
    position: 'absolute',
    top: 174,
    width: 58,
  },
  pin: {
    alignItems: 'center',
    backgroundColor: palette.gold,
    borderColor: palette.card,
    borderRadius: 32,
    borderWidth: 3,
    height: 68,
    justifyContent: 'center',
    position: 'absolute',
    top: 92,
    transform: [{ rotate: '45deg' }],
    width: 68,
  },
  pinInner: {
    alignItems: 'center',
    backgroundColor: '#D8BC89',
    borderRadius: Radius.pill,
    height: 44,
    justifyContent: 'center',
    transform: [{ rotate: '-45deg' }],
    width: 44,
  },
  codeCard: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: 12,
    borderWidth: 1,
    bottom: 47,
    gap: Spacing.sm,
    padding: 14,
    position: 'absolute',
    shadowColor: palette.shadow,
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    left: 71,
    transform: [{ rotate: '-11deg' }],
    width: 132,
  },
  qrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    width: 82,
  },
  qrBit: {
    backgroundColor: '#EEF0F3',
    height: 13,
    width: 13,
  },
  qrBitOn: {
    backgroundColor: palette.navy,
  },
  barcode: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
    height: 25,
  },
  bar: {
    backgroundColor: palette.navy,
    borderRadius: 1,
    width: 3,
  },
  proofShield: {
    alignItems: 'center',
    backgroundColor: palette.navy,
    borderColor: palette.card,
    borderRadius: Radius.pill,
    borderWidth: 3,
    bottom: 72,
    height: 49,
    justifyContent: 'center',
    position: 'absolute',
    right: 76,
    width: 49,
  },
  actions: {
    gap: Spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    minHeight: 55,
    paddingHorizontal: Spacing.lg,
  },
  primaryButton: {
    backgroundColor: palette.navy,
    borderColor: palette.navy,
  },
  secondaryButton: {
    backgroundColor: palette.card,
    borderColor: palette.lineStrong,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.995 }],
  },
  disabledButton: {
    opacity: 0.46,
  },
  buttonText: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  primaryText: {
    color: palette.card,
  },
  secondaryText: {
    color: palette.navy,
  },
  howList: {
    gap: Spacing.md,
  },
  howRow: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.lg,
    minHeight: 118,
    padding: Spacing.lg,
  },
  howIcon: {
    alignItems: 'center',
    backgroundColor: '#F4EFE8',
    borderRadius: 17,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  stepProofIcon: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  numberBadge: {
    alignItems: 'center',
    backgroundColor: palette.navy,
    borderRadius: Radius.pill,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  numberText: {
    color: palette.card,
    fontFamily: Fonts.rounded,
    fontSize: 13,
    fontWeight: '800',
  },
  rowTitle: {
    color: palette.ink,
    flex: 1,
    flexShrink: 1,
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  rowDescription: {
    color: palette.inkSoft,
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  worksWithCard: {
    alignItems: 'center',
    backgroundColor: '#F6F4F1',
    borderColor: palette.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  worksLabel: {
    color: palette.ink,
    fontFamily: Fonts.rounded,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  worksBody: {
    color: palette.inkSoft,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  codeSamples: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  miniQr: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    padding: 6,
    width: 44,
  },
  miniBarcode: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  qrCodeGlyph: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  qrCodeStep: {
    height: 40,
    width: 40,
  },
  qrCodeMini: {
    height: 28,
    width: 28,
  },
  qrCellStep: {
    backgroundColor: 'transparent',
    height: 5.7,
    width: 5.7,
  },
  qrCellMini: {
    backgroundColor: palette.card,
    height: 4,
    width: 4,
  },
  barcodeGlyph: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2.5,
  },
  barcodeStep: {
    height: 20,
  },
  barcodeMini: {
    height: 28,
  },
  barcodeGlyphBar: {
    backgroundColor: palette.navy,
    borderRadius: 1,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
  },
  dot: {
    backgroundColor: '#D8D9DD',
    borderRadius: Radius.pill,
    height: 9,
    width: 9,
  },
  dotActive: {
    backgroundColor: '#263A5E',
  },
  permissionList: {
    gap: Spacing.md,
  },
  permissionRow: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 94,
    padding: Spacing.md,
  },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: palette.lilac,
    borderRadius: 13,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  permissionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  badge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
  },
  successBadge: {
    backgroundColor: palette.greenSoft,
  },
  successBadgeText: {
    color: palette.green,
  },
  warningBadge: {
    backgroundColor: palette.goldSoft,
  },
  warningBadgeText: {
    color: '#8D6A25',
  },
  dangerBadge: {
    backgroundColor: '#FCE8E8',
  },
  dangerBadgeText: {
    color: '#B42318',
  },
  localCard: {
    alignItems: 'center',
    backgroundColor: palette.blueWash,
    borderColor: '#E4E8F5',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 87,
    padding: Spacing.md,
  },
  controlNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    paddingTop: Spacing.xs,
  },
  requirementNote: {
    alignItems: 'flex-start',
  },
  controlText: {
    color: palette.inkSoft,
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    textAlign: 'center',
  },
  requirementText: {
    color: palette.ink,
    textAlign: 'left',
  },
});
