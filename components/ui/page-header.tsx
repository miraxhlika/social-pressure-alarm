import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getAppColors, Spacing, TextPresets, Type, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatusPill } from '@/components/ui/status-pill';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  badgeLabel?: string;
  badgeTone?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
};

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  badgeLabel,
  badgeTone = 'default',
}: PageHeaderProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {description ? <Text style={[TextPresets.body, { color: colors.muted }]}>{description}</Text> : null}
      </View>

      {action ? <View style={styles.action}>{action}</View> : null}
      {badgeLabel ? <StatusPill label={badgeLabel} tone={badgeTone} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  action: {
    alignSelf: 'center',
  },
});
