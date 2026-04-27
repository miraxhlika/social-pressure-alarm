import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { DimensionValue, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing, TextPresets, getAppColors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type FlowVisualTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';
type DotTone = 'high' | 'medium' | 'low' | 'missed' | 'empty' | 'blank';

function getToneColor(tone: FlowVisualTone, colors: ReturnType<typeof getAppColors>) {
  switch (tone) {
    case 'primary':
      return colors.primary;
    case 'success':
      return colors.success;
    case 'danger':
      return colors.danger;
    case 'warning':
      return colors.warning;
    case 'muted':
      return colors.muted;
    default:
      return colors.text;
  }
}

export function FlowInfoLine({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.infoLine, { borderColor: colors.line }]}>
      <View style={styles.infoLineLabel}>
        <Ionicons color={colors.muted} name={icon} size={14} />
        <Text style={[styles.infoLabel, { color: colors.textSoft }]}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.infoValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

export function FlowProgressBar({
  progress,
  tone = 'success',
  style,
}: {
  progress: number;
  tone?: FlowVisualTone;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = getAppColors(useColorScheme());
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const width = `${Math.round(clampedProgress * 100)}%` as DimensionValue;

  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.line }, style]}>
      <View style={[styles.progressFill, { backgroundColor: getToneColor(tone, colors), width }]} />
    </View>
  );
}

export function FlowDelta({
  value,
  tone = 'success',
}: {
  value: string;
  tone?: 'success' | 'danger' | 'warning';
}) {
  const colors = getAppColors(useColorScheme());
  const color = getToneColor(tone, colors);
  const icon = tone === 'danger' ? 'caret-down' : tone === 'warning' ? 'remove' : 'caret-up';

  return (
    <View style={styles.delta}>
      <Ionicons color={color} name={icon} size={9} />
      <Text style={[styles.deltaText, { color }]}>{value}</Text>
    </View>
  );
}

export function FlowCodePreview({ label }: { label?: string }) {
  const colors = getAppColors(useColorScheme());
  const cells = Array.from({ length: 25 }, (_, index) => {
    const filled = [0, 1, 2, 5, 7, 10, 11, 14, 17, 18, 20, 22, 23, 24].includes(index);
    return <View key={index} style={[styles.qrCell, { backgroundColor: filled ? colors.text : colors.elevated }]} />;
  });

  return (
    <View style={styles.codePreviewWrap}>
      <View style={[styles.qrPreview, { backgroundColor: colors.elevated, borderColor: colors.line }]}>{cells}</View>
      {label ? <Text style={[styles.codeLabel, { color: colors.textSoft }]}>{label}</Text> : null}
    </View>
  );
}

