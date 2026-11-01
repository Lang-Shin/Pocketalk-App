import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  interpretAssistantMessage,
  type AssistantContext,
  type AssistantResult,
} from '../src/ai/localAssistant';
import type { AssistantProvider } from '../src/ai/providers';
import {
  MockAssistantProvider,
  ValidatedAssistantProvider,
} from '../src/ai/providers';
import {
  AssistantValidationError,
  validateAssistantResult,
} from '../src/ai/validation';

function createContext(): AssistantContext {
  return {
    todayDateKey: '2026-10-20',
    activeMonthKey: '2026-10',
    wallets: [
      {
        id: 'wallet-cash',
        name: 'Cash on hand',
        kind: 'cash',
        balanceMinor: 100_000,
      },
      {
        id: 'wallet-gcash',
        name: 'Virtual GCash',
        kind: 'virtual_gcash',
        balanceMinor: 100_000,
      },
    ],
    containers: [
      {
        id: 'container-food',
        name: 'Food & drinks',
        status: 'active',
        systemKey: null,
        balanceMinor: 20_000,
        limitMinor: 100_000,
        spentMinor: 80_000,
        remainingMinor: 20_000,
      },
      {
        id: 'container-transport',
        name: 'Transport',
        status: 'active',
        systemKey: null,
        balanceMinor: 10_000,
        limitMinor: 50_000,
        spentMinor: 40_000,
        remainingMinor: 10_000,
      },
      {
        id: 'container-old',
        name: 'Old food',
        status: 'archived',
        systemKey: null,
        balanceMinor: 5_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
    ],
    summary: {
      monthKey: '2026-10',
      incomeMinor: 200_000,
      expenseMinor: 120_000,
      netSavingsMinor: 80_000,
      totalLimitMinor: 150_000,
      totalSpentMinor: 120_000,
      totalRemainingMinor: 30_000,
      savingsContributionsMinor: 0,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 0,
      unallocatedEndingBalanceMinor: 50_000,
    },
  };
}

function proposalResult(): AssistantResult {
  return interpretAssistantMessage(
    'Spent ₱50 on lunch from Food & drinks',
    createContext(),
  );
}

function providerReturning(result: unknown): AssistantProvider {
  return {
    info: {
      id: 'test-provider',
      displayName: 'Test provider',
      kind: 'mock',
      isRealModel: false,
      needsModelDownload: false,
      offline: true,
      description: 'Test-only provider.',
    },
    async load() {},
    async unload() {},
    async interpret() {
      return result as AssistantResult;
    },
    async resolveContainerChoice() {
      return result as AssistantResult;
    },
    async resolveWalletChoice() {
      return result as AssistantResult;
    },
  };
}

test('valid deterministic output passes schema validation', () => {
  const context = createContext();
  const result = proposalResult();

  assert.doesNotThrow(() => validateAssistantResult(result, context));
});

test('validation rejects tampered amounts and dates', () => {
  const context = createContext();
  const result = proposalResult();
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const badAmount = structuredClone(result);
  badAmount.proposal.amountMinor = 0;
  assert.throws(
    () => validateAssistantResult(badAmount, context),
    AssistantValidationError,
  );

  const future = structuredClone(result);
  future.proposal.effectiveDate = '2026-10-21';
  future.proposal.monthKey = '2026-10';
  future.interpretation.effectiveDate = '2026-10-21';
  assert.throws(
    () => validateAssistantResult(future, context),
    AssistantValidationError,
  );
});

test('validation rejects unknown, archived, or mismatched entities', () => {
  const context = createContext();
  const result = proposalResult();
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const unknown = structuredClone(result);
  unknown.proposal.containerId = 'missing-container';
  assert.throws(
    () => validateAssistantResult(unknown, context),
    AssistantValidationError,
  );

  const archived = structuredClone(result);
  archived.proposal.containerId = 'container-old';
  assert.throws(
    () => validateAssistantResult(archived, context),
    AssistantValidationError,
  );

  const mismatched = structuredClone(result);
  if (mismatched.interpretation.sourceWallet) {
    mismatched.interpretation.sourceWallet.name = 'Fake wallet';
  }
  assert.throws(
    () => validateAssistantResult(mismatched, context),
    AssistantValidationError,
  );
});

test('validation rejects overdraw and stale balance claims', () => {
  const context = createContext();
  const result = proposalResult();
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const overdraw = structuredClone(result);
  overdraw.proposal.amountMinor = 30_000;
  overdraw.interpretation.amountMinor = 30_000;
  assert.throws(
    () => validateAssistantResult(overdraw, context),
    AssistantValidationError,
  );

  const stale = structuredClone(result);
  stale.proposal.sourceBalanceMinor = 99_999;
  assert.throws(
    () => validateAssistantResult(stale, context),
    AssistantValidationError,
  );
});

test('the validated provider blocks invalid provider output', async () => {
  const context = createContext();
  const result = proposalResult();
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  result.proposal.amountMinor = 1;

  const provider = new ValidatedAssistantProvider(
    providerReturning(result),
  );

  await assert.rejects(
    () => provider.interpret('test', context),
    AssistantValidationError,
  );
});

test('the production factory accepts valid mock output', async () => {
  const provider = new ValidatedAssistantProvider(
    new MockAssistantProvider(),
  );
  const result = await provider.interpret(
    'Spent ₱50 on lunch from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.amountMinor, 5_000);
});

test('validation rejects malformed and unsupported output', () => {
  const context = createContext();

  assert.throws(
    () => validateAssistantResult(null, context),
    AssistantValidationError,
  );
  assert.throws(
    () => validateAssistantResult({ kind: 'proposal' }, context),
    AssistantValidationError,
  );
  assert.throws(
    () =>
      validateAssistantResult(
        { ...proposalResult(), intent: 'not_a_real_intent' },
        context,
      ),
    AssistantValidationError,
  );
});

test('provider runtime errors are propagated instead of displayed as output', async () => {
  const error = new Error('model unavailable');
  const provider = new ValidatedAssistantProvider({
    info: {
      id: 'unavailable-provider',
      displayName: 'Unavailable provider',
      kind: 'local_llm',
      isRealModel: true,
      needsModelDownload: true,
      offline: true,
      description: 'Test-only unavailable provider.',
    },
    async load() {
      throw error;
    },
    async unload() {},
    async interpret() {
      throw error;
    },
    async resolveContainerChoice() {
      throw error;
    },
    async resolveWalletChoice() {
      throw error;
    },
  });

  await assert.rejects(
    () => provider.interpret('test', createContext()),
    error,
  );
});

test('AI source has no financial repository or write path', () => {
  const aiDirectory = fileURLToPath(new URL('../src/ai', import.meta.url));
  const source = readSourceFiles(aiDirectory).join('\n');

  for (const forbidden of [
    /\bFinanceService\b/,
    /\bFinanceEngine\b/,
    /\bFinanceRepository\b/,
    /financeService/,
    /financeRepository/,
    /financeEngine/,
    /expo-sqlite/,
    /recordMoneyEntry/,
    /runRollover/,
    /sqlite/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }

  const screen = readFileSync(
    fileURLToPath(
      new URL(
        '../src/features/assistant/AssistantScreen.tsx',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  assert.doesNotMatch(
    screen,
    /recordMoneyEntry|FinanceService|ConfirmationDialog|transferBetweenContainers/,
  );
});

function readSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readSourceFiles(path);
    return entry.isFile() && path.endsWith('.ts')
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}
