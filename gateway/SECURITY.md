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

## Quota prototype (Task 5H, test-only)

### Quota trust boundaries

- Untrusted: the client, request body, headers, dates, aliases, and any
  client-provided pool or reservation identifiers. None of these select a
  quota authority, set quota time, or set limits.
- Trusted composition: the server selects the pool, maximum output tokens,
  framing headroom, clock, HMAC secret, and actual `RateLimiter`. These values
  must come from approved server configuration.
- Authoritative storage: one SQLite-backed Durable Object per provider quota
  pool. It sees pseudonymous identity keys, UTC window keys, integer counters,
  and token reservations only.
- Untrusted provider boundary: provider output is validated as untrusted data
  and never informs quota accounting. The provider is not called after quota
  rejection.
- Local storage boundary: quota tables retain operational keys and integer
  counters only; no request bodies, prompts, provider outputs, credentials, or
  financial data are stored.

- Object model: one authoritative Durable Object per upstream provider
  credential / quota pool. `quotaObjectName(poolId)` returns the stable name
  `quota-pool:<poolId>`, and `quotaObjectStub(namespace, poolId)` resolves it via
  `idFromName`. Every request consuming the same provider budget must use the
  same pool, so the global cap stays atomic.
- Never route per identity: identity is a counter key inside the pool object,
  not a separate object. A per-identity object would split the global budget.
- Server-controlled selection: `poolId` comes only from server composition
  (`quotaReservation`), not from request headers, bodies, or client parameters.
  Tests verify that client-supplied pool headers cannot change it.
- Server-derived time: the handler passes its own clock (`now` or `Date.now`)
  into admission. Request dates and headers never set quota time.
- Configuration: all limits and retention values must be positive safe
  integers. Missing/invalid config throws `QuotaConfigError` at composition
  time; invalid admission metadata returns `unavailable`.
- Dual scope: global (pool-wide) and identity caps are both checked; the
  exhausted scope is reported. Global is checked first when both are exceeded.
- Windows: fixed UTC calendar days (rollover at `00:00:00Z`) and an optional
  fixed short window. Both windows are checked before any counter is written.
- Accounting: each admitted request adds 1 request and reserves
  `expectedInputTokens + maxOutputTokens + framingOverheadTokens` up front. The
  reserved total is stored in `quota_reservations.max_tokens`. Post-call
  reconciliation is not used.
- Input bound: the handler sets `expectedInputTokens` to the raw UTF-8 request
  body byte length, which is already capped at 12 KiB. This is a conservative
  byte-based upper bound, not a tokenizer count. For byte-oriented encoders a
  token cannot represent less than one byte, and framing tokens are counted
  separately, so the estimate is intentionally pessimistic.
- Output and framing: `maxOutputTokens` is the server-configured maximum output
  budget, and `framingOverheadTokens` is documented headroom for prompt and
  protocol framing. Composition rejects missing, zero, negative, fractional,
  non-finite, or unsafe values for either field.
- Reservation values: `expectedInputTokens`, `maxOutputTokens`, and
  `framingOverheadTokens` must be non-negative safe integers; their total must be
  a positive safe integer. Invalid reservations return `unavailable` before any
  counter or reservation write.
- No refunds: reserved tokens stay consumed for timeout, provider failure, and
  uncertain outcomes. The gateway does not automatically refund reservations
  based on provider-reported usage, and provider output never adjusts counters.
- No billing guarantee: reservations are a conservative local budget, not proof
  of upstream billing or tokenizer accuracy. Reconciliation against verified
  provider usage is out of scope.
- Idempotency: `reservationId` is recorded on admission with its pool, identity
  key, and reserved token total. An identical retry returns `duplicate` with
  reason `identical`; reuse of the same ID with a different identity, pool, or
  token total returns `duplicate` with reason `conflict`. Neither consumes
  counters and neither authorizes a provider invocation.
- Atomicity: lookup, cap checks, counter updates, and reservation insert run in
  one `transaction` call. Any failure rolls back and returns `unavailable`,
  which maps to HTTP 503 before the provider is invoked.
- No bypass: the handler admits only `allowed: true` with status `admitted` or
  an omitted status. An inconsistent decision (for example `allowed: true` with
  `quota_exhausted`) is rejected with 429 and never reaches the provider.
- Handler order: request size/schema, authentication, optional replay
  verification, quota admission, then provider invocation. Tests instrument each
  stage and verify later stages are not reached after an earlier failure.
