import { createContext, ReactNode, useContext, useEffect, useRef } from 'react';
import { Animated, DimensionValue, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

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

const SkeletonPulseContext = createContext<Animated.Value | null>(null);

export function SkeletonGroup({ children }: { children: ReactNode }) {
  const parentPulse = useContext(SkeletonPulseContext);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (parentPulse) {
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [parentPulse, pulse]);

  return <SkeletonPulseContext.Provider value={parentPulse ?? pulse}>{children}</SkeletonPulseContext.Provider>;
}

export function SkeletonBlock({ width = '100%', height = 16, radius = Radius.sm, style }: SkeletonBlockProps) {
  const colors = getAppColors(useColorScheme());
  const pulse = useContext(SkeletonPulseContext);
  const borderRadius = radius === 'round' ? Radius.pill : radius === 'square' ? 0 : radius;
  const opacity = pulse
    ? pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.48, 0.9],
      })
    : 0.68;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          backgroundColor: colors.border,
          borderRadius,
          height,
          opacity,
          width,
        },
        style,
      ]}
    />
  );
}

export function SkeletonLine({ width = '100%', height = 11, style }: Omit<SkeletonBlockProps, 'radius'>) {
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
    <SkeletonGroup>
      <View style={[styles.textStack, style]}>
        {Array.from({ length: lines }, (_, index) => {
          const fallbackWidth = widths[widths.length - 1] ?? '100%';
          return <SkeletonLine key={index} width={widths[index] ?? fallbackWidth} />;
        })}
      </View>
    </SkeletonGroup>
  );
}

export function SkeletonRefreshPill({ width = 56 }: { width?: SkeletonSize }) {
  const colors = getAppColors(useColorScheme());

  return (
    <SkeletonGroup>
      <View style={[styles.refreshPill, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
        <SkeletonLine height={10} width={width} />
      </View>
    </SkeletonGroup>
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
