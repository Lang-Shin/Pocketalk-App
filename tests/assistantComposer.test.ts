import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  assistantKeyboardConfig,
  assistantInputPalette,
  isAssistantSendEnabled,
} from '../src/features/assistant/composerConfig';
import { createTheme } from '../src/theme/tokens';
import { ResponsePresentation } from '../src/features/assistant/responsePresentation';
import { FakePresentationClock } from './helpers/fakePresentationClock';

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

test('Android resize does not receive additional JS keyboard padding', () => {
  assert.deepEqual(assistantKeyboardConfig('android'), { enabled: false, behavior: undefined });
  assert.deepEqual(assistantKeyboardConfig('ios'), { enabled: true, behavior: 'padding' });
  assert.deepEqual(assistantKeyboardConfig('web'), { enabled: false, behavior: undefined });
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
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

test('fast response shows user message and thinking immediately, then reveals unchanged content at 500 ms', async () => {
  const clock = new FakePresentationClock();
  const presenter = new ResponsePresentation(clock);
  const events: string[] = [];
  const run = presenter.run(async () => { clock.advance(50); return 'original response'; }, {
    start: () => { events.push('user message', 'thinking'); },
    success: (value) => events.push(value),
    error: () => events.push('error'),
    finish: () => events.push('finished'),
  });
  assert.deepEqual(events, ['user message', 'thinking']);
  await Promise.resolve();
  clock.advance(449);
  await Promise.resolve();
  assert.deepEqual(events, ['user message', 'thinking']);
  clock.advance(1);
  await run;
  assert.deepEqual(events, ['user message', 'thinking', 'original response', 'finished']);
});

test('slow successful responses are not delayed further; failures finish promptly', async () => {
  const clock = new FakePresentationClock();
  const presenter = new ResponsePresentation(clock);
  const events: string[] = [];
  await presenter.run(async () => { clock.advance(800); return 'done'; }, {
    start: () => events.push('thinking'), success: (value) => events.push(value),
    error: () => events.push('error'), finish: () => events.push('finished'),
  });
  assert.deepEqual(events, ['thinking', 'done', 'finished']);
  assert.equal(clock.pending, 0);
  events.length = 0;
  await presenter.run(async () => { throw new Error('failed'); }, {
    start: () => events.push('thinking'), success: () => events.push('success'),
    error: () => events.push('error'), finish: () => events.push('finished'),
  });
  assert.deepEqual(events, ['thinking', 'error', 'finished']);
  assert.equal(clock.pending, 0);
});

test('duplicate submissions are locked and unmount clears pending timers and callbacks', async () => {
  const clock = new FakePresentationClock();
  const presenter = new ResponsePresentation(clock);
  const events: string[] = [];
  const callbacks = { start: () => events.push('start'), success: () => events.push('success'), error: () => events.push('error'), finish: () => events.push('finish') };
  const first = presenter.run(async () => 'response', callbacks);
  assert.equal(await presenter.run(async () => 'duplicate', callbacks), false);
  await Promise.resolve();
  assert.equal(clock.pending, 1);
  presenter.dispose();
  assert.equal(clock.pending, 0);
  clock.advance(500);
  await first;
  assert.deepEqual(events, ['start']);
});
