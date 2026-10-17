import { Text, type TextProps, type TextStyle } from 'react-native';

import { useColors, type Palette } from './index';

export const fonts = {
  fell: 'IMFellEnglish_400Regular',
  fellItalic: 'IMFellEnglish_400Italic',
  caslon: 'LibreCaslonText_400Regular',
  caslonItalic: 'LibreCaslonText_400Italic',
  caslonBold: 'LibreCaslonText_700Bold',
  music: 'NotoMusic_400Regular',
} as const;

export const numerals: TextStyle['fontVariant'] = ['lining-nums', 'tabular-nums'];

export type Variant =
  | 'largeTitle'
  | 'title'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subhead'
  | 'footnote'
  | 'caption'
  | 'annotation'
  | 'numeral';

const scale: Record<Variant, TextStyle> = {
  largeTitle: { fontFamily: fonts.fell, fontSize: 34, lineHeight: 41 },
  title: { fontFamily: fonts.fell, fontSize: 26, lineHeight: 32 },
  headline: { fontFamily: fonts.caslonBold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.caslon, fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: fonts.caslon, fontSize: 16, lineHeight: 22 },
  subhead: { fontFamily: fonts.caslon, fontSize: 15, lineHeight: 21 },
  footnote: { fontFamily: fonts.caslon, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.caslon, fontSize: 12, lineHeight: 16 },
  annotation: { fontFamily: fonts.caslonItalic, fontSize: 13, lineHeight: 18 },
  numeral: { fontFamily: fonts.caslon, fontSize: 17, lineHeight: 24, fontVariant: numerals },
};

const colorFor: Record<Variant, keyof Palette> = {
  largeTitle: 'ink',
  title: 'ink',
  headline: 'ink',
  body: 'ink',
  callout: 'ink',
  subhead: 'ink',
  footnote: 'inkSecondary',
  caption: 'inkSecondary',
  annotation: 'pencil',
  numeral: 'ink',
};

export type TProps = TextProps & {
  variant?: Variant;
  /** Palette key overriding the variant's default colour. */
  tone?: keyof Palette;
  /** Cap on Dynamic Type growth; defaults to 1.6. */
  maxScale?: number;
};

export function T({ variant = 'body', tone, maxScale = 1.6, style, ...rest }: TProps) {
  const colors = useColors();
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={maxScale}
      {...rest}
      style={[scale[variant], { color: colors[tone ?? colorFor[variant]] as string }, style]}
    />
  );
}
