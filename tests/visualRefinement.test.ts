import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTheme, getFontFamilies } from '../src/theme/tokens';

function rgba(value: string): [number, number, number, number] {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      1,
    ];
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  assert.ok(match, `Unsupported color ${value}`);
  const parts = (match?.[1] ?? '').split(',').map((part) => Number(part.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

function composite(foreground: string, background: string): string {
  const [fr, fg, fb, alpha] = rgba(foreground);
  const [br, bg, bb] = rgba(background);
  const mix = (front: number, back: number) => Math.round(front * alpha + back * (1 - alpha));
  return `rgb(${mix(fr, br)}, ${mix(fg, bg)}, ${mix(fb, bb)})`;
}

function luminance(value: string): number {
  const [r, g, b] = rgba(value);
  const channel = (component: number) => {
    const normalized = component / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('typography resolves to native San Francisco on iOS and Inter elsewhere', () => {
  const ios = getFontFamilies('ios');
  assert.deepEqual(Object.values(ios), ['System', 'System', 'System', 'System', 'System']);

  const android = getFontFamilies('android');
  assert.equal(android.regular, 'Inter_400Regular');
  assert.equal(android.medium, 'Inter_500Medium');
  assert.equal(android.semibold, 'Inter_600SemiBold');
  assert.equal(android.bold, 'Inter_700Bold');
  assert.equal(android.heavy, 'Inter_800ExtraBold');

  assert.deepEqual(getFontFamilies('web'), android);
});

test('font dependencies use legally distributable Inter and remove Nunito', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.ok(packageJson.dependencies['@expo-google-fonts/inter']);
  assert.equal(packageJson.dependencies['@expo-google-fonts/nunito-sans'], undefined);

  const layout = readFileSync('src/app/_layout.tsx', 'utf8');
  assert.match(layout, /Inter_400Regular/);
  assert.match(layout, /Platform\.OS === 'ios'/);
  assert.doesNotMatch(layout, /Nunito/);
});

test('glass surfaces preserve readable contrast in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const theme = createTheme(mode);
    const cardSurface = composite(theme.glass.surface, theme.colors.background);
    const navSurface = composite(theme.glass.navSurface, theme.colors.background);
    const heroSurface = composite(theme.glass.heroSurface, theme.colors.background);
    const sheetSurface = composite(theme.glass.sheet, theme.colors.background);
    const inputSurface = composite(theme.glass.input, theme.colors.background);

    assert.ok(
      contrast(theme.colors.text, cardSurface) >= 4.5,
      `${mode} glass card text contrast`,
    );
    assert.ok(
      contrast(theme.colors.textSecondary, cardSurface) >= 4.5,
      `${mode} glass card secondary text contrast`,
    );
    assert.ok(
      contrast(theme.colors.tabInactive, navSurface) >= 4.5,
      `${mode} navigation inactive text contrast`,
    );
    assert.ok(
      contrast(theme.colors.heroText, heroSurface) >= 4.5,
      `${mode} hero balance text contrast`,
    );
    assert.ok(
      contrast(theme.colors.heroMuted, heroSurface) >= 4.5,
      `${mode} hero supporting text contrast`,
    );
    assert.ok(
      contrast(theme.colors.text, sheetSurface) >= 4.5,
      `${mode} modal text contrast`,
    );
    assert.ok(
      contrast(theme.colors.text, inputSurface) >= 4.5,
      `${mode} input text contrast`,
    );
  }
});

test('modal blur is iOS-only with an opaque Android fallback', () => {
  const source = readFileSync('src/components/ui/ModalBackdrop.tsx', 'utf8');
  assert.match(source, /BlurView/);
  assert.match(source, /Platform\.OS === 'ios'/);
  assert.match(source, /theme\.colors\.overlay/);
  assert.match(source, /theme\.glass\.modalOverlay/);
});
