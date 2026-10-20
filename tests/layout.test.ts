import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getContentMaxWidth,
  getContentWidth,
  layout,
} from '../src/theme/tokens';

test('content width accounts for phone and tablet padding', () => {
  assert.equal(getContentWidth(320), 280);
  assert.equal(getContentWidth(360), 320);
  assert.equal(getContentWidth(390), 350);
  assert.equal(getContentWidth(430), 390);
  assert.equal(getContentWidth(768), 720);
});

test('wide screens cap content without overflowing the viewport', () => {
  assert.equal(getContentWidth(1280), 720);
  assert.equal(getContentWidth(1280, true), 1000);
  assert.equal(getContentWidth(1024, true), 984);
  assert.equal(getContentWidth(900, true), 720);
  assert.equal(getContentMaxWidth(1280, true), layout.maxWideContentWidth);
  assert.equal(getContentMaxWidth(900, true), layout.maxContentWidth);
});

test('invalid viewport widths never produce negative content width', () => {
  assert.equal(getContentWidth(0), 0);
  assert.equal(getContentWidth(-200), 0);
});
