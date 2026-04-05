import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, getAppColors, getTonePalette, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StatusTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
}

export function StatusPill({ label, tone = 'default' }: StatusPillProps) {
  const colors = getAppColors(useColorScheme());
  const pillStyles = getTonePalette(tone, colors);

  return (
    <View style={[styles.pill, { backgroundColor: pillStyles.backgroundColor, borderColor: pillStyles.borderColor }]}>
      <View style={[styles.dot, { backgroundColor: pillStyles.foregroundColor }]} />
      <Text numberOfLines={1} style={[styles.label, { color: pillStyles.foregroundColor }]}>
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
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm - 2,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dot: {
    borderRadius: Radius.pill,
    height: 4,
    width: 4,
  },
  label: {
    ...TextPresets.eyebrow,
    letterSpacing: 0.5,
  },
});
