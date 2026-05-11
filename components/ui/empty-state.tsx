import { Ionicons } from '@expo/vector-icons';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { StateCard } from '@/components/ui/state-card';
import { Radius, getAppColors, getTonePalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type EmptyStateIconName = keyof typeof Ionicons.glyphMap;

type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: EmptyStateIconName;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'canvas' | 'transparent';
  variant?: 'default' | 'inline';
  actionVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  eyebrow,
  title,
  description,
  icon,
  actionLabel,
  onAction,
  tone = 'canvas',
  variant = 'default',
  actionVariant = 'primary',
  style,
}: EmptyStateProps) {
  const colors = getAppColors(useColorScheme());
  const palette = getTonePalette(tone === 'transparent' ? 'muted' : tone, colors);
  const iconTone = tone === 'canvas' || tone === 'default' || tone === 'transparent' ? colors.primary : palette.foregroundColor;

  return (
    <StateCard
      actionLabel={actionLabel}
      actionVariant={actionVariant}
      align="center"
      description={description}
      eyebrow={eyebrow}
      leading={
        icon ? (
          <View
            style={[
              styles.iconShell,
              {
                backgroundColor: palette.backgroundColor,
                borderColor: palette.borderColor,
              },
            ]}>
            <View style={[styles.iconInset, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <Ionicons color={iconTone} name={icon} size={32} />
            </View>
          </View>
        ) : undefined
      }
      onAction={onAction}
      style={style}
      title={title}
      tone={tone}
      variant={variant}
    />
  );
}

const styles = StyleSheet.create({
  iconShell: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  iconInset: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
});
