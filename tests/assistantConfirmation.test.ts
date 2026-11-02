import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantProposal } from '../src/ai/localAssistant';
import {
  claimExecution,
  createPendingConfirmation,
  executionFromError,
  executionFromResult,
  releaseExecution,
} from '../src/features/assistant/confirmationState';

function proposal(): AssistantProposal {
  return {
    id: 'assistant-review-1',
    action: 'expense',
    title: 'Lunch',
    amountMinor: 2_500,
    effectiveDate: '2026-10-20',
    monthKey: '2026-10',
    walletId: 'wallet-cash',
    containerId: 'container-food',
  };
}

test('Review & Confirm creates the pending confirmation state', () => {
  const pending = createPendingConfirmation({
    id: 'message-1',
    proposal: proposal(),
  });

  assert.deepEqual(pending, {
    messageId: 'message-1',
    proposal: proposal(),
  });
});

test('completed or saving receipts do not reopen confirmation', () => {
  assert.equal(
    createPendingConfirmation({
      id: 'message-1',
      proposal: proposal(),
      execution: { status: 'success', transactionId: 'tx-1' },
    }),
    null,
  );
  assert.equal(
    createPendingConfirmation({
      id: 'message-2',
      proposal: proposal(),
      execution: { status: 'executing' },
    }),
    null,
  );
});

test('an execution claim blocks repeated confirmation until released', () => {
  const active = new Set<string>();

  assert.equal(claimExecution(active, 'assistant-review-1'), true);
  assert.equal(claimExecution(active, 'assistant-review-1'), false);

  releaseExecution(active, 'assistant-review-1');
  assert.equal(claimExecution(active, 'assistant-review-1'), true);
});

test('a successful result produces success with the transaction ID', () => {
  assert.deepEqual(
    executionFromResult({ ok: true, transactionId: 'tx-1' }),
    { status: 'success', transactionId: 'tx-1' },
  );
});

test('a rejected result produces failure without a success receipt', () => {
  const execution = executionFromResult({
    ok: false,
    message: 'That container does not have enough money on the selected date.',
  });

  assert.deepEqual(execution, {
    status: 'error',
    message: 'That container does not have enough money on the selected date.',
  });
  assert.notEqual(execution.status, 'success');
});

test('an unexpected execution error produces failure', () => {
  assert.deepEqual(executionFromError(new Error('The wallet no longer exists.')), {
    status: 'error',
    message: 'The wallet no longer exists.',
  });
  assert.deepEqual(
    executionFromError(undefined),
    {
      status: 'error',
      message: 'The transaction could not be saved. Nothing was changed.',
    },
  );
});
