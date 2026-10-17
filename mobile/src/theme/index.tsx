import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { dark, light, type Palette } from './colors';

export type { Palette };

const ThemeContext = createContext<{ colors: Palette; scheme: 'light' | 'dark' }>({
  colors: light,
  scheme: 'light',
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <ThemeContext.Provider value={{ colors: scheme === 'dark' ? dark : light, scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
