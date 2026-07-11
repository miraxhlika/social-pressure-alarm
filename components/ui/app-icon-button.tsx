import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { getAppColors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppIconButtonProps = {
  accessibilityHint?: string;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: 'default' | 'ghost' | 'danger';
  size?: 'default' | 'compact';
  style?: StyleProp<ViewStyle>;
};

export function AppIconButton({
  accessibilityHint,
  accessibilityLabel,
  icon,
  onPress,
  variant = 'default',
  size = 'default',
  style,
}: AppIconButtonProps) {
  const colors = getAppColors(useColorScheme());
  const isDanger = variant === 'danger';
  const isGhost = variant === 'ghost';

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      android_ripple={{ color: colors.ring }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' && styles.compact,
        {
          backgroundColor: isGhost ? 'transparent' : isDanger ? colors.dangerSurface : colors.elevated,
          borderColor: isGhost ? 'transparent' : isDanger ? colors.danger : colors.line,
        },
        pressed && styles.pressed,
        style,
      ]}>
      <Ionicons
        color={isDanger ? colors.danger : isGhost ? colors.textSoft : colors.text}
        name={icon}
        size={size === 'compact' ? 19 : 21}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  compact: {
    height: 38,
    width: 38,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
});