- RateLimiter compatibility: the existing injected `RateLimiter` interface is
  retained. Its context optionally carries `reservationId`, `poolId`, and a
  token reservation, and its decision optionally carries quota status, scope,
  window, retry, and duplicate reason. Legacy `allowed`-only decisions remain
  valid.
- Composition clock: test composition accepts a server-provided `now` so quota
  windows are deterministic. Client dates and headers never set quota time.
- No production composition: the default export is disabled, and `createGateway`
  accepts only the explicit test composition shape. No production provider,
  authentication, quota binding, or deployment is enabled.
- No paid overage: rejection has no fallback provider, no retry into a paid
  tier, and no unmetered path.
- Identity privacy: the authenticated subject is pseudonymized with
  HMAC-SHA256 (`hmacIdentityKey`) using a server-side secret before storage.
  Raw emails and names are never written to quota tables. `SqliteQuotaLimiter`
  fails closed if no pseudonymizer is configured, if it throws, if its output
  is not a valid key, or if it returns the raw subject unchanged.
- Schema: `quota_windows` (global counters), `quota_identity_windows`
  (per-identity counters), and `quota_reservations` (short-lived reservation
  IDs and expiry). Fields are pool id, window kind/key/start/end, identity key,
  request counters, token counters, reservation id, reserved `max_tokens`, and
  timestamps only.
- Retention: both durations are explicit configuration fields.
  `reservationRetentionMs` is the duplicate-retry horizon; `windowRetentionMs`
  is how long ended windows are retained. Both must be positive safe integers,
  and `windowRetentionMs` must exceed the short-window duration.
- Cleanup: `cleanup(now)` deletes reservations with `expires_at_ms < now` and
  global/identity windows with `window_end_ms < now - windowRetentionMs`. It
  never deletes a window whose end is after `now`, so active windows are
  preserved and cleanup cannot reset a window before its real UTC boundary.
- Duplicate safety: a reservation is retained through its exact expiry, so
  cleanup before then cannot allow the same ID to be re-executed. After the
  configured retention, the same ID can be admitted again.
  `reservationRetentionMs` must therefore cover the maximum retry horizon. The
  handler currently generates a fresh reservation ID per HTTP request, so HTTP
  client retries are not deduplicated.
- Privacy: the schema has no request body, prompt, provider output, credential,
  wallet, container, balance, or transaction columns. Tests assert that only
  operational quota fields exist.
- Storage holds only operational keys and integer counters. No message, token,
  wallet, container, or financial data is stored.
- Test storage is real SQLite: tests use Node's built-in `node:sqlite`
  `DatabaseSync` with actual `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` transactions,
  not an in-memory Map. The Durable Object adapter is exercised against a fake
  `transactionSync`/`sql.exec` runtime. Cloudflare DO SQLite cursor behavior,
  lock contention, runtime limits, and deployment remain unverified.
- Replay policy gap: no production replay store or retry horizon is defined yet.
  A production deployment must choose `reservationRetentionMs` to cover that
  horizon before relying on duplicate rejection.
- Concurrency evidence: deterministic tests drive many requests against one
  remaining global slot and one remaining identity slot, simultaneous request
  and token contention, concurrent duplicate IDs across simulated gateways,
  shared instances, and injected storage failures. They verify admitted counts
  never exceed limits and rejected requests leave no partial counters or
  reservations. Tests use two connections to one file-backed SQLite database to
  verify shared caps, duplicate detection, and that a held write lock yields
  `unavailable` with no partial writes. This is local SQLite evidence only, not
  Durable Object runtime evidence.

### SQLite schema and admission semantics

- `quota_windows`: `pool_id`, `window_kind`, `window_key`, `window_start_ms`,
  `window_end_ms`, `global_requests`, `global_tokens`; primary key
  `(pool_id, window_kind, window_key)`.
- `quota_identity_windows`: `pool_id`, `identity_key`, `window_kind`,
  `window_key`, `window_start_ms`, `window_end_ms`, `requests`, `tokens`;
  primary key `(pool_id, identity_key, window_kind, window_key)`.
- `quota_reservations`: `reservation_id` primary key, `pool_id`,
  `identity_key`, `window_key`, `max_tokens`, `created_at_ms`,
  `expires_at_ms`.
- Indexes cover window expiry and reservation expiry. The schema is created and
  migrated inside one storage transaction.
