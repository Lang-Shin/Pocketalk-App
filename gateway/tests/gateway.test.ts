import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ONLINE_CONTRACT_VERSION,
  type OnlineRequest,
  type OnlineResponse,
} from '../../src/ai/online/contract';
import {
  OnlineGatewayClient,
  OnlineGatewayError,
  type OnlineGatewayTransport,
  type OnlineGatewayTransportResponse,
} from '../../src/ai/online/gatewayClient';
import {
  FakeAuthenticator,
  type AuthenticatedIdentity,
} from '../src/auth';
import { disabledGateway } from '../src/index';
import type { GatewayDependencies } from '../src/handler';
import { FakeSemanticProvider } from '../src/provider';
import { ProviderTimeoutError } from '../src/errors';
import { InMemoryRateLimiter } from '../src/rateLimit';
import { handleGatewayRequest } from '../src/handler';

const VALID_REQUEST: OnlineRequest = {
  version: ONLINE_CONTRACT_VERSION,
  message: 'Spent 50 on lunch from Food & drinks',
  todayDateKey: '2026-11-07',
  activeMonthKey: '2026-11',
  wallets: [
    { ref: 'w1', label: 'Cash on hand', kind: 'cash' },
    { ref: 'w2', label: 'Virtual GCash', kind: 'virtual_gcash' },
  ],
  containers: [
    { ref: 'c1', label: 'Food & drinks', kind: 'ordinary' },
    { ref: 'c2', label: 'Transport', kind: 'ordinary' },
    { ref: 'c3', label: 'Savings', kind: 'savings' },
    { ref: 'c4', label: 'Unallocated', kind: 'unallocated' },
  ],
};

const VALID_RESPONSE: OnlineResponse = {
  version: ONLINE_CONTRACT_VERSION,
  kind: 'proposal',
  intent: 'expense',
  action: 'expense',
  amountText: '50',
  refs: { wallet: 'w2', container: 'c1' },
};

function createAuthenticator(): FakeAuthenticator {
  return new FakeAuthenticator(
    new Map<string, AuthenticatedIdentity | 'expired'>([
      ['valid', { subject: 'user-a' }],
      ['valid-b', { subject: 'user-b' }],
      ['expired', 'expired'],
      ['expired-identity', { subject: 'user-expired', expiresAt: 0 }],
    ]),
  );
}

function dependencies(
  overrides: Partial<GatewayDependencies> = {},
): GatewayDependencies {
  return {
    enabled: true,
    authenticator: createAuthenticator(),
    rateLimiter: new InMemoryRateLimiter({
      perIdentityLimit: 10,
      globalLimit: 20,
    }),
    provider: new FakeSemanticProvider(async () => VALID_RESPONSE),
    ...overrides,
  };
}

function request(
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
): Request {
  return new Request('https://gateway.test/v1/assistant/interpret', {
    method,
    headers: {
      authorization: 'Bearer valid',
      'content-type': 'application/json',
      ...headers,
    },
    body:
      method === 'GET'
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

test('valid synthetic request reaches the fake provider and returns validated output', async () => {
  let calls = 0;
  const deps = dependencies({
    provider: new FakeSemanticProvider(async () => {
      calls += 1;
      return VALID_RESPONSE;
    }),
  });

  const response = await handleGatewayRequest(
    request(VALID_REQUEST),
    deps,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await jsonBody(response), VALID_RESPONSE);
  assert.equal(calls, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('authentication is mandatory and verifier outages fail closed', async () => {
  const missing = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: '' }),
    dependencies(),
  );
  assert.equal(missing.status, 401);

  const invalid = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer invalid' }),
    dependencies(),
  );
  assert.equal(invalid.status, 401);

  const expired = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer expired' }),
    dependencies(),
  );
  assert.equal(expired.status, 401);

  const expiredIdentity = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer expired-identity' }),
    dependencies(),
  );
  assert.equal(expiredIdentity.status, 401);

  let providerCalls = 0;
  const outage = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      authenticator: {
        async authenticate() {
          throw new Error('verifier down');
        },
      },
      provider: new FakeSemanticProvider(async () => {
        providerCalls += 1;
        return VALID_RESPONSE;
      }),
    }),
  );
  assert.equal(outage.status, 503);
  assert.equal(providerCalls, 0);
});

test('per-identity and global quota exhaustion return 429 without provider calls', async () => {
  let providerCalls = 0;
  const provider = new FakeSemanticProvider(async () => {
    providerCalls += 1;
    return VALID_RESPONSE;
  });

  const perIdentityDeps = dependencies({
    provider,
    rateLimiter: new InMemoryRateLimiter({
      perIdentityLimit: 1,
      globalLimit: 10,
    }),
  });
  const first = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer valid' }),
    perIdentityDeps,
  );
  assert.equal(first.status, 200);
  const second = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer valid' }),
    perIdentityDeps,
  );
  assert.equal(second.status, 429);
  assert.equal(providerCalls, 1);

  const globalDeps = dependencies({
    provider,
    rateLimiter: new InMemoryRateLimiter({
      perIdentityLimit: 10,
      globalLimit: 1,
    }),
  });
  const globalFirst = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer valid' }),
    globalDeps,
  );
  assert.equal(globalFirst.status, 200);
  const globalSecond = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer valid-b' }),
    globalDeps,
  );
  assert.equal(globalSecond.status, 429);
  assert.equal(providerCalls, 2);
});

