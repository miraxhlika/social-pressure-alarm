import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { getAppColors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppCardTone = 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'canvas';

type AppCardProps = PropsWithChildren<{
  tone?: AppCardTone;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
}>;

function getToneStyles(tone: AppCardTone, colors: ReturnType<typeof getAppColors>) {
  switch (tone) {
    case 'muted':
      return { backgroundColor: colors.cardMuted, borderColor: colors.border };
    case 'primary':
      return { backgroundColor: colors.primarySurface, borderColor: colors.ring };
    case 'success':
      return { backgroundColor: colors.successSurface, borderColor: colors.success };
    case 'danger':
      return { backgroundColor: colors.dangerSurface, borderColor: colors.danger };
    case 'canvas':
      return { backgroundColor: colors.canvas, borderColor: colors.border };
    default:
      return { backgroundColor: colors.card, borderColor: colors.border };
  }
}

export function AppCard({ children, tone = 'default', style, padded = true, elevated = false }: AppCardProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        getToneStyles(tone, colors),
        elevated ? Shadows.card : null,
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
    gap: Spacing.md,
    margin: 0,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.lg,
  },
});
