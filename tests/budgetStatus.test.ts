import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContainerSnapshot } from '../src/data/models';
import {
  budgetProgress,
  budgetSpendingStatus,
  budgetStatusPresentation,
} from '../src/components/finance/budgetStatus';
import { createTheme } from '../src/theme/tokens';

function container(
  overrides: Partial<ContainerSnapshot> = {},
): ContainerSnapshot {
  return {
    id: 'container-food',
    name: 'Food',
    description: '',
    icon: 'restaurant-outline',
    tone: 'coral',
    kind: 'budget',
    status: 'active',
    sortOrder: 1,
    createdMonthKey: '2026-10',
    systemKey: null,
    limitsByMonth: { '2026-10': 100_000 },
    labelsByMonth: {},
    balanceMinor: 0,
    limitMinor: 100_000,
    spentMinor: 0,
    remainingMinor: 100_000,
    hasActivity: false,
    ...overrides,
  };
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = hex.replace('#', '');
    const channel = (n: number) => {
      const x = n / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(parseInt(v.slice(0, 2), 16)) +
      0.7152 * channel(parseInt(v.slice(2, 4), 16)) +
      0.0722 * channel(parseInt(v.slice(4, 6), 16))
    );
  };
  const light = Math.max(lum(a), lum(b));
  const dark = Math.min(lum(a), lum(b));
  return (light + 0.05) / (dark + 0.05);
}

test('zero remaining is Limit, not Near limit', () => {
  const status = budgetSpendingStatus(
    container({ spentMinor: 100_000, remainingMinor: 0 }),
  );
  assert.equal(status, 'at-limit');
  const presentation = budgetStatusPresentation(status);
  assert.equal(presentation.label, 'Limit');
  assert.equal(presentation.progressTone, 'danger');
  assert.equal(presentation.semantic, 'danger');
});

test('positive threshold, one-cent boundaries, and overspending remain distinct', () => {
  assert.equal(
    budgetSpendingStatus(
      container({ spentMinor: 85_000, remainingMinor: 15_000 }),
    ),
    'near-limit',
  );
  assert.equal(
    budgetSpendingStatus(
      container({ spentMinor: 99_999, remainingMinor: 1 }),
    ),
    'near-limit',
  );
  assert.equal(
    budgetSpendingStatus(
      container({ spentMinor: 100_001, remainingMinor: -1 }),
    ),
    'over-budget',
  );
  assert.equal(
    budgetSpendingStatus(
      container({ limitMinor: 0, remainingMinor: 0, spentMinor: 0 }),
    ),
    'no-limit',
  );
  assert.equal(
    budgetSpendingStatus(
      container({ status: 'archived', remainingMinor: 0 }),
    ),
    'archived',
  );
  assert.equal(
    budgetSpendingStatus(
      container({ spentMinor: 84_999, remainingMinor: 15_001 }),
    ),
    'on-track',
  );
});

test('progress stays in integer-minor-unit bounds and clamps above 100%', () => {
  assert.equal(
    budgetProgress(container({ spentMinor: 100_000, remainingMinor: 0 })),
    1,
  );
  assert.equal(
    budgetProgress(container({ spentMinor: 250_000, remainingMinor: -150_000 })),
    1,
  );
  assert.equal(
    budgetProgress(container({ spentMinor: 0, remainingMinor: 100_000 })),
    0,
  );
  assert.equal(
    budgetProgress(container({ limitMinor: 0, spentMinor: 50_000 })),
    0,
  );
  assert.equal(
    budgetProgress(
      container({ limitMinor: 1_000_000_000, spentMinor: 250_000_000 }),
    ),
    0.25,
  );
});

test('Limit status uses readable danger text on its soft background in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const colors = createTheme(mode).colors;
    assert.ok(
      contrast(colors.danger, colors.dangerSoft) >= 3,
      `${mode} danger status contrast`,
    );
    assert.ok(
      contrast(colors.danger, colors.surfaceAlt) >= 3,
      `${mode} danger progress contrast`,
    );
  }
});
