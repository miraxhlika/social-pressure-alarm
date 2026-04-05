import { Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';

import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type AppButtonSize = 'default' | 'compact';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

function getVariantStyles(variant: AppButtonVariant, colors: ReturnType<typeof getAppColors>) {
  switch (variant) {
    case 'secondary':
      return {
        container: {
          backgroundColor: colors.elevated,
          borderColor: colors.line,
        },
        label: {
          color: colors.text,
        },
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
          borderColor: colors.line,
        },
        label: {
          color: colors.textSoft,
        },
      };
    case 'danger':
      return {
        container: {
          backgroundColor: colors.dangerSurface,
          borderColor: colors.danger,
        },
        label: {
          color: colors.danger,
        },
      };
    default:
      return {
        container: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        label: {
          color: colors.primaryText,
        },
      };
  }
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  size = 'default',
  disabled = false,
  style,
  textStyle,
}: AppButtonProps) {
  const colors = getAppColors(useColorScheme());
  const variantStyles = getVariantStyles(variant, colors);

  return (
    <Pressable
      android_ripple={{ color: colors.ring }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' ? styles.compact : null,
        variantStyles.container,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
        style,
      ]}>
      <Text style={[styles.label, size === 'compact' ? styles.compactLabel : null, variantStyles.label, textStyle]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
  },
  compact: {
    borderRadius: Radius.md,
    minHeight: 42,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  label: {
    ...TextPresets.label,
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.12,
    textAlign: 'center',
  },
  compactLabel: {
    fontSize: 13,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
});
