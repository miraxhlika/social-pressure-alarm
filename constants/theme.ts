/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#f97316';
const tintColorDark = '#fb923c';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#ffffff',
    canvas: '#f4f4f5',
    card: '#ffffff',
    muted: '#52525b',
    border: '#e4e4e7',
    tint: tintColorLight,
    primary: tintColorLight,
    primaryText: '#ffffff',
    danger: '#dc2626',
    success: '#15803d',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#09090b',
    canvas: '#09090b',
    card: '#18181b',
    muted: '#a1a1aa',
    border: '#27272a',
    tint: tintColorDark,
    primary: tintColorDark,
    primaryText: '#09090b',
    danger: '#f87171',
    success: '#4ade80',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export function getAppColors(colorScheme: 'light' | 'dark' | null | undefined) {
  return Colors[colorScheme ?? 'light'];
}

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
