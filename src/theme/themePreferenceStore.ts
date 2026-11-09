import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import type { ThemePreferenceStorage } from './themePreference';

function getWebItem(key: string): string | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage.getItem(key);
}

/**
 * Uses the SQLite key-value store on native and the browser's localStorage on
 * web. Both are local, synchronous reads at startup and require no network.
 */
export const themePreferenceStorage: ThemePreferenceStorage = {
  getItemSync:
    Platform.OS === 'web'
      ? getWebItem
      : (key) => Storage.getItemSync(key),
  setItemAsync:
    Platform.OS === 'web'
      ? async (key, value) => {
          if (typeof globalThis.localStorage !== 'undefined') {
            globalThis.localStorage.setItem(key, value);
          }
        }
      : (key, value) => Storage.setItemAsync(key, value),
};
