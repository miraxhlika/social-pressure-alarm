import { StyleSheet, Text } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Fonts, getAppColors, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StatTileTone = 'default' | 'primary' | 'success' | 'danger';
type StatTileVariant = 'default' | 'inline';

type StatTileProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: StatTileTone;
  variant?: StatTileVariant;
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

export function StatTile({ label, value, helper, tone = 'default', variant = 'default' }: StatTileProps) {
  const colors = getAppColors(useColorScheme());
  const accentColor = getAccentColor(tone, colors);

  if (variant === 'inline') {
    return (
      <AppCard tone="transparent" variant="inline" padded={false} style={styles.inlineCard}>
        <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
        {helper ? <Text style={[styles.helper, { color: colors.textSoft }]}>{helper}</Text> : null}
      </AppCard>
    );
  }

  return (
    <AppCard tone={tone === 'default' ? 'muted' : tone} style={styles.card}>
      <Text style={[TextPresets.eyebrow, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      {helper ? <Text style={[styles.helper, { color: colors.textSoft }]}>{helper}</Text> : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    justifyContent: 'space-between',
    minHeight: 108,
  },
  inlineCard: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: 4,
  },
  value: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginTop: 2,
  },
  helper: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
