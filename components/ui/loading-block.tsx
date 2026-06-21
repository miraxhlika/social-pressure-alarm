import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup, SkeletonLine, SkeletonTextStack } from '@/components/ui/skeleton';
import { Radius, Spacing } from '@/constants/theme';

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

  return (
    <View
      accessibilityLabel={`${title}. ${description}`}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}>
      <AppCard
        elevated={variant !== 'inline'}
        tone={variant === 'inline' && tone === 'default' ? 'transparent' : tone}
        variant={variant === 'inline' ? 'inline' : 'default'}
        style={[styles.card, variant === 'inline' && styles.inlineCard, style]}>
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
        <SkeletonCircle size={54} />
        <View style={styles.headerCopy}>
          <SkeletonLine height={24} width="72%" />
          <SkeletonTextStack lines={2} widths={['92%', '64%']} />
        </View>
      </View>
      <View style={styles.bodyStack}>
        <SkeletonBlock height={68} radius={Radius.md} />
        <SkeletonTextStack lines={2} widths={['86%', '58%']} />
      </View>
    </>
  );
}

function CompactSkeleton() {
  return (
    <View style={styles.compactStack}>
      <SkeletonLine height={22} width="68%" />
      <SkeletonTextStack lines={2} widths={['92%', '56%']} />
    </View>
  );
}

function HeroSkeleton() {
  return (
    <>
      <View style={styles.heroHeader}>
        <View style={styles.headerCopy}>
          <SkeletonLine height={14} width={92} />
          <SkeletonLine height={30} width="84%" />
          <SkeletonTextStack lines={2} widths={['96%', '62%']} />
        </View>
        <SkeletonCircle size={64} />
      </View>
      <View style={styles.bodyStack}>
        <SkeletonBlock height={54} radius={Radius.md} />
        <View style={styles.metricRow}>
          <SkeletonBlock height={72} radius={Radius.md} style={styles.flexBlock} />
          <SkeletonBlock height={72} radius={Radius.md} style={styles.flexBlock} />
        </View>
      </View>
    </>
  );
}

function ListSkeleton() {
  return (
    <View style={styles.bodyStack}>
      <SkeletonTextStack lines={2} widths={['64%', '90%']} />
      <SkeletonListRow />
      <SkeletonListRow />
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={styles.bodyStack}>
      <View style={styles.headerRow}>
        <SkeletonCircle size={58} />
        <View style={styles.headerCopy}>
          <SkeletonLine height={26} width="78%" />
          <SkeletonLine width="46%" />
        </View>
      </View>
      <SkeletonBlock height={86} radius={Radius.md} />
      <SkeletonBlock height={72} radius={Radius.md} />
      <View style={styles.metricRow}>
        <SkeletonBlock height={76} radius={Radius.md} style={styles.flexBlock} />
        <SkeletonBlock height={76} radius={Radius.md} style={styles.flexBlock} />
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
        <SkeletonCircle size={88} />
      </View>
      <View style={styles.metricRow}>
        <SkeletonBlock height={112} radius={Radius.md} style={styles.flexBlock} />
        <SkeletonBlock height={112} radius={Radius.md} style={styles.flexBlock} />
      </View>
      <SkeletonBlock height={168} radius={Radius.md} />
    </View>
  );
}

function SkeletonListRow() {
  return (
    <View style={styles.listRow}>
      <SkeletonCircle size={44} />
      <View style={styles.headerCopy}>
        <SkeletonLine height={18} width="72%" />
        <SkeletonLine width="94%" />
        <SkeletonLine width="48%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.lg,
    minHeight: 168,
  },
  inlineCard: {
    minHeight: 112,
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
    flexDirection: 'row',
    gap: Spacing.md,
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
