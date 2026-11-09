import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from './themePreference';
import { themePreferenceStorage } from './themePreferenceStore';
import { createTheme, type AppTheme } from './tokens';

export type { ThemePreference } from './themePreference';

interface ThemeContextValue {
  theme: AppTheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function PocketaThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(themePreferenceStorage),
  );

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void saveThemePreference(themePreferenceStorage, next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const mode =
      preference === 'system'
        ? systemScheme === 'dark'
          ? 'dark'
          : 'light'
        : preference;

    return {
      theme: createTheme(mode),
      preference,
      setPreference,
    };
  }, [preference, setPreference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used inside PocketaThemeProvider');
  }

  return context;
}
