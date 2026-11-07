# Online Gateway Security Readiness

Status: **offline/test-only**. The gateway is disabled by default and is not
deployed or connected to any provider. No production composition is available.

## Current security guarantees

- The default gateway is disabled and returns `503` before authenticator,
  quota, or provider invocation.
- Enabled test compositions require an explicit `kind: 'test'` composition and
  injected authenticator, rate limiter, and semantic provider.
- Every enabled request requires a Bearer credential. Missing, malformed,
  invalid, expired, or non-finite-expiry identities fail closed.
- A production-intended composition cannot be enabled with the exported fakes.
- Request bodies are read incrementally with a 12 KB UTF-8 byte limit. Honest
  oversized `Content-Length`, dishonest undersized `Content-Length`, missing
  `Content-Length`, stream failures, invalid UTF-8, and malformed JSON fail
  closed before authentication or provider quota admission.
- The server computes a SHA-256 hash over the exact accepted request bytes and
  passes the method, route, challenge reference, and canonical body hash to the
  authenticator.
- Authentication occurs after request validation and before quota admission.
- Provider quota admission occurs after authentication and before provider
  invocation. Invalid requests do not consume provider quota.
- Provider output is bounded and validated by the strict online-intent-v1
  response parser before return.
- The gateway enforces a provider deadline and returns `504` when the provider
  does not settle in time. Late results and late rejections are ignored.
- The gateway client enforces its own deadline even when the injected transport
  ignores `AbortSignal`; late success and late rejection cannot become results.
- Errors contain stable codes and safe messages only. Responses use
  `Cache-Control: no-store`; no permissive CORS policy is added.
- No request bodies, responses, credentials, or attestation tokens are logged.

## Test-only capabilities

- `FakeAuthenticator`, `InMemoryRateLimiter`, and `FakeSemanticProvider` are
  test doubles. The in-memory limiter is process-local, has no UTC window
  reset, and does not coordinate across Worker instances.
- `createTestGateway` explicitly marks a test composition. It must never be
  used by a production entry point or deployment.
- The Play Integrity, Firebase App Check, Play Console, and real provider
  integrations are not implemented.

## Authentication and attestation

Authentication identifies an account or subject. Attestation assesses the
application and/or device. They are not interchangeable.

Current authenticator context contains:

- `method`
- `route`
- `canonicalBodyHash` (server-computed SHA-256 over accepted request bytes)
- `challenge` reference

A claimed client hash or challenge is not proof. A future verifier must validate
a server-issued challenge/proof, an authenticated identity, and app attestation
server-side. It must not trust a client-provided installation ID.

**Production blocker:** no authenticated account verifier or Play
Integrity/App Check verifier exists. The current fake authenticator only
returns synthetic identities.

## Replay protection requirements

The gateway defines a `ReplayProtector` boundary but no production nonce store.
A future implementation must:

- issue or validate a server-issued challenge;
- verify the proof is bound to the canonical method, route, and body hash;
- consume a nonce exactly once;
- enforce strict expiration and reject reuse;
- fail closed when nonce storage is unavailable;
- store minimal pseudonymous records and remove expired records;
- avoid retaining message content, credentials, or attestation tokens.

The optional test replay protector is not production replay protection. Ordinary
bearer tokens and App Check JWTs are not automatically one-time tokens. A JWT
verification alone does not provide single-use replay protection.

## Request-body limits

The gateway rejects a declared `Content-Length` above 12 KB before reading. It
does not trust that header. It reads the request stream incrementally, tracks
actual bytes, stops at the limit, and cancels the reader when possible. It
decodes with fatal UTF-8 handling and validates the exact online-intent-v1
contract.

## Provider deadline and output limits

The gateway imposes a provider deadline, passes an `AbortSignal`, and returns
`504` after the deadline. `Promise.race` bounds how long the gateway waits; it
does not guarantee that an uncooperative provider's underlying network work
stops. Future provider adapters must honor cancellation and enforce network-level
timeouts.

Provider output is serialized and passed through the strict 8 KB response
contract. `JSON.stringify` can still allocate memory for an arbitrarily large
in-memory object supplied by an untrusted provider adapter. A future production
adapter must cap upstream response bytes before parsing or serialization.

## Ingress abuse versus provider quota

Provider quota admission is not a substitute for ingress abuse protection. A
future gateway needs a separate ingress limiter in front of authentication,
body decoding, and quota storage to protect CPU, memory, and identity services.
The current in-memory limiter is only a test fake and does not enforce globally
atomic per-identity or global limits.

## Secrets

Provider credentials must be server-side Worker secrets. Never put a provider
key in the mobile source, an Expo public variable, logs, screenshots, or client
configuration.

Server-side environment names:

- `POCKETA_ONLINE_GATEWAY_ENABLED`
- `POCKETA_ONLINE_PROVIDER`
- `POCKETA_ONLINE_GLOBAL_DAILY_LIMIT`
- `POCKETA_ONLINE_IDENTITY_DAILY_LIMIT`
- `POCKETA_ONLINE_REQUEST_TIMEOUT_MS`
- `POCKETA_ONLINE_PROVIDER_TIMEOUT_MS`
- `POCKETA_ONLINE_ATTESTATION_AUDIENCE`
- `POCKETA_ONLINE_ATTESTATION_PROJECT_NUMBER`
- `GROQ_API_KEY` (future server-side Worker secret only)

Never create `EXPO_PUBLIC_GROQ_API_KEY` or any client-visible secret.

## Privacy and retention

- No balances, transaction history, persistent database IDs, profiles, or device
  identifiers are sent in the online-intent-v1 request.
- Request-local alias maps remain on the device.
- No request or response content is logged by this gateway.
- Errors expose no provider messages or stack traces.
- Explicit user consent is required before a message is sent externally.
- Provider privacy, retention, zero-data-retention, and training terms must be
  reviewed and approved before live use.

## Production blockers

- No production authentication, app attestation, or request-bound proof.
- No production replay store.
- No Durable Object or other globally atomic quota implementation.
- No separate ingress limiter.
- No production provider adapter or approved provider eligibility path.
- No deployment, API key, account, or public endpoint.
- The gateway remains disabled until a separate approved task.

## No-paid-overage requirement

The pilot must use a dedicated free-tier credential with hard global and
per-identity limits below the verified upstream quota. Do not link billing,
enable paid overage, retry into a paid tier, or automatically fall back to
another provider. If accounting is uncertain, stop Online rather than accept
uncapped usage.

## Provider eligibility

Provider terms and audience eligibility are unresolved. Neither the existence
of an adult account owner nor a private test automatically permits Pocketa's
intended student/consumer use. Live integration remains blocked until provider
and legal approval is documented.

## Manual responsibilities

1. Confirm provider eligibility and the intended audience.
2. Verify the free-tier model, limits, region, and privacy settings.
3. Configure a production authenticator and app attestation.
4. Implement durable, atomic quota and replay storage.
5. Configure secrets only through the server-side secret mechanism.
6. Verify no message or credential logging.
7. Test expiry, replay, quota, timeout, malformed-body, and provider-failure
   paths.
8. Obtain explicit deployment approval before enabling Online.
