import { Platform, TextStyle, ViewStyle } from 'react-native';

export function withAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

const lightPrimary = '#C56E43';
const darkPrimary = '#E39A6C';
const lightSuccess = '#1E8A61';
const darkSuccess = '#42C88A';
const lightDanger = '#C86060';
const darkDanger = '#FF8C8C';
const lightWarning = '#A97A2B';
const darkWarning = '#F3B75A';

export const Colors = {
  light: {
    text: '#16181B',
    textSoft: '#626A74',
    background: '#F6F4F1',
    canvas: '#F1EFEB',
    card: '#FBFAF8',
    elevated: '#FFFFFF',
    cardMuted: '#F4F1ED',
    muted: '#8B929B',
    border: '#DDD7CF',
    borderStrong: '#BCB4AA',
    tint: lightPrimary,
    primary: lightPrimary,
    primaryStrong: '#AA5A32',
    primaryText: '#FFF8F3',
    accent: '#5F6F7D',
    success: lightSuccess,
    successText: '#F7FFF9',
    warning: lightWarning,
    warningText: '#FFF8EA',
    danger: lightDanger,
    dangerText: '#FFF6F5',
    icon: '#7B838D',
    tabIconDefault: '#9CA3AD',
    tabIconSelected: lightPrimary,
    overlay: withAlpha('#16181B', '66'),
    ring: withAlpha(lightPrimary, '26'),
    successSurface: '#EAF7F0',
    dangerSurface: '#FAECEC',
    warningSurface: '#F7F1E4',
    primarySurface: '#F6EAE2',
    panel: '#FFFEFC',
    panelMuted: '#F6F2EE',
    line: withAlpha('#16181B', '10'),
    tabBar: withAlpha('#FCFBF9', 'F2'),
  },
  dark: {
    text: '#F5F7FA',
    textSoft: '#B1BAC5',
    background: '#0B0D10',
    canvas: '#101317',
    card: '#15191D',
    elevated: '#1B2025',
    cardMuted: '#13171B',
    muted: '#88919C',
    border: '#2A3138',
    borderStrong: '#49525B',
    tint: darkPrimary,
    primary: darkPrimary,
    primaryStrong: '#F0A271',
    primaryText: '#23150F',
    accent: '#7C8A97',
    success: darkSuccess,
    successText: '#071811',
    warning: darkWarning,
    warningText: '#2C1F0C',
    danger: darkDanger,
    dangerText: '#2C1010',
    icon: '#95A0AB',
    tabIconDefault: '#707B86',
    tabIconSelected: darkPrimary,
    overlay: withAlpha('#050608', '8C'),
    ring: withAlpha(darkPrimary, '2E'),
    successSurface: '#11221A',
    dangerSurface: '#291718',
    warningSurface: '#241C11',
    primarySurface: '#2A1D16',
    panel: '#171C20',
    panelMuted: '#13171B',
    line: withAlpha('#F5F7FA', '10'),
    tabBar: withAlpha('#12161A', 'F4'),
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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const Type = {
  eyebrow: 11,
  label: 14,
  body: 16,
  bodyLg: 18,
  title: 28,
  titleLg: 36,
  hero: 52,
} as const;

export const Shadows: Record<'card' | 'hero', ViewStyle> = Platform.select({
  ios: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    hero: {
      shadowColor: '#000000',
      shadowOpacity: 0.1,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
    },
  },
  android: {
    card: {
      elevation: 2,
    },
    hero: {
      elevation: 6,
    },
  },
  default: {
    card: {},
    hero: {},
  },
}) as Record<'card' | 'hero', ViewStyle>;

export const TextPresets: Record<
  'eyebrow' | 'label' | 'body' | 'bodyLg' | 'title' | 'titleLg' | 'hero',
  TextStyle
> = {
  eyebrow: {
    fontFamily: Fonts.rounded,
    fontSize: Type.eyebrow,
    fontWeight: '700',
    letterSpacing: 0.7,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: Type.label,
    fontWeight: '600',
    letterSpacing: 0.12,
    lineHeight: 20,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: Type.body,
    fontWeight: '500',
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: Fonts.sans,
    fontSize: Type.bodyLg,
    fontWeight: '500',
    lineHeight: 26,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  titleLg: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    letterSpacing: -0.9,
    lineHeight: 40,
  },
  hero: {
    fontFamily: Fonts.rounded,
    fontSize: Type.hero,
    fontWeight: '800',
    letterSpacing: -1.4,
    lineHeight: 56,
  },
};

export function getAppColors(colorScheme: 'light' | 'dark' | null | undefined) {
  return Colors[colorScheme ?? 'light'];
}

export type SurfaceTone = 'default' | 'muted' | 'primary' | 'success' | 'danger' | 'warning' | 'canvas' | 'transparent';

export function getTonePalette(tone: SurfaceTone, colors: AppColors) {
  switch (tone) {
    case 'primary':
      return {
        backgroundColor: colors.primarySurface,
        borderColor: colors.ring,
        foregroundColor: colors.primary,
      };
    case 'success':
      return {
        backgroundColor: colors.successSurface,
        borderColor: withAlpha(colors.success, '2E'),
        foregroundColor: colors.success,
      };
    case 'danger':
      return {
        backgroundColor: colors.dangerSurface,
        borderColor: withAlpha(colors.danger, '2A'),
        foregroundColor: colors.danger,
      };
    case 'warning':
      return {
        backgroundColor: colors.warningSurface,
        borderColor: withAlpha(colors.warning, '2A'),
        foregroundColor: colors.warning,
      };
    case 'muted':
      return {
        backgroundColor: colors.panelMuted,
        borderColor: colors.line,
        foregroundColor: colors.textSoft,
      };
    case 'canvas':
      return {
        backgroundColor: colors.panel,
        borderColor: colors.line,
        foregroundColor: colors.text,
      };
    case 'transparent':
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        foregroundColor: colors.text,
      };
    default:
      return {
        backgroundColor: colors.elevated,
        borderColor: colors.line,
        foregroundColor: colors.text,
      };
  }
}