- Admission is one `transactionSync` call: validate input, derive all UTC
  windows, check the reservation ID, check every global and identity request and
  token budget, then update counters and insert the reservation. Any failure
  rolls back the whole transaction and returns `unavailable`.
- Reservation IDs are server-generated. An identical retry returns
  `duplicate/identical`; a conflicting pool, identity, or token total returns
  `duplicate/conflict`. Neither duplicate path consumes counters or invokes the
  provider.

### Cleanup guarantees and test coverage

- Tested: a reservation remains a duplicate at `retention - 1` and exactly at
  `retention`, then cleanup removes it after the horizon.
- Tested: old quota windows can be pruned while an unexpired reservation is
  still retained and continues to reject the duplicate.
- Tested: cleanup removes old global windows, old identity counters, and expired
  reservations while preserving the active global and identity rows.
- Tested: cleanup at `23:59:59.500Z` cannot reset the current daily window; the
  next UTC day creates a new window normally.
- Tested: retention values must be positive, and `windowRetentionMs` must exceed
  the configured short-window duration.
- Tested: quota tables reject body, prompt, provider output, credential, wallet,
  container, balance, and transaction columns.
- Not tested: automatic or scheduled cleanup, Cloudflare alarms, production
  retention values, cleanup batching/performance, and real Durable Object SQLite
  behavior. Cleanup is caller-invoked; no scheduler is implemented.

### Security test coverage

- Request caps: global and per-identity daily and short-window request caps are
  tested separately, including one remaining slot and concurrent contention.
- Token caps: global and per-identity daily token caps, input/output/framing
  totals, over-budget rejection, and invalid token values are tested.
- Time: UTC midnight rollover, short-window rollover, simulated local time
  zones, and client-clock/body-date rejection are tested.
- Reservations: duplicate, conflicting duplicate, concurrent duplicate,
  exact retention boundary, and duplicate detection across connections are
  tested.
- Failure handling: atomic rollback, storage transaction failure, storage
  outage, invalid configuration, and no provider call after quota rejection are
  tested.
- Privacy: tests assert no body, prompt, provider output, credential, wallet,
  container, balance, or transaction columns; a runtime test asserts actual
  quota rows do not contain request body or provider output values.
- Cleanup: expired reservations, old global windows, old identity counters,
  active-window preservation, pre-midnight cleanup, and retention validation are
  tested.
- Composition: multiple simulated gateway instances share one authoritative
  store; the default gateway remains disabled and production-intended
  composition cannot be enabled with fakes.

### Durable Object adapter boundary

- Isolation: `gateway/src/quota/durableObjectStorage.ts` defines structural
  interfaces for `ctx.storage.sql.exec` and `ctx.storage.transactionSync`. It
  does not import `cloudflare:workers`, Wrangler, or any Cloudflare package. The
  Expo app does not import gateway source, so no Cloudflare runtime code enters
  the mobile bundle.
- SQLite-backed API: the adapter targets a SQLite-backed Durable Object. Its
  `transaction` method maps to `transactionSync`, and `exec`, `get`, and `run`
  map to `sql.exec` with cursor consumption via `toArray()`.
- Synchronous transaction guard: the adapter rejects a callback that returns a
  promise from inside the `transactionSync` callback, before the transaction can
  commit. The quota store's admission callback is synchronous.
- Check-and-increment: `SqliteQuotaStore.admit` performs duplicate lookup,
  budget checks, counter updates, and reservation insert inside one adapter
  transaction. Tests instrument the adapter and verify admission and rejection
  each use exactly one transaction and no SQL outside it.
- No network in admission: quota source contains only SQL, crypto, and integer
  logic. Tests scan the quota adapter and store sources for `fetch`, `WebSocket`,
  `XMLHttpRequest`, and HTTP URLs.
- Deterministic local interface: tests implement the structural runtime with
  Node `DatabaseSync` and explicit `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`, so
  adapter behavior can be exercised without Cloudflare. This is a local test
  double, not proof of Cloudflare behavior.
- Unverified Cloudflare behavior: the real Durable Object runtime, SQL cursor
  semantics outside `toArray()`, multi-statement `exec`, `transactionSync`
  rollback behavior, SQLite storage limits, row-write accounting, billing,
  alarms, scheduled cleanup, and deployment are not exercised here. No Wrangler
  configuration is added in this task.

- Not production-ready: no Cloudflare-native test, no scheduled cleanup, no
  deployed binding, and no approved replay or attestation design.
