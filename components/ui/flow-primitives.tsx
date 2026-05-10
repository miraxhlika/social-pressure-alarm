import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, getAppColors, getTonePalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type IconName = keyof typeof Ionicons.glyphMap;
type FlowTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

type FlowTopBarProps = {
  title: string;
  subtitle?: string;
  leftIcon?: IconName;
  rightIcon?: IconName;
  onLeftPress?: () => void;
  onRightPress?: () => void;
  leftAccessibilityLabel?: string;
  rightAccessibilityLabel?: string;
};

export function FlowTopBar({
  title,
  subtitle,
  leftIcon = 'menu-outline',
  rightIcon,
  onLeftPress,
  onRightPress,
  leftAccessibilityLabel = 'Open menu',
  rightAccessibilityLabel = 'Open action',
}: FlowTopBarProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel={leftAccessibilityLabel}
        accessibilityRole="button"
        disabled={!onLeftPress}
        onPress={onLeftPress}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Ionicons color={colors.text} name={leftIcon} size={22} />
      </Pressable>

      <View style={styles.topBarCopy}>
        <Text style={[styles.topBarTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.topBarSubtitle, { color: colors.textSoft }]}>{subtitle}</Text> : null}
      </View>

      <Pressable
        accessibilityLabel={rightAccessibilityLabel}
        accessibilityRole="button"
        disabled={!rightIcon || !onRightPress}
        onPress={onRightPress}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        {rightIcon ? <Ionicons color={colors.text} name={rightIcon} size={21} /> : <View style={styles.iconPlaceholder} />}
      </Pressable>
    </View>
  );
}

export function FlowIconBadge({
  icon,
  label,
  tone = 'default',
  size = 'default',
}: {
  icon?: IconName;
  label?: string;
  tone?: FlowTone;
  size?: 'default' | 'small' | 'large';
}) {
  const colors = getAppColors(useColorScheme());
  const palette = getTonePalette(tone === 'muted' ? 'muted' : tone, colors);

  return (
    <View
      style={[
        styles.badge,
        size === 'small' && styles.badgeSmall,
        size === 'large' && styles.badgeLarge,
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
      ]}>
      {icon ? (
        <Ionicons color={palette.foregroundColor} name={icon} size={size === 'large' ? 31 : size === 'small' ? 17 : 23} />
      ) : (
        <Text style={[styles.badgeLabel, { color: palette.foregroundColor }]}>{label}</Text>
      )}
    </View>
  );
}

export function FlowPanel({
  children,
  style,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: FlowTone | 'canvas';
}) {
  const colors = getAppColors(useColorScheme());
  const palette = getTonePalette(tone === 'canvas' ? 'canvas' : tone === 'muted' ? 'muted' : tone, colors);

  return <View style={[styles.panel, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }, style]}>{children}</View>;
}

export function FlowListRow({
  title,
  description,
  eyebrow,
  leading,
  trailing,
  statusLabel,
  statusTone = 'default',
  onPress,
  accessibilityLabel,
  style,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  statusLabel?: string;
  statusTone?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = getAppColors(useColorScheme());
  const content = (
    <>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={styles.rowCopy}>
        {eyebrow ? <Text style={[styles.rowEyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
        <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        {description ? <Text style={[styles.rowDescription, { color: colors.textSoft }]}>{description}</Text> : null}
      </View>
      <View style={styles.rowTrailing}>
        {statusLabel ? <StatusPill label={statusLabel} tone={statusTone} /> : null}
        {trailing}
        {onPress ? <Ionicons color={colors.muted} name="chevron-forward" size={17} /> : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel ?? [eyebrow, title, description, statusLabel].filter(Boolean).join('. ')}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.listRow,
          { backgroundColor: colors.elevated, borderColor: colors.line },
          pressed && styles.pressed,
          style,
        ]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.listRow, { backgroundColor: colors.elevated, borderColor: colors.line }, style]}>{content}</View>;
}

export function FlowSectionLabel({ children }: { children: ReactNode }) {
  const colors = getAppColors(useColorScheme());

  return <Text style={[styles.sectionLabel, { color: colors.textSoft }]}>{children}</Text>;
}

export function FlowFooterButton({
  label,
  onPress,
  disabled,
  icon = 'add',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        { backgroundColor: colors.text, borderColor: colors.text, opacity: disabled ? 0.45 : 1 },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.footerButtonLabel, { color: colors.elevated }]}>
        {icon === 'add' ? '+  ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function FlowMetricTile({
  label,
  value,
  helper,
  tone = 'primary',
  children,
}: {
  label: string;
  value: string;
  helper: string;
  tone?: FlowTone;
  children?: ReactNode;
}) {
  const colors = getAppColors(useColorScheme());
  const palette = getTonePalette(tone === 'muted' ? 'muted' : tone, colors);

  return (
    <View style={[styles.metricTile, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
      <Text style={[styles.sectionLabel, { color: colors.textSoft }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: palette.foregroundColor }]}>{value}</Text>
      <Text style={[styles.metricHelper, { color: colors.textSoft }]}>{helper}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconPlaceholder: {
    height: 21,
    width: 21,
  },
  topBarCopy: {
    alignItems: 'center',
    flex: 1,
    gap: 1,
  },
  topBarTitle: {
    fontFamily: Fonts.serif,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.35,
    lineHeight: 23,
    textAlign: 'center',
  },
  topBarSubtitle: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  badge: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  badgeSmall: {
    borderRadius: Radius.sm,
    height: 32,
    width: 32,
  },
  badgeLarge: {
    borderRadius: 14,
    height: 56,
    width: 56,
  },
  badgeLabel: {
    ...TextPresets.label,
    fontSize: 18,
    lineHeight: 22,
  },
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  listRow: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  rowLeading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  rowEyebrow: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    lineHeight: 13,
  },
  rowTitle: {
    ...TextPresets.label,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  rowDescription: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  rowTrailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'flex-end',
  },
  sectionLabel: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    letterSpacing: 0.45,
    lineHeight: 13,
  },
  footerButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: Spacing.lg,
  },
  footerButtonLabel: {
    ...TextPresets.label,
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  metricTile: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
    padding: 11,
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 31,
  },
  metricHelper: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 16,
  },
});
