import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTANT_KEYBOARD_BEHAVIOR,
  assistantInputPalette,
  isAssistantSendEnabled,
} from '../src/features/assistant/composerConfig';
import { createTheme } from '../src/theme/tokens';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  return (
    0.2126 * channel(parseInt(value.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(value.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(value.slice(4, 6), 16))
  );
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('Assistant uses one Android-safe keyboard padding behavior', () => {
  assert.equal(ASSISTANT_KEYBOARD_BEHAVIOR, 'padding');
});

test('send is available only for trimmed input while idle', () => {
  assert.equal(isAssistantSendEnabled('', false), false);
  assert.equal(isAssistantSendEnabled('   ', false), false);
  assert.equal(isAssistantSendEnabled('hello', false), true);
  assert.equal(isAssistantSendEnabled('  hello  ', false), true);
  assert.equal(isAssistantSendEnabled('hello', true), false);
});

test('composer input colors remain readable in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const palette = assistantInputPalette(createTheme(mode).colors);
    const surface = createTheme(mode).colors.surface;

    assert.ok(
      contrast(palette.text, surface) >= 4.5,
      `${mode} typed text contrast`,
    );
    assert.ok(
      contrast(palette.placeholder, surface) >= 3,
      `${mode} placeholder contrast`,
    );
    assert.ok(
      contrast(palette.cursor, surface) >= 3,
      `${mode} cursor contrast`,
    );
    assert.notEqual(palette.text, palette.placeholder);
  }
});

test('typed text uses the primary text token, not the placeholder token', () => {
  const theme = createTheme('dark');
  const palette = assistantInputPalette(theme.colors);
  assert.equal(palette.text, theme.colors.text);
  assert.equal(palette.placeholder, theme.colors.textTertiary);
  assert.equal(palette.selection, theme.colors.primary);
});