- Known limitation: the gateway generates a fresh `reservationId` per HTTP
  request, so HTTP client retries are not deduplicated.

### Clock authority and skew

- Quota time comes only from the server: `dependencies.now()` or `Date.now()`.
  `Date`, `x-pocketa-now`, client-supplied timestamps, and body date fields are
  ignored for quota. Tests verify this.
- Windows use UTC epoch arithmetic: the daily start is
  `Math.floor(now / 86_400_000) * 86_400_000`, and the optional short window
  uses the same floor division on its configured duration. Local time zones
  cannot change a window. Tests cover `23:59:59Z`, `00:00:00Z`, and the same
  instant expressed with different local offsets.
- Cloudflare Workers and Durable Objects are assumed to use platform-managed,
  synchronized UTC time. One pool has one authoritative object, so its counters
  are compared on one object's clock; there is no cross-instance clock
  comparison.
- Skew handling is not adaptive. A fast server clock closes a window early and
  can under-admit. A slow clock keeps a window open longer and can over-admit up
  to the configured caps, but never beyond them. No client or device clock is
  trusted, and no automatic correction or grace period is implemented.
- A production deployment should monitor platform clock behavior, define an
  acceptable skew, and decide whether a small boundary grace period is needed.
  That policy is not implemented.

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
- `POCKETA_QUOTA_IDENTITY_PEPPER` (future server-side HMAC secret, at least 32
  characters; never rotate silently, because it changes identity keys)
- `GROQ_API_KEY` (future server-side Worker secret only)

Never create `EXPO_PUBLIC_GROQ_API_KEY` or any client-visible secret.

## Privacy and retention

- No balances, transaction history, persistent database IDs, profiles, or device
  identifiers are sent in the online-intent-v1 request.
- Quota storage keeps pseudonymous HMAC identity keys, not emails or names.
- Request-local alias maps remain on the device.
- No request or response content is logged by this gateway.
- Errors expose no provider messages or stack traces.
- Explicit user consent is required before a message is sent externally.
- Provider privacy, retention, zero-data-retention, and training terms must be
  reviewed and approved before live use.

## Production blockers

- No production authentication, app attestation, or request-bound proof.
- No production replay store or approved retry horizon.
- No deployed Durable Object binding or Cloudflare-native verification. The
  SQLite quota prototype in `gateway/src/quota` is test-only (Node `DatabaseSync`
  harness plus a fake Durable Object runtime); it is not wired to a Worker.
- No separate ingress limiter.
- No production provider adapter or approved provider eligibility path.
- No verified upstream free-tier limit, provider-side rate limiting, or billing
  reconciliation.
- No production retention values or scheduled cleanup/alarm.
- No deployment, API key, account, or public endpoint.
- The gateway remains disabled until a separate approved task.

## Free-tier assumptions

- The intended deployment uses a dedicated free-tier credential with hard global
  and per-identity limits set below the verified upstream quota.
- Upstream free-tier models, limits, regions, and terms can change without
  notice. Local quota limits are a conservative application budget, not a
  guarantee of upstream billing or availability.
- No paid overage, automatic fallback, or retry into a paid tier is allowed. If
  accounting is uncertain, Online must stop rather than accept uncapped usage.
- The gateway does not reconcile reservations with provider-reported usage.
  Provider timeouts, failures, and uncertain outcomes retain the reservation.
- Token reservations are conservative but not tokenizer-exact. The byte-based
  input bound and framing headroom are not proof that upstream token accounting
  will match.
- No provider free-tier eligibility, account, or terms have been approved for
  this prototype.

## Local prototype versus Cloudflare readiness

- The local prototype uses Node `DatabaseSync` with explicit SQLite transactions
  and a fake structural Durable Object runtime. It does not execute inside
  Cloudflare Workers or a real Durable Object.
- It does not validate real `transactionSync` scheduling, SQL cursor behavior,
  multi-statement `exec`, Durable Object lock contention, request concurrency,
  alarms, storage limits, row-write accounting, billing, deployment bindings, or
  secret management.
- Passing local tests establishes deterministic quota logic and interface
  behavior only. It does not establish that a Cloudflare deployment is safe,
  correct under production concurrency, or within free-tier limits.
- Deployment readiness would require an isolated SQLite-backed Durable Object,
  the same conformance tests in that runtime, scheduled cleanup/alarm testing,
  server-side secret wiring, production auth/attestation/replay, an approved
  provider adapter, load testing, and verified upstream limits.

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
