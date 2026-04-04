import { Platform, TextStyle, ViewStyle } from 'react-native';

function withAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

const lightPrimary = '#2563EB';
const darkPrimary = '#60A5FA';
const lightSuccess = '#0F9F6E';
const darkSuccess = '#34D399';
const lightDanger = '#D9485F';
const darkDanger = '#FB7185';
const lightWarning = '#D97706';
const darkWarning = '#F59E0B';

export const Colors = {
  light: {
    text: '#0F172A',
    textSoft: '#475569',
    background: '#FFFFFF',
    canvas: '#F4F7FB',
    card: '#FFFFFF',
    elevated: '#FFFFFF',
    cardMuted: '#F8FAFC',
    muted: '#64748B',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    tint: lightPrimary,
    primary: lightPrimary,
    primaryStrong: '#1D4ED8',
    primaryText: '#F8FBFF',
    accent: '#14B8A6',
    success: lightSuccess,
    successText: '#F3FFF9',
    warning: lightWarning,
    warningText: '#FFF9EF',
    danger: lightDanger,
    dangerText: '#FFF6F3',
    icon: '#64748B',
    tabIconDefault: '#94A3B8',
    tabIconSelected: lightPrimary,
    overlay: withAlpha('#0F172A', '66'),
    ring: withAlpha(lightPrimary, '20'),
    successSurface: '#EAFBF3',
    dangerSurface: '#FFF1F3',
    warningSurface: '#FFF7ED',
    primarySurface: '#EAF2FF',
  },
  dark: {
    text: '#F8FAFC',
    textSoft: '#CBD5E1',
    background: '#020617',
    canvas: '#0B1220',
    card: '#111827',
    elevated: '#172033',
    cardMuted: '#0F172A',
    muted: '#94A3B8',
    border: '#243041',
    borderStrong: '#334155',
    tint: darkPrimary,
    primary: darkPrimary,
    primaryStrong: '#3B82F6',
    primaryText: '#08111F',
    accent: '#2DD4BF',
    success: darkSuccess,
    successText: '#071711',
    warning: darkWarning,
    warningText: '#241606',
    danger: darkDanger,
    dangerText: '#240A0F',
    icon: '#94A3B8',
    tabIconDefault: '#64748B',
    tabIconSelected: darkPrimary,
    overlay: withAlpha('#020617', '8C'),
    ring: withAlpha(darkPrimary, '24'),
    successSurface: '#0B221A',
    dangerSurface: '#2A1218',
    warningSurface: '#2A1A08',
    primarySurface: '#0F2145',
  },
};

export type AppColors = (typeof Colors)['light'];

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif-medium',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    serif: "Iowan Old Style, Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Segoe UI', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

export const Spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 14,
  md: 20,
  lg: 28,
  xl: 36,
  pill: 999,
} as const;

export const Type = {
  eyebrow: 12,
  label: 14,
  body: 15,
  bodyLg: 17,
  title: 22,
  titleLg: 28,
  hero: 40,
} as const;

export const Shadows: Record<'card' | 'hero', ViewStyle> = Platform.select({
  ios: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.07,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    hero: {
      shadowColor: '#000000',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
  },
  android: {
    card: {
      elevation: 3,
    },
    hero: {
      elevation: 8,
    },
  },
  default: {
    card: {},
    hero: {},
  },
}) as Record<'card' | 'hero', ViewStyle>;

export const TextPresets: Record<'eyebrow' | 'label' | 'body' | 'title' | 'hero', TextStyle> = {
  eyebrow: {
    fontFamily: Fonts.rounded,
    fontSize: Type.eyebrow,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: Type.label,
    fontWeight: '600',
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: Type.body,
    fontWeight: '500',
    lineHeight: 22,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 28,
  },
  hero: {
    fontFamily: Fonts.rounded,
    fontSize: Type.hero,
    fontWeight: '800',
    lineHeight: 42,
  },
};

export function getAppColors(colorScheme: 'light' | 'dark' | null | undefined) {
  return Colors[colorScheme ?? 'light'];
}
