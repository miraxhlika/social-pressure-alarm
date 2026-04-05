import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getAppColors, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type SectionHeaderProps = {
  title: string;
  description?: string;
  kicker?: string;
  action?: ReactNode;
  size?: 'default' | 'compact';
};

export function SectionHeader({ title, description, kicker, action, size = 'default' }: SectionHeaderProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        {kicker ? <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{kicker}</Text> : null}
        <Text style={[styles.title, size === 'compact' && styles.titleCompact, { color: colors.text }]}>{title}</Text>
        {description ? <Text style={[styles.description, size === 'compact' && styles.descriptionCompact, { color: colors.textSoft }]}>{description}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: Spacing.sm,
  },
  title: {
    ...TextPresets.title,
  },
  titleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  description: {
    ...TextPresets.body,
  },
  descriptionCompact: {
    fontSize: 15,
    lineHeight: 22,
  },
  action: {
    alignSelf: 'flex-start',
    paddingTop: Spacing.xs,
  },
});
