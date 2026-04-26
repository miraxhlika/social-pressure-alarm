import { forwardRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';

import { Fonts, getAppColors, Radius, Spacing, TextPresets } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppInputProps = TextInputProps & {
  label?: string;
  helper?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  tone?: 'default' | 'danger';
};

export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  { label, helper, error, containerStyle, inputStyle, onBlur, onFocus, style: textInputStyle, tone = 'default', ...props },
  ref
) {
  const colors = getAppColors(useColorScheme());
  const [isFocused, setIsFocused] = useState(false);
  const hasError = tone === 'danger' || Boolean(error);
  const borderColor = hasError ? colors.danger : isFocused ? colors.primary : colors.line;
  const backgroundColor = hasError ? colors.dangerSurface : isFocused ? colors.panel : colors.elevated;
  const helperColor = hasError ? colors.danger : colors.muted;
  const supportingText = error ?? helper;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[styles.label, { color: colors.text }]}>{label}</Text> : null}
      <TextInput
        accessibilityState={{ disabled: props.editable === false }}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={colors.muted}
        ref={ref}
        style={[
          styles.input,
          {
            backgroundColor,
            borderColor,
            color: colors.text,
          },
          isFocused ? styles.inputFocused : null,
          props.multiline ? styles.multiline : null,
          textInputStyle,
          inputStyle,
        ]}
        {...props}
      />
      {supportingText ? <Text style={[styles.supporting, { color: helperColor }]}>{supportingText}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
    minWidth: 0,
  },
  label: {
    ...TextPresets.label,
    flexShrink: 1,
  },
  input: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 54,
    minWidth: 0,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 15,
  },
  inputFocused: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  multiline: {
    minHeight: 112,
    textAlignVertical: 'top',
  },
  supporting: {
    ...TextPresets.body,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
