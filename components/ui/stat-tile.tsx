import { StyleSheet, Text } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { getAppColors, Spacing, TextPresets, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StatTileTone = 'default' | 'primary' | 'success' | 'danger';

type StatTileProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: StatTileTone;
};

function getAccentColor(tone: StatTileTone, colors: ReturnType<typeof getAppColors>) {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'danger':
      return colors.danger;
    case 'primary':
      return colors.primary;
    default:
      return colors.text;
  }
}

export function StatTile({ label, value, helper, tone = 'default' }: StatTileProps) {
  const colors = getAppColors(useColorScheme());
  const accentColor = getAccentColor(tone, colors);

  return (
    <AppCard tone={tone === 'default' ? 'muted' : tone} style={styles.card}>
      <Text style={[TextPresets.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      {helper ? <Text style={[TextPresets.body, { color: colors.textSoft }]}>{helper}</Text> : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 132,
  },
  value: {
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
    marginTop: Spacing.xs,
  },
});
