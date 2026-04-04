import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getAppColors, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type SectionHeaderProps = {
  title: string;
  description?: string;
  kicker?: string;
  action?: ReactNode;
};

export function SectionHeader({ title, description, kicker, action }: SectionHeaderProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        {kicker ? <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{kicker}</Text> : null}
        <Text style={[TextPresets.title, { color: colors.text }]}>{title}</Text>
        {description ? <Text style={[TextPresets.body, { color: colors.muted }]}>{description}</Text> : null}
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
    gap: Spacing.xs,
  },
  action: {
    alignSelf: 'center',
    paddingTop: Spacing.xs,
  },
});
