import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup, SkeletonLine, SkeletonTextStack } from '@/components/ui/skeleton';
import { Radius, Spacing, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type LoadingBlockProps = {
  title?: string;
  description?: string;
  tone?: 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'canvas' | 'transparent';
  variant?: 'default' | 'inline';
  layout?: 'default' | 'hero' | 'list' | 'detail' | 'analytics' | 'compact';
  style?: StyleProp<ViewStyle>;
};

export function LoadingBlock({
  title = 'Loading',
  description = 'Pulling in the latest data.',
  tone = 'muted',
  variant = 'default',
  layout,
  style,
}: LoadingBlockProps) {
  const resolvedLayout = layout ?? (variant === 'inline' ? 'compact' : 'default');
  const usesBareCanvas = ['analytics', 'compact', 'detail', 'list'].includes(resolvedLayout);

  return (
    <View
      accessibilityLabel={`${title}. ${description}`}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}>
      <AppCard
        elevated={variant !== 'inline' && !usesBareCanvas}
        tone={usesBareCanvas || (variant === 'inline' && tone === 'default') ? 'transparent' : tone}
        variant={variant === 'inline' ? 'inline' : 'default'}
        style={[
          styles.card,
          usesBareCanvas && styles.bareCard,
          variant === 'inline' && styles.inlineCard,
          style,
        ]}>
        <SkeletonGroup>
          {resolvedLayout === 'compact' ? (
            <CompactSkeleton />
          ) : resolvedLayout === 'hero' ? (
            <HeroSkeleton />
          ) : resolvedLayout === 'list' ? (
            <ListSkeleton />
          ) : resolvedLayout === 'detail' ? (
            <DetailSkeleton />
          ) : resolvedLayout === 'analytics' ? (
            <AnalyticsSkeleton />
          ) : (
            <DefaultSkeleton />
          )}
        </SkeletonGroup>
      </AppCard>
    </View>
  );
}

function DefaultSkeleton() {
  return (
    <>
      <View style={styles.headerRow}>
        <SkeletonCircle size={44} />
        <View style={styles.headerCopy}>
          <SkeletonLine height={20} width="64%" />
          <SkeletonTextStack lines={2} widths={['92%', '64%']} />
        </View>
      </View>
      <View style={styles.bodyStack}>
        <SkeletonBlock height={56} radius={Radius.md} />
        <SkeletonTextStack lines={2} widths={['86%', '58%']} />
      </View>
    </>
  );
}

function CompactSkeleton() {
  return (
    <View style={styles.compactStack}>
      <SkeletonLine height={18} width="56%" />
      <SkeletonTextStack lines={2} widths={['84%', '42%']} />
    </View>
  );
}

function HeroSkeleton() {
  return (
    <>
      <View style={styles.heroHeader}>
        <View style={styles.headerCopy}>
          <SkeletonLine height={14} width={92} />
          <SkeletonLine height={28} width="72%" />
          <SkeletonTextStack lines={2} widths={['88%', '54%']} />
        </View>
        <SkeletonCircle size={52} />
      </View>
      <View style={styles.bodyStack}>
        <SkeletonBlock height={46} radius={Radius.md} />
        <View style={styles.metricRow}>
          <SkeletonBlock height={60} radius={Radius.md} style={styles.flexBlock} />
          <SkeletonBlock height={60} radius={Radius.md} style={styles.flexBlock} />
        </View>
      </View>
    </>
  );
}

function ListSkeleton() {
  return (
    <View style={styles.bodyStack}>
      <SkeletonListRow />
      <SkeletonListRow />
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={styles.bodyStack}>
      <View style={styles.headerRow}>
        <SkeletonCircle size={48} />
        <View style={styles.headerCopy}>
          <SkeletonLine height={22} width="68%" />
          <SkeletonLine width="46%" />
        </View>
      </View>
      <SkeletonBlock height={72} radius={Radius.md} />
      <SkeletonBlock height={60} radius={Radius.md} />
      <View style={styles.metricRow}>
        <SkeletonBlock height={64} radius={Radius.md} style={styles.flexBlock} />
        <SkeletonBlock height={64} radius={Radius.md} style={styles.flexBlock} />
      </View>
    </View>
  );
}

function AnalyticsSkeleton() {
  return (
    <View style={styles.bodyStack}>
      <View style={styles.analyticsHero}>
        <View style={styles.headerCopy}>
          <SkeletonLine height={14} width={132} />
          <SkeletonLine height={42} width={112} />
          <SkeletonLine width={78} />
        </View>
        <SkeletonCircle size={72} />
      </View>
      <View style={styles.metricRow}>
        <SkeletonBlock height={88} radius={Radius.md} style={styles.flexBlock} />
        <SkeletonBlock height={88} radius={Radius.md} style={styles.flexBlock} />
      </View>
      <SkeletonBlock height={120} radius={Radius.md} />
    </View>
  );
}

function SkeletonListRow() {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.listRow, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
      <SkeletonCircle size={40} />
      <View style={styles.headerCopy}>
        <SkeletonLine height={16} width="58%" />
        <SkeletonLine height={12} width="34%" />
      </View>
      <SkeletonBlock height={32} radius={Radius.pill} width={68} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.lg,
  },
  bareCard: {
    padding: 0,
  },
  inlineCard: {
    minHeight: 72,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  headerCopy: {
    flex: 1,
    gap: Spacing.sm,
    minWidth: 0,
  },
  bodyStack: {
    gap: Spacing.md,
    width: '100%',
  },
  compactStack: {
    gap: Spacing.md,
    width: '100%',
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    width: '100%',
  },
  metricRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    width: '100%',
  },
  flexBlock: {
    flex: 1,
  },
  listRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 72,
    padding: Spacing.md,
    width: '100%',
  },
  analyticsHero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    width: '100%',
  },
});
