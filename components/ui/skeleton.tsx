import { ReactNode } from 'react';
import { DimensionValue, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Skeleton } from 'moti/skeleton';

import { Radius, Spacing, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type SkeletonSize = number | DimensionValue;
type SkeletonRadius = number | 'square' | 'round';

type SkeletonBlockProps = {
  width?: SkeletonSize;
  height?: SkeletonSize;
  radius?: SkeletonRadius;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonGroup({ children }: { children: ReactNode }) {
  return <Skeleton.Group show>{children}</Skeleton.Group>;
}

export function SkeletonBlock({ width = '100%', height = 16, radius = Radius.sm, style }: SkeletonBlockProps) {
  const colors = getAppColors(useColorScheme());
  const skeletonColors = [colors.cardMuted, colors.elevated, colors.cardMuted];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}>
      <Skeleton
        backgroundColor={skeletonColors[0]}
        colors={skeletonColors}
        height={height}
        radius={radius}
        width={width}
      />
    </View>
  );
}

export function SkeletonLine({ width = '100%', height = 14, style }: Omit<SkeletonBlockProps, 'radius'>) {
  return <SkeletonBlock height={height} radius={Radius.pill} style={style} width={width} />;
}

export function SkeletonCircle({ size = 48, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return <SkeletonBlock height={size} radius="round" style={style} width={size} />;
}

export function SkeletonTextStack({
  lines = 2,
  widths = ['100%', '72%'],
  style,
}: {
  lines?: number;
  widths?: SkeletonSize[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.textStack, style]}>
      {Array.from({ length: lines }, (_, index) => {
        const fallbackWidth = widths[widths.length - 1] ?? '100%';
        return <SkeletonLine key={index} width={widths[index] ?? fallbackWidth} />;
      })}
    </View>
  );
}

export function SkeletonRefreshPill({ width = 56 }: { width?: SkeletonSize }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.refreshPill, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
      <SkeletonLine height={12} width={width} />
    </View>
  );
}

const styles = StyleSheet.create({
  textStack: {
    gap: Spacing.sm,
    width: '100%',
  },
  refreshPill: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
});
