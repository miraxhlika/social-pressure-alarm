import { StyleSheet, Text, View } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StatTileTone = 'default' | 'primary' | 'success' | 'danger';
type StatTileVariant = 'default' | 'inline';

type StatTileProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: StatTileTone;
  variant?: StatTileVariant;
  progress?: number;
  progressLabel?: string;
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

function clampProgress(progress?: number) {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return null;
  }

  return Math.max(0, Math.min(1, progress));
}

export function StatTile({ label, value, helper, tone = 'default', variant = 'default', progress, progressLabel }: StatTileProps) {
  const colors = getAppColors(useColorScheme());
  const accentColor = getAccentColor(tone, colors);
  const progressValue = clampProgress(progress);
  const progressPercent = progressValue === null ? null : Math.round(progressValue * 100);
  const metricAccessibilityLabel = [label, value, helper, progressPercent === null ? null : `${progressPercent}% progress`]
    .filter(Boolean)
    .join('. ');

  if (variant === 'inline') {
    return (
      <AppCard tone="transparent" variant="inline" padded={false} style={styles.inlineCard}>
        <Text style={[TextPresets.eyebrow, styles.label, { color: colors.muted }]}>{label}</Text>
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.2}
          minimumFontScale={0.78}
          numberOfLines={1}
          style={[styles.value, { color: accentColor }]}>
          {value}
        </Text>
        {progressValue !== null ? (
          <MetricProgressBar
            accessibilityLabel={progressLabel ?? metricAccessibilityLabel}
            accentColor={accentColor}
            progress={progressValue}
            trackColor={colors.line}
          />
        ) : null}
        {helper ? <Text style={[styles.helper, { color: colors.textSoft }]}>{helper}</Text> : null}
      </AppCard>
    );
  }

  return (
    <AppCard tone={tone === 'default' ? 'muted' : tone} style={styles.card}>
      <Text style={[TextPresets.eyebrow, styles.label, { color: colors.muted }]}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.2}
        minimumFontScale={0.78}
        numberOfLines={1}
        style={[styles.value, { color: accentColor }]}>
        {value}
      </Text>
      {progressValue !== null ? (
        <MetricProgressBar
          accessibilityLabel={progressLabel ?? metricAccessibilityLabel}
          accentColor={accentColor}
          progress={progressValue}
          trackColor={colors.line}
        />
      ) : null}
      {helper ? <Text style={[styles.helper, { color: colors.textSoft }]}>{helper}</Text> : null}
    </AppCard>
  );
}

function MetricProgressBar({
  accessibilityLabel,
  accentColor,
  progress,
  trackColor,
}: {
  accessibilityLabel: string;
  accentColor: string;
  progress: number;
  trackColor: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <View style={[styles.progressFill, { backgroundColor: accentColor, width: `${Math.round(progress * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    justifyContent: 'space-between',
    minHeight: 108,
    minWidth: 0,
  },
  inlineCard: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: 4,
    minWidth: 0,
    paddingTop: 3,
  },
  label: {
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 22,
    paddingVertical: 2,
  },
  value: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginTop: 2,
    minWidth: 0,
  },
  helper: {
    ...TextPresets.body,
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 24,
    paddingVertical: 2,
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 6,
    marginTop: Spacing.xs,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
    minWidth: 4,
  },
});