test('quota storage outage fails closed before the provider', async () => {
  let providerCalls = 0;
  const response = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      rateLimiter: {
        async admit() {
          throw new Error('quota storage unavailable');
        },
      },
      provider: new FakeSemanticProvider(async () => {
        providerCalls += 1;
        return VALID_RESPONSE;
      }),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test('request contracts, methods, media types, and sizes are rejected safely', async () => {
  const cases: Array<[Request, number]> = [
    [request({ ...VALID_REQUEST, version: 'online-intent-v2' }), 400],
    [request({ ...VALID_REQUEST, model: 'evil' }), 400],
    [
      request({
        ...VALID_REQUEST,
        walletIdsByAlias: { w1: 'wallet-cash' },
      }),
      400,
    ],
    [
      request({
        ...VALID_REQUEST,
        wallets: [
          {
            ...VALID_REQUEST.wallets[0],
            id: 'wallet-cash',
          },
        ],
      }),
      400,
    ],
    [request('{"kind":"proposal"'), 400],
    [request('x'.repeat(13_000)), 413],
    [request(VALID_REQUEST, { 'content-type': 'text/plain' }), 415],
    [request(VALID_REQUEST, {}, 'GET'), 405],
  ];

  for (const [input, expectedStatus] of cases) {
    const response = await handleGatewayRequest(input, dependencies());
    assert.equal(response.status, expectedStatus);
    assert.doesNotMatch(await response.text(), /wallet-cash|content-type|authorization/i);
  }
});

test('disabled gateway returns 503 and never calls the provider', async () => {
  let providerCalls = 0;
  const deps = dependencies({
    enabled: false,
    provider: new FakeSemanticProvider(async () => {
      providerCalls += 1;
      return VALID_RESPONSE;
    }),
  });
  const response = await handleGatewayRequest(
    request(VALID_REQUEST),
    deps,
  );
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);

  const defaultResponse = await disabledGateway.fetch(request(VALID_REQUEST));
  assert.equal(defaultResponse.status, 503);
});

test('provider failures and invalid output are not exposed', async () => {
  let providerCalls = 0;
  const failure = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      provider: new FakeSemanticProvider(async () => {
        providerCalls += 1;
        throw new Error('private provider stack');
      }),
    }),
  );
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private|stack|provider/i);
  assert.equal(providerCalls, 1);

  const invalid = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      provider: new FakeSemanticProvider(async () => ({
        ...VALID_RESPONSE,
        confirmed: true,
      })),
    }),
  );
  assert.equal(invalid.status, 502);
  assert.doesNotMatch(await invalid.text(), /confirmed|private|stack/i);

  const oversized = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      provider: new FakeSemanticProvider(async () =>
        ({
          version: ONLINE_CONTRACT_VERSION,
          kind: 'answer',
          intent: 'spending_summary',
          answerTopic: 'x'.repeat(9_000),
        }) as unknown as OnlineResponse,
      ),
    }),
  );
  assert.equal(oversized.status, 502);
});

test('provider timeout maps to 504', async () => {
  const response = await handleGatewayRequest(
    request(VALID_REQUEST),
    dependencies({
      provider: new FakeSemanticProvider(async () => {
        throw new ProviderTimeoutError();
      }),
    }),
  );

  assert.equal(response.status, 504);
});

test('gateway errors contain no credentials or request content', async () => {
  const response = await handleGatewayRequest(
    request(VALID_REQUEST, { authorization: 'Bearer should-not-leak' }),
    dependencies({
      authenticator: {
        async authenticate() {
          throw new Error('should not leak');
        },
      },
    }),
  );

  const body = await response.text();
  assert.equal(response.status, 503);
  assert.doesNotMatch(body, /should-not-leak|VALID_REQUEST|stack/i);
});

test('Task 5D gateway client is compatible with gateway responses and errors', async () => {
  const deps = dependencies();
  const transport: OnlineGatewayTransport = {
    async send({ body }) {
      const gatewayResponse = await handleGatewayRequest(
        request(body),
        deps,
      );
      return {
        status: gatewayResponse.status,
        body: await gatewayResponse.text(),
      } satisfies OnlineGatewayTransportResponse;
    },
  };
  const client = new OnlineGatewayClient({ transport });
  const result = await client.interpret(VALID_REQUEST);
  assert.equal(result.kind, 'proposal');

  const unauthorizedDeps = dependencies({
    authenticator: {
      async authenticate() {
        throw new Error('not authorized');
      },
    },
  });
  const unauthorizedTransport: OnlineGatewayTransport = {
    async send({ body }) {
      const gatewayResponse = await handleGatewayRequest(
        request(body, { authorization: '' }),
        unauthorizedDeps,
      );
      return {
        status: gatewayResponse.status,
        body: await gatewayResponse.text(),
      };
    },
  };
  const unauthorizedClient = new OnlineGatewayClient({
    transport: unauthorizedTransport,
  });
  await assert.rejects(
    () => unauthorizedClient.interpret(VALID_REQUEST),
    (error: unknown) =>
      error instanceof OnlineGatewayError &&
      error.code === 'unauthorized',
  );
});

test('gateway source contains no outbound network calls', () => {
  const files = [
    '../src/handler.ts',
    '../src/validation.ts',
    '../src/auth.ts',
    '../src/rateLimit.ts',
    '../src/provider.ts',
  ];
  const source = files
    .map((file) =>
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'),
    )
    .join('\n');

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
});
