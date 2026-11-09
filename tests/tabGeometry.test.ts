import assert from 'node:assert/strict';
import test from 'node:test';

import { curvedBarPath, INDICATOR_SIZE, TAB_COUNT, tabCenter } from '../src/components/navigation/tabGeometry';

test('five tab centers and their indicators fit at phone widths', () => {
  for (const screenWidth of [360, 390]) {
    const width = screenWidth - 32;
    const centers = Array.from({ length: TAB_COUNT }, (_, index) => tabCenter(width, index));
    assert.equal(centers.length, 5);
    assert.ok(centers[0]! >= INDICATOR_SIZE / 2);
    assert.ok(centers[4]! + INDICATOR_SIZE / 2 <= width);
    assert.ok(centers.every((center, index) => index === 0 || center > centers[index - 1]!));
    assert.equal(centers[2], width / 2);
  }
});

test('notch path follows every tab and includes a concave curve', () => {
  const width = 328;
  const paths = Array.from({ length: TAB_COUNT }, (_, index) => curvedBarPath(width, tabCenter(width, index)));
  assert.equal(new Set(paths).size, TAB_COUNT);
  for (const path of paths) {
    assert.match(path, / C .* C /);
    assert.match(path, / Z$/);
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
});
