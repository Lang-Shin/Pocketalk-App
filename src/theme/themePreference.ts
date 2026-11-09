export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'pocketa.theme.preference';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

export interface ThemePreferenceStorage {
  getItemSync(key: string): string | null;
  setItemAsync(key: string, value: string): Promise<void>;
}

export function parseThemePreference(
  value: string | null | undefined,
): ThemePreference | null {
  if (value === 'system' || value === 'light' || value === 'dark') {
    return value;
  }
  return null;
}

/**
 * Reads without writing, so startup can never overwrite a stored preference.
 * A missing, invalid, or unreadable value falls back to the existing default.
 */
export function readThemePreference(
  storage: ThemePreferenceStorage,
): ThemePreference {
  try {
    return (
      parseThemePreference(storage.getItemSync(THEME_PREFERENCE_KEY)) ??
      DEFAULT_THEME_PREFERENCE
    );
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Persists an explicit user choice. The caller still applies the theme when
 * storage fails; returning false only describes persistence.
 */
export async function saveThemePreference(
  storage: ThemePreferenceStorage,
  preference: ThemePreference,
): Promise<boolean> {
  try {
    await storage.setItemAsync(THEME_PREFERENCE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}
