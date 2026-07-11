import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Fonts, Radius, Shadows, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type DialogTone = 'primary' | 'danger' | 'warning';

type ConfirmDialogOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: DialogTone;
};

type AlertDialogOptions = {
  title: string;
  description: string;
  dismissLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: DialogTone;
};

type ActiveDialog = ConfirmDialogOptions & {
  mode: 'alert' | 'confirm';
};

type AppDialogContextValue = {
  alert: (options: AlertDialogOptions) => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const colors = getAppColors(useColorScheme());
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const isClosingRef = useRef(false);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const cardTranslateY = useRef(new Animated.Value(18)).current;

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    isClosingRef.current = false;
    setDialog({ ...options, mode: 'confirm' });

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const alert = useCallback((options: AlertDialogOptions) => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    isClosingRef.current = false;
    setDialog({
      ...options,
      confirmLabel: options.dismissLabel ?? 'Got it',
      mode: 'alert',
    });

    return new Promise<void>((resolve) => {
      resolveRef.current = () => resolve();
    });
  }, []);

  const dismiss = useCallback((confirmed: boolean) => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: 170,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        duration: 150,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        duration: 170,
        easing: Easing.in(Easing.cubic),
        toValue: 0.97,
        useNativeDriver: true,
      }),
    ]).start(() => {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      setDialog(null);
      isClosingRef.current = false;
      resolve?.(confirmed);
    });
  }, [backdropOpacity, cardOpacity, cardScale]);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    backdropOpacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.94);
    cardTranslateY.setValue(18);

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        damping: 18,
        mass: 0.7,
        stiffness: 230,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        damping: 19,
        mass: 0.75,
        stiffness: 220,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, cardOpacity, cardScale, cardTranslateY, dialog]);

  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
    };
  }, []);

  const tone = dialog?.tone ?? 'primary';
  const toneColor = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.primary;
  const toneSurface =
    tone === 'danger' ? colors.dangerSurface : tone === 'warning' ? colors.warningSurface : colors.primarySurface;
  const confirmTextColor = tone === 'danger' ? colors.dangerText : tone === 'warning' ? colors.warningText : colors.primaryText;

  return (
    <AppDialogContext.Provider value={{ alert, confirm }}>
      {children}
      <Modal
        animationType="none"
        onRequestClose={() => dismiss(false)}
        statusBarTranslucent
        transparent
        visible={Boolean(dialog)}>
        <View style={styles.modalRoot}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.overlay,
                opacity: backdropOpacity,
              },
            ]}>
            <Pressable
              accessibilityLabel="Dismiss dialog"
              accessibilityRole="button"
              onPress={() => dismiss(false)}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {dialog ? (
            <Animated.View
              accessibilityViewIsModal
              style={[
                styles.dialog,
                Shadows.hero,
                {
                  backgroundColor: colors.elevated,
                  borderColor: colors.border,
                  opacity: cardOpacity,
                  transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
                },
              ]}>
              <View style={[styles.iconBadge, { backgroundColor: toneSurface }]}>
                <Ionicons
                  color={toneColor}
                  name={dialog.icon ?? (tone === 'danger' ? 'alert-circle-outline' : 'sparkles-outline')}
                  size={26}
                />
              </View>

              <View style={styles.copy}>
                <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
                  {dialog.title}
                </Text>
                <Text style={[styles.description, { color: colors.textSoft }]}>{dialog.description}</Text>
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => dismiss(true)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: toneColor,
                      borderColor: toneColor,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.confirmLabel, { color: confirmTextColor }]}>{dialog.confirmLabel}</Text>
                </Pressable>
                {dialog.mode === 'confirm' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => dismiss(false)}
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        backgroundColor: colors.panelMuted,
                        borderColor: colors.line,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.cancelLabel, { color: colors.text }]}>{dialog.cancelLabel ?? 'Cancel'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Animated.View>
          ) : null}
        </View>
      </Modal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog() {
  const context = useContext(AppDialogContext);

  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }

  return context;
}

const styles = StyleSheet.create({
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  dialog: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: 1,
    gap: Spacing.xl,
    maxWidth: 390,
    padding: Spacing.xl,
    width: '100%',
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  copy: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
    textAlign: 'center',
  },
  description: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 310,
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.sm,
    width: '100%',
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
  },
  confirmLabel: {
    ...TextPresets.label,
    fontSize: 14,
    fontWeight: '800',
  },
  cancelLabel: {
    ...TextPresets.label,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
});
