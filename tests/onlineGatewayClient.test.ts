import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantContext } from '../src/ai/localAssistant';
import {
  ONLINE_CONTRACT_VERSION,
  createOnlineRequest,
} from '../src/ai/online/contract';
import {
  OnlineGatewayClient,
  OnlineGatewayError,
  type OnlineGatewayTransport,
  type OnlineGatewayTransportRequest,
  type OnlineGatewayTransportResponse,
} from '../src/ai/online/gatewayClient';

function createContext(): AssistantContext {
  return {
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [
      {
        id: 'wallet-cash',
        name: 'Cash on hand',
        kind: 'cash',
        balanceMinor: 200_000,
      },
      {
        id: 'wallet-gcash',
        name: 'Virtual GCash',
        kind: 'virtual_gcash',
        balanceMinor: 200_000,
      },
    ],
    containers: [
      {
        id: 'container-food',
        name: 'Food & drinks',
        status: 'active',
        systemKey: null,
        balanceMinor: 100_000,
        limitMinor: 100_000,
        spentMinor: 0,
        remainingMinor: 100_000,
      },
      {
        id: 'container-transport',
        name: 'Transport',
        status: 'active',
        systemKey: null,
        balanceMinor: 50_000,
        limitMinor: 50_000,
        spentMinor: 0,
        remainingMinor: 50_000,
      },
      {
        id: 'system-savings',
        name: 'Savings',
        status: 'active',
        systemKey: 'savings',
        balanceMinor: 100_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
      {
        id: 'system-unallocated',
        name: 'Unallocated',
        status: 'active',
        systemKey: 'unallocated',
        balanceMinor: 50_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
    ],
    summary: {
      monthKey: '2026-11',
      incomeMinor: 200_000,
      expenseMinor: 120_000,
      netSavingsMinor: 80_000,
      totalLimitMinor: 150_000,
      totalSpentMinor: 120_000,
      totalRemainingMinor: 30_000,
      savingsContributionsMinor: 0,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 100_000,
      unallocatedEndingBalanceMinor: 50_000,
    },
  };
}

function validResponse(): OnlineGatewayTransportResponse {
  return {
    status: 200,
    body: JSON.stringify({
      version: ONLINE_CONTRACT_VERSION,
      kind: 'proposal',
      intent: 'expense',
      action: 'expense',
      amountText: '50',
      refs: { wallet: 'w2', container: 'c1' },
    }),
  };
}

class FakeTransport implements OnlineGatewayTransport {
  readonly calls: OnlineGatewayTransportRequest[] = [];

  constructor(
    private readonly handler: (
      request: OnlineGatewayTransportRequest,
    ) => Promise<OnlineGatewayTransportResponse>,
  ) {}

  send(
    request: OnlineGatewayTransportRequest,
  ): Promise<OnlineGatewayTransportResponse> {
    this.calls.push(request);
    return this.handler(request);
  }
}

test('gateway client serializes only the validated request and parses a valid response', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const transport = new FakeTransport(async () => validResponse());
  const client = new OnlineGatewayClient({ transport });

  const result = await client.interpret(envelope.request);

  assert.equal(result.kind, 'proposal');
  assert.equal(transport.calls.length, 1);
  const body = transport.calls[0]?.body;
  assert.equal(typeof body, 'string');
  assert.deepEqual(JSON.parse(body ?? ''), envelope.request);
  assert.doesNotMatch(
    body ?? '',
    /wallet-cash|container-food|walletIdsByAlias|containerIdsByAlias/,
  );
});

test('gateway client maps HTTP failures to typed errors without retries', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const cases = [
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'quota_exhausted'],
    [500, 'service_unavailable'],
    [503, 'service_unavailable'],
  ] as const;

  for (const [status, code] of cases) {
    const transport = new FakeTransport(async () => ({
      status,
      body: '{}',
    }));
    const client = new OnlineGatewayClient({ transport });

    await assert.rejects(
      () => client.interpret(envelope.request),
      (error: unknown) => {
        assert.equal(error instanceof OnlineGatewayError, true);
        if (error instanceof OnlineGatewayError) {
          assert.equal(error.code, code);
        }
        return true;
      },
    );
    assert.equal(transport.calls.length, 1);
  }
});

test('gateway client maps network failures to network_unavailable', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const transport = new FakeTransport(async () => {
    throw new Error('offline');
  });
  const client = new OnlineGatewayClient({ transport });

  await assert.rejects(
    () => client.interpret(envelope.request),
    (error: unknown) =>
      error instanceof OnlineGatewayError &&
      error.code === 'network_unavailable',
  );
});

