import { DEFAULT_COLORS } from '../types.js';

export type TsdrawRenderTheme = 'light' | 'dark';

const DARK_COLORS: Record<string, string> = {
  black: '#f0f0f0',
  grey: '#aeb8c2',
  'light-violet': '#cf6ef5',
  violet: '#a83ce0',
  blue: '#5b7dff',
  'light-blue': '#4fb3ff',
  yellow: '#f4b13a',
  orange: '#ef7a24',
  green: '#1fb27a',
  'light-green': '#4ecb66',
  'light-red': '#ff6f78',
  red: '#f24343',
  white: '#ffffff',
};

export function resolveThemeColor(colorStyle: string, theme: TsdrawRenderTheme): string {
  const lightThemeColor = DEFAULT_COLORS[colorStyle];
  if (!lightThemeColor) return colorStyle;
  if (theme === 'light') return lightThemeColor;
  return DARK_COLORS[colorStyle] ?? lightThemeColor;
}
