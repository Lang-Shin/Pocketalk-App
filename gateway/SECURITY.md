# Online Gateway Security Readiness

Status: **offline/test-only**. The gateway is disabled by default and is not
deployed or connected to any provider.

## Trust boundaries

```text
Pocketa mobile app
  -> HTTPS gateway request
  -> Cloudflare-compatible gateway
       -> injected authenticator
       -> injected rate limiter
       -> injected semantic provider
       -> validated online-intent-v1 response
  -> Pocketa local response adapter and validation
  -> explicit user confirmation
  -> local finance execution
```

The gateway is a transport and policy boundary. It is not a finance service and
never executes transactions.

## Data transmitted from the device

The online-intent-v1 request contains only:

- the user's current message;
- the current local date and active month;
- request-local wallet and container aliases;
- entity labels and non-sensitive entity kinds.

It must never contain balances, transaction history, persistent database IDs,
device identifiers, profile information, provider credentials, provider URLs,
models, prompts, tools, or SQL.

Local alias-to-ID maps remain inside the mobile client and are not serialized as
part of the gateway request.

## Authentication

Authentication is mandatory for every request. The handler rejects missing,
invalid, and expired credentials and fails closed if the authenticator is
unavailable. The authenticated subject comes from the verifier, never from a
client-supplied user ID.

The included fake authenticator is for local tests only. It is not production
authentication.

**Unresolved production requirement:** Play Integrity, Firebase App Check, or an
approved account/attestation service must be selected and verified before public
use. The mechanism must support revocation, expiry, replay resistance, and
server-side verification without exposing a permanent shared credential in the
mobile app.

## Quota enforcement

The handler accepts an injected rate limiter that must make atomic per-identity
and global admission decisions. The in-memory limiter is a test fake only; it
does not coordinate across Worker instances and must not be used in public
deployment.

A future Cloudflare implementation should use SQLite-backed Durable Objects:

- one global-budget object for provider-wide quota;
- per-identity objects, or sharded identity counters, for user limits;
- transactional check-and-increment before the provider call;
- a reserved global headroom or hard rejection when storage is unavailable;
- no automatic paid overage or provider retry.

If quota storage is unavailable, the gateway returns a safe service-unavailable
response and does not call the provider.

## Secret storage

Provider credentials must be stored as server-side Worker secrets. They must
never be placed in the mobile source, Expo public variables, logs, screenshots,
or client configuration.

Server-side environment names:

- `POCKETA_ONLINE_GATEWAY_ENABLED`
- `POCKETA_ONLINE_PROVIDER`
- `POCKETA_ONLINE_GLOBAL_DAILY_LIMIT`
- `POCKETA_ONLINE_IDENTITY_DAILY_LIMIT`
- `POCKETA_ONLINE_REQUEST_TIMEOUT_MS`
- `POCKETA_ONLINE_ATTESTATION_AUDIENCE`
- `POCKETA_ONLINE_ATTESTATION_PROJECT_NUMBER`
- `GROQ_API_KEY` (future Worker secret only)

Do not create `EXPO_PUBLIC_GROQ_API_KEY` or any other client-visible secret.

## Privacy and retention

- The gateway does not log request or response bodies.
- HTTP errors contain only a stable code and safe message.
- Responses set `Cache-Control: no-store`.
- No permissive cross-origin policy is added.
- Provider exception details and stack traces are never returned.
- Provider privacy, retention, zero-data-retention, and training policies must be
  reviewed and contractually accepted before live use.
- User consent must be explicit before any message leaves the device.
- No balances or financial history are sent to the gateway.

## Provider and free-tier limitations

- Groq and Gemini both require adult account owners and restrict consumer or
  under-18 use in their terms.
- Gemini's free tier may use prompts/responses to improve products and may allow
  human review.
- Groq's free tier has low request/token limits and may retain data for abuse
  investigation unless zero data retention is enabled.
- Free-tier quotas, model availability, and terms can change without notice.
- No live provider integration is included in this gateway.

## Deployment blockers

- Production authentication and native app attestation are unresolved.
- Provider eligibility, consumer/student use, and financial-message handling
  require legal review.
- Global and per-identity quota enforcement must be implemented with a durable,
  atomic service.
- Privacy and retention terms must be approved.
- The gateway must remain disabled until explicit approval and a separate
  deployment task.
- No API key, account, billing project, Worker deployment, or public endpoint
  exists in this repository.

## Manual responsibilities

Before any deployment:

1. Confirm provider eligibility and free-tier terms.
2. Confirm the account owner is 18+ and approve the target audience.
3. Verify the provider account region and free model availability.
4. Enable the provider's zero-data-retention setting if available.
5. Create the provider key only in the provider dashboard.
6. Store it with a server-side secret command; never share it in chat, logs, or
   screenshots.
7. Implement and verify native attestation.
8. Implement durable atomic quota enforcement.
9. Verify no request or response bodies are logged.
10. Test disabled, unauthorized, quota, timeout, provider-failure, malformed
    response, and stale-response paths.
11. Obtain explicit deployment approval before enabling the gateway.
