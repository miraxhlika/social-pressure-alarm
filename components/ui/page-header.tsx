import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getAppColors, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatusPill } from '@/components/ui/status-pill';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  badgeLabel?: string;
  badgeTone?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
  size?: 'default' | 'compact';
};

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  badgeLabel,
  badgeTone = 'default',
  size = 'default',
}: PageHeaderProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        {(eyebrow || badgeLabel) ? (
          <View style={styles.metaRow}>
            {eyebrow ? <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
            {badgeLabel ? <StatusPill label={badgeLabel} tone={badgeTone} /> : null}
          </View>
        ) : null}
        <Text style={[styles.title, size === 'compact' && styles.titleCompact, { color: colors.text }]}>{title}</Text>
        {description ? (
          <Text style={[styles.description, size === 'compact' && styles.descriptionCompact, { color: colors.textSoft }]}>
            {description}
          </Text>
        ) : null}
      </View>

      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: Spacing.sm,
    minWidth: 220,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  title: {
    ...TextPresets.titleLg,
    flexShrink: 1,
  },
  titleCompact: {
    ...TextPresets.title,
  },
  description: {
    ...TextPresets.body,
    flexShrink: 1,
    maxWidth: 520,
  },
  descriptionCompact: {
    fontSize: 15,
    lineHeight: 22,
  },
  action: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    paddingTop: Spacing.xs,
  },
});
