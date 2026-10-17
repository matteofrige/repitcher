export type Palette = {
  paper: string;
  plate: string;
  ink: string;
  inkSecondary: string;
  rule: string;
  tint: string;
  tintPressed: string;
  pencil: string;
  danger: string;
  /** In tune (tuner): verdigris ink. */
  success: string;
  /** Backdrop behind in-app dialogs and sheets (Android PromptHost). */
  scrim: string;
};

// Contrast ratios (WCAG) checked 2026-10-15: every text colour >= 4.5:1 on paper and plate.
export const light: Palette = {
  paper: '#F1E6C8',
  plate: '#E8D9B3',
  ink: '#2A2016',
  inkSecondary: '#6B5A44',
  rule: 'rgba(42,32,22,0.28)',
  tint: '#2C4A7C',
  tintPressed: '#213A63',
  pencil: '#5E5A54',
  danger: '#8C2F1F',
  success: '#3F6B3A',
  scrim: 'rgba(42,32,22,0.45)',
};

export const dark: Palette = {
  paper: '#1B1510',
  plate: '#251D16',
  ink: '#EBDDBA',
  inkSecondary: '#B5A584',
  rule: 'rgba(235,221,186,0.22)',
  tint: '#9DB4DD',
  tintPressed: '#B8CAE8',
  pencil: '#A39C90',
  danger: '#E08A73',
  success: '#9CC08F',
  scrim: 'rgba(0,0,0,0.6)',
};