export function FlowBarcodePreview() {
  const colors = getAppColors(useColorScheme());
  const bars = [3, 1, 5, 2, 4, 1, 5, 2, 3, 1, 4, 2, 5, 1, 3];

  return (
    <View style={[styles.barcodePreview, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      {bars.map((bar, index) => (
        <View
          key={`${bar}-${index}`}
          style={[
            styles.barcodeBar,
            {
              backgroundColor: colors.text,
              height: 20 + bar * 5,
              width: bar > 3 ? 3 : 2,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function FlowMetricCard({
  children,
  label,
  value,
  tone = 'default',
  footer,
  style,
}: {
  children?: ReactNode;
  label: string;
  value: string;
  tone?: FlowVisualTone;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.metricCard, { backgroundColor: colors.elevated, borderColor: colors.line }, style]}>
      <Text style={[styles.metricLabel, { color: colors.textSoft }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: getToneColor(tone, colors) }]}>{value}</Text>
      {children}
      {footer}
    </View>
  );
}

export function FlowTrendLine({ points = [], tone = 'success' }: { points?: number[]; tone?: FlowVisualTone }) {
  const colors = getAppColors(useColorScheme());
  const color = getToneColor(tone, colors);
  const chartPoints = points.length > 0 ? points : [0, 0, 0, 0, 0, 0, 0];
  const maxPoint = Math.max(...chartPoints, 1);
  const chartWidth = 112;
  const chartHeight = 34;
  const step = chartWidth / Math.max(1, chartPoints.length - 1);
  const normalizedPoints = chartPoints.map((point, index) => ({
    x: index * step,
    y: chartHeight - 4 - (point / maxPoint) * 24,
  }));
  const lineColor = chartPoints.some((point) => point > 0) ? color : colors.line;

  return (
    <View style={styles.trendLine}>
      {normalizedPoints.slice(0, -1).map((point, index) => {
        const nextPoint = normalizedPoints[index + 1];
        const deltaX = nextPoint.x - point.x;
        const deltaY = nextPoint.y - point.y;
        const width = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const angle = `${Math.atan2(deltaY, deltaX)}rad`;

        return (
          <View
            key={`${point.x}-${point.y}-${index}`}
            style={[
              styles.trendSegment,
              {
                backgroundColor: lineColor,
                left: point.x,
                opacity: chartPoints[index] > 0 || chartPoints[index + 1] > 0 ? 1 : 0.7,
                top: point.y,
                transform: [{ rotate: angle }],
                width,
              },
            ]}
          />
        );
      })}
      {normalizedPoints.map((point, index) => (
        <View
          key={`point-${point.x}-${point.y}-${index}`}
          style={[
            styles.trendPoint,
            {
              backgroundColor: chartPoints[index] > 0 ? color : 'transparent',
              left: point.x - 2,
              top: point.y - 2,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function FlowCalendarDots({ dots }: { dots: DotTone[] }) {
  const colors = getAppColors(useColorScheme());

  const getDotColor = (tone: DotTone) => {
    switch (tone) {
      case 'high':
        return colors.success;
      case 'medium':
        return withAlpha(colors.success, '8C');
      case 'low':
        return withAlpha(colors.warning, '55');
      case 'missed':
        return withAlpha(colors.danger, '70');
      case 'blank':
        return 'transparent';
      default:
        return colors.line;
    }
  };

  return (
    <View style={styles.calendarGrid}>
      {dots.map((dot, index) => (
        <View
          key={`${dot}-${index}`}
          style={styles.calendarCell}>
          <View
            style={[
              styles.calendarDot,
              {
                backgroundColor: getDotColor(dot),
                opacity: dot === 'empty' ? 0.7 : dot === 'blank' ? 0 : 1,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

export function FlowLegend({ items }: { items: { label: string; tone: DotTone }[] }) {
  const colors = getAppColors(useColorScheme());

  const getDotColor = (tone: DotTone) => {
    switch (tone) {
      case 'high':
        return colors.success;
      case 'medium':
        return withAlpha(colors.success, '8C');
      case 'low':
        return withAlpha(colors.warning, '55');
      case 'missed':
        return withAlpha(colors.danger, '70');
      case 'blank':
        return 'transparent';
      default:
        return colors.line;
    }
  };

  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: getDotColor(item.tone) }]} />
          <Text style={[styles.legendLabel, { color: colors.textSoft }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  infoLine: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    minHeight: 32,
    paddingVertical: 7,
  },
  infoLineLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 7,
    minWidth: 0,
  },
  infoLabel: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  infoValue: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
    maxWidth: '55%',
    textAlign: 'right',
  },
  progressTrack: {
    borderRadius: Radius.pill,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    borderRadius: Radius.pill,
    height: '100%',
    minWidth: 4,
  },
  delta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  deltaText: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 12,
    textTransform: 'none',
  },
  codePreviewWrap: {
    alignItems: 'center',
    gap: 3,
  },
  qrPreview: {
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    height: 42,
    padding: 5,
    width: 42,
  },
  qrCell: {
    borderRadius: 1,
    height: 4,
    width: 4,
  },
  codeLabel: {
    ...TextPresets.body,
    fontSize: 9,
    lineHeight: 11,
  },
  barcodePreview: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    height: 45,
    justifyContent: 'center',
    paddingHorizontal: 8,
    width: 58,
  },
  barcodeBar: {
    borderRadius: 1,
  },
  metricCard: {
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 0,
    padding: 10,
  },
  metricLabel: {
    ...TextPresets.body,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.7,
    lineHeight: 30,
  },
  trendLine: {
    height: 34,
    marginTop: 2,
    overflow: 'hidden',
    position: 'relative',
    width: 112,
  },
  trendSegment: {
    height: 2,
    position: 'absolute',
    transformOrigin: 'left center',
  },
  trendPoint: {
    borderRadius: Radius.pill,
    height: 4,
    position: 'absolute',
    width: 4,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: Spacing.xs,
    width: '100%',
  },
  calendarCell: {
    alignItems: 'center',
    flexBasis: '14.2857%',
    justifyContent: 'center',
    paddingVertical: 5,
  },
  calendarDot: {
    borderRadius: Radius.pill,
    height: 12,
    width: 12,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 2,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  legendDot: {
    borderRadius: Radius.pill,
    height: 6,
    width: 6,
  },
  legendLabel: {
    ...TextPresets.body,
    fontSize: 9,
    lineHeight: 11,
  },
});
