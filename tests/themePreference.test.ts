import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_KEY,
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
  type ThemePreferenceStorage,
} from '../src/theme/themePreference';

class FakeStorage implements ThemePreferenceStorage {
  readonly values = new Map<string, string>();
  writes = 0;
  failRead = false;
  failWrite = false;

  getItemSync(key: string): string | null {
    if (this.failRead) throw new Error('read failed');
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failWrite) throw new Error('write failed');
    this.writes += 1;
    this.values.set(key, value);
  }
}

test('theme defaults to dark without writing during startup', () => {
  const storage = new FakeStorage();
  assert.equal(DEFAULT_THEME_PREFERENCE, 'dark');
  assert.equal(readThemePreference(storage), 'dark');
  assert.equal(storage.writes, 0);
  assert.equal(storage.values.size, 0);
});

test('light and dark selections persist and restore', async () => {
  const storage = new FakeStorage();

  assert.equal(await saveThemePreference(storage, 'light'), true);
  assert.equal(storage.values.get(THEME_PREFERENCE_KEY), 'light');
  assert.equal(readThemePreference(storage), 'light');

  assert.equal(await saveThemePreference(storage, 'dark'), true);
  assert.equal(readThemePreference(storage), 'dark');
});

test('system preference persists as an explicit supported choice', async () => {
  const storage = new FakeStorage();
  await saveThemePreference(storage, 'system');
  assert.equal(readThemePreference(storage), 'system');
});

test('existing stored preferences survive restart without being overwritten', () => {
  const storage = new FakeStorage();
  storage.values.set(THEME_PREFERENCE_KEY, 'light');

  assert.equal(readThemePreference(storage), 'light');
  assert.equal(readThemePreference(storage), 'light');
  assert.equal(storage.writes, 0);
  assert.equal(storage.values.get(THEME_PREFERENCE_KEY), 'light');
});

test('invalid stored values fall back to the default without writing', () => {
  const storage = new FakeStorage();
  storage.values.set(THEME_PREFERENCE_KEY, 'green');
  assert.equal(readThemePreference(storage), 'dark');
  assert.equal(storage.writes, 0);
});

test('storage read failures fall back safely', () => {
  const storage = new FakeStorage();
  storage.failRead = true;
  assert.equal(readThemePreference(storage), 'dark');
});

test('storage write failures do not throw and report failure', async () => {
  const storage = new FakeStorage();
  storage.failWrite = true;
  assert.equal(await saveThemePreference(storage, 'light'), false);
});

test('every supported preference round-trips through storage', async () => {
  const storage = new FakeStorage();
  for (const preference of [
    'system',
    'light',
    'dark',
  ] satisfies ThemePreference[]) {
    await saveThemePreference(storage, preference);
    assert.equal(readThemePreference(storage), preference);
  }
});
