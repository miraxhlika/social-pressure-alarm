import { PropsWithChildren, ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type StateCardTone = 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'canvas' | 'transparent';

type StateCardProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: StateCardTone;
  variant?: 'default' | 'inline';
  actionVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
  align?: 'start' | 'center';
  leading?: ReactNode;
}>;

export function StateCard({
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
  tone = 'default',
  variant = 'default',
  actionVariant = 'primary',
  style,
  children,
  align = 'start',
  leading,
}: StateCardProps) {
  const colors = getAppColors(useColorScheme());
  const isCentered = align === 'center';

  return (
    <AppCard
      elevated={variant !== 'inline'}
      tone={variant === 'inline' && tone === 'default' ? 'transparent' : tone}
      variant={variant === 'inline' ? 'inline' : 'default'}
      style={[styles.card, variant === 'inline' && styles.inlineCard, isCentered && styles.centeredCard, style]}>
      {leading ? <View style={[styles.leadingWrap, isCentered && styles.leadingCentered]}>{leading}</View> : null}
      {eyebrow ? (
        <Text style={[TextPresets.eyebrow, { color: colors.primary }, isCentered && styles.centeredText]}>{eyebrow}</Text>
      ) : null}
      <Text style={[styles.title, variant === 'inline' && styles.titleInline, { color: colors.text }, isCentered && styles.centeredText]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: colors.textSoft }, isCentered && styles.centeredText]}>{description}</Text>
      {children ? <View style={[styles.childrenWrap, isCentered && styles.childrenCentered]}>{children}</View> : null}
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} style={isCentered ? styles.actionCentered : undefined} variant={actionVariant} />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
    minHeight: 168,
  },
  inlineCard: {
    alignItems: 'flex-start',
    minHeight: 112,
  },
  centeredCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadingWrap: {
    alignItems: 'flex-start',
  },
  leadingCentered: {
    alignItems: 'center',
  },
  title: {
    ...TextPresets.title,
  },
  titleInline: {
    fontSize: 22,
    lineHeight: 28,
  },
  description: {
    ...TextPresets.body,
    maxWidth: 520,
  },
  childrenWrap: {
    gap: Spacing.sm,
    width: '100%',
  },
  childrenCentered: {
    alignItems: 'center',
  },
  actionCentered: {
    minWidth: 180,
  },
  centeredText: {
    textAlign: 'center',
  },
});
