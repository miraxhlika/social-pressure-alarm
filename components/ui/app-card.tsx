import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { SurfaceTone, getAppColors, getTonePalette, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppCardVariant = 'default' | 'hero' | 'inline';

type AppCardProps = PropsWithChildren<{
  tone?: SurfaceTone;
  variant?: AppCardVariant;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
}>;

export function AppCard({ children, tone = 'default', variant = 'default', style, padded = true, elevated = false }: AppCardProps) {
  const colors = getAppColors(useColorScheme());
  const toneStyles = getTonePalette(tone, colors);

  return (
    <View
      style={[
        styles.card,
        variant === 'hero' && styles.hero,
        variant === 'inline' && styles.inline,
        padded && styles.padded,
        padded && variant === 'inline' && styles.paddedInline,
        toneStyles,
        elevated && variant === 'hero' ? Shadows.hero : elevated ? Shadows.card : null,
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.lg,
    margin: 0,
    overflow: 'hidden',
  },
  hero: {
    borderRadius: Radius.xl,
  },
  inline: {
    borderRadius: Radius.md,
  },
  padded: {
    padding: Spacing.xl - 4,
  },
  paddedInline: {
    padding: Spacing.lg,
  },
});
