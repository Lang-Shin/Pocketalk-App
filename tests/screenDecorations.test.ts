import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCREEN_DECORATIONS,
  type ScreenDecorationPreset,
} from '../src/components/ui/screenDecorations';

const PRESETS: ScreenDecorationPreset[] = ['home', 'budgets', 'wallet', 'history'];

test('all four screens include all three supplied decoration assets', () => {
  for (const preset of PRESETS) {
    const assets = SCREEN_DECORATIONS[preset].map((item) => item.asset);
    assert.deepEqual(
      [...assets].sort(),
      ['cards', 'coin', 'money'],
      `${preset} uses each asset once`,
    );
  }
});

test('compositions vary position, scale, rotation, and opacity', () => {
  for (const preset of PRESETS) {
    const placements = SCREEN_DECORATIONS[preset];
    assert.equal(new Set(placements.map((item) => item.rotation)).size, 3);
    assert.equal(new Set(placements.map((item) => item.top)).size, 3);
    assert.ok(placements.some((item) => item.side === 'left'));
    assert.ok(placements.some((item) => item.side === 'right'));
    for (const item of placements) {
      assert.ok(item.rotation >= -15 && item.rotation <= 15);
      assert.ok(item.darkOpacity > 0 && item.darkOpacity <= 0.13);
      assert.ok(item.lightOpacity > 0 && item.lightOpacity <= 0.11);
      assert.ok(item.scale > 0 && item.scale <= 0.42);
      assert.ok(item.maxSize >= 130 && item.maxSize <= 206);
    }
  }
});

test('History remains the most restrained composition', () => {
  const total = (preset: ScreenDecorationPreset) =>
    SCREEN_DECORATIONS[preset].reduce((sum, item) => sum + item.darkOpacity, 0);
  assert.ok(total('history') < total('home'));
  assert.ok(total('history') < total('budgets'));
  assert.ok(total('history') < total('wallet'));
});
