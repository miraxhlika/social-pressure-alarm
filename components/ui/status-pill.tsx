import { StyleSheet, Text, View } from 'react-native';

import { Radius, getAppColors, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StatusTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
};

function getPillStyles(tone: StatusTone, colors: ReturnType<typeof getAppColors>) {
  switch (tone) {
    case 'primary':
      return { backgroundColor: colors.primarySurface, color: colors.primary };
    case 'success':
      return { backgroundColor: colors.successSurface, color: colors.success };
    case 'danger':
      return { backgroundColor: colors.dangerSurface, color: colors.danger };
    case 'warning':
      return { backgroundColor: colors.warningSurface, color: colors.warning };
    default:
      return { backgroundColor: colors.cardMuted, color: colors.textSoft };
  }
}

export function StatusPill({ label, tone = 'default' }: StatusPillProps) {
  const colors = getAppColors(useColorScheme());
  const pillStyles = getPillStyles(tone, colors);

  return (
    <View style={[styles.pill, { backgroundColor: pillStyles.backgroundColor }]}>
      <Text numberOfLines={1} style={[styles.label, { color: pillStyles.color }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  label: {
    ...TextPresets.eyebrow,
    letterSpacing: 0.6,
  },
});
