import { PropsWithChildren, ReactNode, RefObject, useEffect, useRef } from 'react';
import { Animated, Easing, Keyboard, Platform, ScrollView, ScrollViewProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppScreenProps = PropsWithChildren<{
  footer?: ReactNode;
  keyboardAware?: boolean;
  scroll?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle'>;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
}>;

export function AppScreen({
  children,
  footer,
  keyboardAware = false,
  scroll = true,
  scrollRef,
  scrollProps,
  style,
  contentStyle,
  backgroundColor,
}: AppScreenProps) {
  const colors = getAppColors(useColorScheme());
  const insets = useSafeAreaInsets();
  const footerKeyboardInset = useRef(new Animated.Value(0)).current;
  const resolvedBackground = backgroundColor ?? colors.canvas;
  const { style: scrollStyle, ...restScrollProps } = scrollProps ?? {};

  useEffect(() => {
    if (!keyboardAware) {
      return;
    }

    const keyboardShowEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const keyboardHideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(keyboardShowEvent, (event) => {
      Animated.timing(footerKeyboardInset, {
        duration: event.duration ?? 260,
        easing: Easing.out(Easing.cubic),
        toValue: Math.max(0, event.endCoordinates.height - insets.bottom),
        useNativeDriver: false,
      }).start();
    });
    const hideSubscription = Keyboard.addListener(keyboardHideEvent, (event) => {
      Animated.timing(footerKeyboardInset, {
        duration: event.duration ?? 220,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [footerKeyboardInset, insets.bottom, keyboardAware]);

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ref={scrollRef}
      showsVerticalScrollIndicator={false}
      style={[styles.flex, scrollStyle]}
      {...restScrollProps}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.staticContent, contentStyle]}>{children}</View>
  );

  const footerElement = footer ? (
    <Animated.View style={[styles.footer, keyboardAware ? { marginBottom: footerKeyboardInset } : null]}>
      {footer}
    </Animated.View>
  ) : null;

  const body = keyboardAware ? (
    <View style={styles.flex}>
      {content}
      {footerElement}
    </View>
  ) : (
    <>
      {content}
      {footerElement}
    </>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: resolvedBackground }, style]}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  staticContent: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
});
