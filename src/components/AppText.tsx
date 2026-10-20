import type { PropsWithChildren } from 'react';
import {
  Text,
  type TextProps,
  type TextStyle,
  type ColorValue,
} from 'react-native';

import {
  fontSizes,
  fontWeights,
  lineHeights,
  useAppTheme,
} from '@/theme';

export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'caption'
  | 'micro'
  | 'amount'
  | 'amountLarge';

type TextWeight = keyof typeof fontWeights;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: ColorValue;
  align?: TextStyle['textAlign'];
  weight?: TextWeight;
}

const variantStyles: Record<TextVariant, TextStyle> = {
  display: {
    fontSize: fontSizes.display,
    lineHeight: lineHeights.display,
    fontWeight: fontWeights.heavy,
    letterSpacing: -1,
  },
  h1: {
    fontSize: fontSizes.h1,
    lineHeight: lineHeights.h1,
    fontWeight: fontWeights.bold,
    letterSpacing: -0.6,
  },
  h2: {
    fontSize: fontSizes.h2,
    lineHeight: lineHeights.h2,
    fontWeight: fontWeights.bold,
    letterSpacing: -0.4,
  },
  h3: {
    fontSize: fontSizes.h3,
    lineHeight: lineHeights.h3,
    fontWeight: fontWeights.semibold,
  },
  body: {
    fontSize: fontSizes.body,
    lineHeight: lineHeights.body,
    fontWeight: fontWeights.regular,
  },
  bodySmall: {
    fontSize: fontSizes.bodySmall,
    lineHeight: lineHeights.bodySmall,
    fontWeight: fontWeights.regular,
  },
  label: {
    fontSize: fontSizes.label,
    lineHeight: lineHeights.label,
    fontWeight: fontWeights.semibold,
  },
  caption: {
    fontSize: fontSizes.caption,
    lineHeight: lineHeights.caption,
    fontWeight: fontWeights.medium,
  },
  micro: {
    fontSize: fontSizes.micro,
    lineHeight: lineHeights.micro,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  amount: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: fontWeights.heavy,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  amountLarge: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: fontWeights.heavy,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
};

export function AppText({
  variant = 'body',
  color,
  align,
  weight,
  style,
  children,
  ...props
}: PropsWithChildren<AppTextProps>) {
  const { theme } = useAppTheme();

  return (
    <Text
      {...props}
      style={[
        variantStyles[variant],
        { color: color ?? theme.colors.text },
        align ? { textAlign: align } : null,
        weight ? { fontWeight: fontWeights[weight] } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
