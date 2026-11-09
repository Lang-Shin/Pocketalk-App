import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DECORATION_ASSETS,
  SCREEN_DECORATIONS,
  type ScreenDecorationPreset,
} from '../src/components/ui/screenDecorations';

const PRESETS: ScreenDecorationPreset[] = ['home', 'budgets', 'wallet', 'history'];
const DECORATION_DIR = join(process.cwd(), 'assets', 'decorations');
const ASSET_KEYS = Object.keys(DECORATION_ASSETS);

function pngDimensions(path: string): { width: number; height: number } | null {
  const bytes = readFileSync(path);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('manifest matches every valid file in the decoration directory', () => {
  const files = readdirSync(DECORATION_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(files, Object.values(DECORATION_ASSETS).sort());
  assert.equal(files.length, 7);

  for (const filename of files) {
    const dimensions = pngDimensions(join(DECORATION_DIR, filename));
    assert.ok(dimensions, `${filename} is a valid PNG`);
    assert.ok(dimensions.width > 0 && dimensions.height > 0);
  }
});

test('every manifest asset resolves through a static import', () => {
  const layerSource = readFileSync(
    join(process.cwd(), 'src', 'components', 'ui', 'DecorationLayer.tsx'),
    'utf8',
  );
  for (const [key, filename] of Object.entries(DECORATION_ASSETS)) {
    assert.ok(
      existsSync(join(DECORATION_DIR, filename)),
      `${filename} exists`,
    );
    assert.match(
      layerSource,
      new RegExp(`${key}: require\\('\\.\\./\\.\\./\\.\\./assets/decorations/${filename.replaceAll('.', '\\.')}'\\)`),
      `${key} has a static import`,
    );
  }
});

test('all four screens include every decoration exactly once', () => {
  for (const preset of PRESETS) {
    const assets = SCREEN_DECORATIONS[preset].map((item) => item.asset).sort();
    assert.deepEqual(assets, [...ASSET_KEYS].sort(), `${preset} uses all assets`);
    assert.equal(new Set(assets).size, assets.length, `${preset} has no duplicates`);
    assert.equal(assets.length, 7);
  }
});

test('compositions vary positions, sizes, rotations, and sides', () => {
  for (const preset of PRESETS) {
    const placements = SCREEN_DECORATIONS[preset];
    assert.equal(new Set(placements.map((item) => item.top)).size, 7);
    assert.equal(new Set(placements.map((item) => item.rotation)).size, 7);
    assert.equal(new Set(placements.map((item) => item.scale)).size, 7);
    assert.ok(placements.some((item) => item.side === 'left'));
    assert.ok(placements.some((item) => item.side === 'right'));
    assert.ok(placements.some((item) => item.offset < 0));
    for (const item of placements) {
      assert.ok(item.rotation >= -15 && item.rotation <= 15);
      assert.ok(item.darkOpacity >= 0.05 && item.darkOpacity <= 0.15);
      assert.ok(item.lightOpacity >= 0.042 && item.lightOpacity <= 0.13);
      assert.ok(item.scale >= 0.23 && item.scale <= 0.38);
      assert.ok(item.maxSize >= 120 && item.maxSize <= 190);
    }
  }
});

test('History remains the quietest composition in both themes', () => {
  const total = (
    preset: ScreenDecorationPreset,
    mode: 'darkOpacity' | 'lightOpacity',
  ) =>
    SCREEN_DECORATIONS[preset].reduce(
      (sum, item) => sum + item[mode],
      0,
    );
  for (const preset of ['home', 'budgets', 'wallet'] as const) {
    assert.ok(total('history', 'darkOpacity') < total(preset, 'darkOpacity'));
    assert.ok(total('history', 'lightOpacity') < total(preset, 'lightOpacity'));
  }
});

test('Assistant remains free of decorative backgrounds', () => {
  const assistantSource = readFileSync(
    join(process.cwd(), 'src', 'features', 'assistant', 'AssistantScreen.tsx'),
    'utf8',
  );
  assert.doesNotMatch(assistantSource, /decoration=/);
});
