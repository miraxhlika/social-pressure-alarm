import { forwardRef } from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';

import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppInputProps = TextInputProps & {
  label?: string;
  helper?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  tone?: 'default' | 'danger';
};

export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  { label, helper, containerStyle, inputStyle, tone = 'default', ...props },
  ref
) {
  const colors = getAppColors(useColorScheme());
  const borderColor = tone === 'danger' ? colors.danger : colors.border;
  const helperColor = tone === 'danger' ? colors.danger : colors.muted;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[TextPresets.label, { color: colors.text }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        ref={ref}
        style={[
          styles.input,
          {
            backgroundColor: colors.cardMuted,
            borderColor,
            color: colors.text,
          },
          inputStyle,
        ]}
        {...props}
      />
      {helper ? <Text style={[TextPresets.body, { color: helperColor }]}>{helper}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
});
