import type { TextStyle, ViewStyle } from 'react-native';

export const fontSizes = {
  display: 34,
  h1: 28,
  h2: 22,
  h3: 17,
  body: 15,
  bodySmall: 13,
  label: 13,
  caption: 12,
  micro: 11,
} as const;

export const lineHeights = {
  display: 40,
  h1: 34,
  h2: 29,
  h3: 24,
  body: 22,
  bodySmall: 19,
  label: 18,
  caption: 17,
  micro: 15,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
} as const;

export const layout = {
  screenPadding: 20,
  maxContentWidth: 760,
  maxWideContentWidth: 1040,
  wideBreakpoint: 1024,
  twoColumnMinWidth: 680,
  touchTarget: 48,
  tabBarMinHeight: 58,
} as const;

export interface GridLayout {
  contentWidth: number;
  columns: 1 | 2;
  cardWidth: number;
}

export function getContentMaxWidth(
  windowWidth: number,
  wide = false,
): number {
  return wide && windowWidth >= layout.wideBreakpoint
    ? layout.maxWideContentWidth
    : layout.maxContentWidth;
}

export function getContentWidth(windowWidth: number, wide = false): number {
  return Math.max(
    0,
    Math.min(windowWidth, getContentMaxWidth(windowWidth, wide)) -
      layout.screenPadding * 2,
  );
}

export function getGridLayout(
  windowWidth: number,
  wide = false,
): GridLayout {
  const contentWidth = getContentWidth(windowWidth, wide);
  const columns: 1 | 2 =
    contentWidth >= layout.twoColumnMinWidth ? 2 : 1;

  return {
    contentWidth,
    columns,
    cardWidth:
      columns === 2 ? (contentWidth - spacing.md) / 2 : contentWidth,
  };
}

export type Tone = 'emerald' | 'amber' | 'coral' | 'blue' | 'violet';

export interface ToneColors {
  background: string;
  foreground: string;
}

export interface AppColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primarySoft: string;
  primarySoftText: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  heroStart: string;
  heroEnd: string;
  heroText: string;
  heroMuted: string;
  tabInactive: string;
  overlay: string;
  shadow: string;
  skeleton: string;
  categories: Record<Tone, ToneColors>;
}

export interface AppTheme {
  mode: 'light' | 'dark';
  isDark: boolean;
  colors: AppColors;
  shadows: {
    card: ViewStyle;
    floating: ViewStyle;
  };
}

const lightColors: AppColors = {
  background: '#F4F7F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF3EE',
  surfaceMuted: '#F7FAF8',
  text: '#10231D',
  textSecondary: '#51655D',
  textTertiary: '#5F736A',
  border: '#D9E5DE',
  primary: '#0D705B',
  primaryPressed: '#0A5A49',
  onPrimary: '#FFFFFF',
  primarySoft: '#DFF3EB',
  primarySoftText: '#085445',
  accent: '#E39A2B',
  accentSoft: '#FFF1D8',
  accentText: '#6B4400',
  danger: '#B83A45',
  dangerSoft: '#FCE7E9',
  success: '#13784A',
  successSoft: '#DFF4E8',
  warning: '#9A5B00',
  warningSoft: '#FFF4D8',
  heroStart: '#0E7560',
  heroEnd: '#0A4A41',
  heroText: '#FFFFFF',
  heroMuted: '#D6F0E8',
  tabInactive: '#5C7067',
  overlay: 'rgba(8, 28, 22, 0.48)',
  shadow: '#0A2A22',
  skeleton: '#E5EDE8',
  categories: {
    emerald: { background: '#E2F4EB', foreground: '#0B6B50' },
    amber: { background: '#FFF1D6', foreground: '#875200' },
    coral: { background: '#FCE8E5', foreground: '#A33B34' },
    blue: { background: '#E6F0FA', foreground: '#215C91' },
    violet: { background: '#F0EAFB', foreground: '#6241A0' },
  },
};

const darkColors: AppColors = {
  background: '#07130F',
  surface: '#0F211B',
  surfaceAlt: '#142B23',
  surfaceMuted: '#0C1B16',
  text: '#F2FAF6',
  textSecondary: '#A5BDB4',
  textTertiary: '#7E978D',
  border: '#234138',
  primary: '#5AD7B6',
  primaryPressed: '#7BE7CA',
  onPrimary: '#04231B',
  primarySoft: '#123B30',
  primarySoftText: '#9CEAD4',
  accent: '#F4B95C',
  accentSoft: '#3B2B0F',
  accentText: '#FFD28F',
  danger: '#FF8E98',
  dangerSoft: '#3D1A1E',
  success: '#6ADFA5',
  successSoft: '#10372A',
  warning: '#F4C15C',
  warningSoft: '#3A2A0D',
  heroStart: '#0E6A58',
  heroEnd: '#07332C',
  heroText: '#F5FFFB',
  heroMuted: '#BFE8DB',
  tabInactive: '#8CA69B',
  overlay: 'rgba(0, 0, 0, 0.66)',
  shadow: '#000000',
  skeleton: '#1B332B',
  categories: {
    emerald: { background: '#123B30', foreground: '#9CEAD4' },
    amber: { background: '#3B2B0F', foreground: '#FFD28F' },
    coral: { background: '#3D1A1E', foreground: '#FFB0B6' },
    blue: { background: '#122C42', foreground: '#A9D4F7' },
    violet: { background: '#2B2040', foreground: '#D4C4F7' },
  },
};

export function createTheme(mode: 'light' | 'dark'): AppTheme {
  const isDark = mode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  return {
    mode,
    isDark,
    colors,
    shadows: {
      card: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: isDark ? 0.22 : 0.06,
        shadowRadius: 16,
        elevation: isDark ? 1 : 2,
      },
      floating: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: isDark ? 0.3 : 0.12,
        shadowRadius: 24,
        elevation: isDark ? 3 : 5,
      },
    },
  };
}
