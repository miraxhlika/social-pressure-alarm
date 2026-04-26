import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatusPill } from '@/components/ui/status-pill';

type RowTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type ActionRowProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  statusLabel?: string;
  statusTone?: RowTone;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ActionRow({
  title,
  description,
  eyebrow,
  accessibilityLabel,
  accessibilityHint,
  leading,
  trailing,
  statusLabel,
  statusTone = 'default',
  onPress,
  disabled = false,
  style,
}: ActionRowProps) {
  const colors = getAppColors(useColorScheme());
  const isInteractive = Boolean(onPress) && !disabled;
  const rowAccessibilityLabel =
    accessibilityLabel ??
    [eyebrow, title, description, statusLabel ? `Status: ${statusLabel}` : null].filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={rowAccessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
      disabled={!isInteractive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.elevated,
          borderColor: colors.line,
          opacity: disabled ? 0.55 : 1,
        },
        pressed ? styles.pressed : null,
        style,
      ]}>
      {leading ? <View style={[styles.leading, { backgroundColor: colors.panelMuted }]}>{leading}</View> : null}
      <View style={styles.copy}>
        {eyebrow ? <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {description ? <Text style={[styles.description, { color: colors.textSoft }]}>{description}</Text> : null}
      </View>
      <View style={styles.trailing}>
        {statusLabel ? <StatusPill label={statusLabel} tone={statusTone} /> : null}
        {trailing}
      </View>
    </Pressable>
  );
}

export function ActionRowGlyph({ label }: { label: string }) {
  const colors = getAppColors(useColorScheme());

  return <Text style={[styles.glyph, { color: colors.primary }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 76,
    minWidth: 0,
    padding: Spacing.md,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.995 }],
  },
  leading: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  glyph: {
    ...TextPresets.label,
    fontSize: 18,
    lineHeight: 22,
  },
  copy: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  title: {
    ...TextPresets.label,
    flexShrink: 1,
  },
  description: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
    maxWidth: '42%',
  },
});
