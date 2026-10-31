import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getContentMaxWidth,
  getContentWidth,
  getGridLayout,
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

test('target viewports keep content inside padded screen bounds', () => {
  const targets = [
    { width: 320, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];

  for (const { width, height } of targets) {
    const contentWidth = getContentWidth(width, true);
    assert.ok(contentWidth > 0, `${width}x${height} has content`);
    assert.ok(
      contentWidth <= width - layout.screenPadding * 2,
      `${width}x${height} content fits the viewport`,
    );
    assert.ok(
      contentWidth <= getContentMaxWidth(width, true),
      `${width}x${height} respects the content cap`,
    );
  }
});

test('container grids stay single-column until cards remain usable', () => {
  const expectedContent = new Map([
    [320, 280],
    [360, 320],
    [390, 350],
    [430, 390],
    [768, 720],
    [1280, 1000],
  ]);

  for (const [width, contentWidth] of expectedContent) {
    const grid = getGridLayout(width, true);
    const columns =
      contentWidth >= layout.twoColumnMinWidth ? 2 : 1;

    assert.equal(grid.contentWidth, contentWidth);
    assert.equal(grid.columns, columns);
    assert.ok(grid.cardWidth > 0, `${width}px cards have width`);
    assert.ok(
      grid.cardWidth <= grid.contentWidth,
      `${width}px cards do not exceed the grid`,
    );
  }

  assert.equal(getGridLayout(430, true).cardWidth, 390);
  assert.equal(getGridLayout(768, true).cardWidth, 354);
  assert.equal(getGridLayout(1280, true).cardWidth, 494);
});
