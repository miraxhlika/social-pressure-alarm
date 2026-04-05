import { StyleProp, ViewStyle } from 'react-native';

import { StateCard } from '@/components/ui/state-card';

type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
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
  actionLabel,
  onAction,
  tone = 'canvas',
  variant = 'default',
  actionVariant = 'primary',
  style,
}: EmptyStateProps) {
  return (
    <StateCard
      actionLabel={actionLabel}
      actionVariant={actionVariant}
      align="center"
      description={description}
      eyebrow={eyebrow}
      onAction={onAction}
      style={style}
      title={title}
      tone={tone}
      variant={variant}
    />
  );
}
