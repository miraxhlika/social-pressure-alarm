import { ActivityIndicator, StyleProp, ViewStyle } from 'react-native';

import { StateCard } from '@/components/ui/state-card';
import { getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type LoadingBlockProps = {
  title?: string;
  description?: string;
  tone?: 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'canvas' | 'transparent';
  variant?: 'default' | 'inline';
  style?: StyleProp<ViewStyle>;
};

export function LoadingBlock({
  title = 'Loading',
  description = 'Pulling in the latest data.',
  tone = 'muted',
  variant = 'default',
  style,
}: LoadingBlockProps) {
  const colors = getAppColors(useColorScheme());

  return (
    <StateCard
      align="center"
      description={description}
      leading={<ActivityIndicator color={colors.primary} />}
      style={style}
      title={title}
      tone={tone}
      variant={variant}
    />
  );
}