test('gateway client times out and rejects cancelled requests', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const timedOutTransport = new FakeTransport(
    async (request) =>
      new Promise<OnlineGatewayTransportResponse>((_, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }),
  );
  const timedOutClient = new OnlineGatewayClient({
    transport: timedOutTransport,
    timeoutMs: 5,
  });

  await assert.rejects(
    () => timedOutClient.interpret(envelope.request),
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'timeout',
  );

  const abortTransport = new FakeTransport(
    async (request) =>
      new Promise<OnlineGatewayTransportResponse>((_, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }),
  );
  const abortClient = new OnlineGatewayClient({ transport: abortTransport });
  const controller = new AbortController();
  const pending = abortClient.interpret(envelope.request, {
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(
    () => pending,
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'cancelled',
  );
});

test('gateway client rejects malformed, oversized, and unsupported responses', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );

  const bodies = [
    '{"kind":"proposal"',
    '```json\n{"kind":"proposal"}\n```',
    'x'.repeat(9_000),
    JSON.stringify({
      ...JSON.parse(validResponse().body),
      confirmed: true,
    }),
    JSON.stringify({
      ...JSON.parse(validResponse().body),
      action: 'unsupported',
    }),
  ];

  for (const body of bodies) {
    const transport = new FakeTransport(async () => ({ status: 200, body }));
    const client = new OnlineGatewayClient({ transport });

    await assert.rejects(
      () => client.interpret(envelope.request),
      (error: unknown) =>
        error instanceof OnlineGatewayError &&
        error.code === 'invalid_response',
    );
  }
});

test('gateway client accepts an injected signal that is already aborted', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const transport = new FakeTransport(async () => validResponse());
  const client = new OnlineGatewayClient({ transport });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => client.interpret(envelope.request, { signal: controller.signal }),
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'cancelled',
  );
  assert.equal(transport.calls.length, 0);
});

test('gateway client maps gateway policy failures to compatible typed errors', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const invalidCases = [400, 413, 415, 502];
  for (const status of invalidCases) {
    const client = new OnlineGatewayClient({
      transport: new FakeTransport(async () => ({ status, body: '{}' })),
    });
    await assert.rejects(
      () => client.interpret(envelope.request),
      (error: unknown) =>
        error instanceof OnlineGatewayError &&
        error.code === 'invalid_response',
    );
  }

  const timeoutClient = new OnlineGatewayClient({
    transport: new FakeTransport(async () => ({ status: 504, body: '{}' })),
  });
  await assert.rejects(
    () => timeoutClient.interpret(envelope.request),
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'timeout',
  );
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('gateway client times out even when transport ignores AbortSignal', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const transport = new FakeTransport(
    async () => new Promise<OnlineGatewayTransportResponse>(() => undefined),
  );
  const client = new OnlineGatewayClient({ transport, timeoutMs: 5 });

  await assert.rejects(
    () => client.interpret(envelope.request),
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'timeout',
  );
});

test('gateway client ignores late transport success after timeout', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const late = deferred<OnlineGatewayTransportResponse>();
  const transport = new FakeTransport(async () => late.promise);
  const client = new OnlineGatewayClient({ transport, timeoutMs: 5 });
  const pending = client.interpret(envelope.request);

  await assert.rejects(
    () => pending,
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'timeout',
  );
  late.resolve(validResponse());
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('gateway client safely absorbs late transport rejection after timeout', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const late = deferred<OnlineGatewayTransportResponse>();
  const transport = new FakeTransport(async () => late.promise);
  const client = new OnlineGatewayClient({ transport, timeoutMs: 5 });
  const pending = client.interpret(envelope.request);

  await assert.rejects(
    () => pending,
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'timeout',
  );
  late.reject(new Error('late transport failure'));
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('gateway client caller cancellation remains distinct from timeout', async () => {
  const envelope = createOnlineRequest(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );
  const transport = new FakeTransport(
    async () => new Promise<OnlineGatewayTransportResponse>(() => undefined),
  );
  const client = new OnlineGatewayClient({ transport, timeoutMs: 100 });
  const controller = new AbortController();
  const pending = client.interpret(envelope.request, {
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(
    () => pending,
    (error: unknown) =>
      error instanceof OnlineGatewayError && error.code === 'cancelled',
  );
});
