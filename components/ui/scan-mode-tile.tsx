import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatusPill } from '@/components/ui/status-pill';

type ScanModeTileProps = {
  title: string;
  description: string;
  glyph: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
  statusLabel?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function ScanModeTile({
  title,
  description,
  glyph,
  accessibilityLabel,
  accessibilityHint,
  selected = false,
  statusLabel,
  onPress,
  style,
}: ScanModeTileProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={
        accessibilityLabel ??
        [title, description, statusLabel ? `Status: ${statusLabel}` : null].filter(Boolean).join('. ')
      }
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: selected ? colors.primarySurface : colors.elevated,
          borderColor: selected ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
        style,
      ]}>
      <View style={[styles.glyphWrap, { backgroundColor: selected ? colors.primary : colors.panelMuted }]}>
        <Text style={[styles.glyph, { color: selected ? colors.primaryText : colors.textSoft }]}>{glyph}</Text>
      </View>
      <View style={styles.copy}>
        <View style={styles.header}>
          <Text style={[TextPresets.label, { color: selected ? colors.primary : colors.text }]}>{title}</Text>
          {statusLabel ? <StatusPill label={statusLabel} tone={selected ? 'primary' : 'default'} /> : null}
        </View>
        <Text style={[TextPresets.body, { color: colors.muted }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    minWidth: 0,
    gap: Spacing.md,
    minHeight: 132,
    padding: Spacing.md,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  glyphWrap: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 40,
    justifyContent: 'center',
    width: 48,
  },
  glyph: {
    ...TextPresets.eyebrow,
    letterSpacing: 0.5,
  },
  copy: {
    gap: Spacing.sm,
    minWidth: 0,
  },
  header: {
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
});
