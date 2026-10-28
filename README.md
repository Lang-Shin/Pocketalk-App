# Pocketa

AI-powered mobile app for natural language allowance and container-based budget tracking.

## Status

An exploratory Phase 2 UI scaffold is built with Expo, React Native, Expo Router, and TypeScript but is not approved as Phase 2 completion. Phase 3 adds a local SQLite ledger (migrations v1–v4), repositories, a deterministic finance engine, the system Unallocated account, the permanent system Savings container, and automatic monthly rollover. Wallets, containers, limits, and transactions shown in the UI are still seeded mock data; screens are not yet wired to SQLite. There is no GCash integration or AI model connection.

## Stack

- Expo SDK 57 / React Native 0.86
- TypeScript in strict mode
- Expo Router with typed routes
- Expo SQLite with versioned migrations
- React Native Safe Area Context, Screens, Gesture Handler, and Reanimated

## SQLite and ledger

- `src/db/migrations.ts` owns the versioned schema (v1–v4) and applies pending migrations transactionally.
- `src/db/financeRepository.ts` contains parameterized reads and writes; `src/db/financeEngine.ts` enforces accounting, lifecycle, idempotency, rollover, and reversal/correction rules.
- `src/db/expoDatabase.ts` exposes `openPocketaDatabase()` to open and migrate the on-device database, enable WAL on native platforms, and ensure system containers exist. Startup wiring is not connected to the current screens.
- `src/db/systemContainers.ts` owns the stable Unallocated and Savings identities and their idempotent bootstrap. Income without a user container is posted to Unallocated; `allocateToContainer`, `returnToUnallocated`, and `transferBetweenContainers` create container-only transfers.
- The **Unallocated** account cannot be renamed, archived, limited, deleted, or used for direct expenses. It remains part of the invariant and reports but is hidden from ordinary container lists by default.
- The **Savings** container accumulates across months and is never swept by monthly rollover. Users transfer money between Savings and any active budget container (including Unallocated) through `contributeToSavings` and `withdrawFromSavings`. These are `savings`-kind transfers, not income or expenses, and do not affect net savings. Savings cannot be renamed, archived, limited, deleted, or spent from directly. There are no separate long-term savings goals or targets.
- **Automatic monthly rollover**: at initialization and before relevant queries, the engine detects past calendar months that have not been processed and sweeps positive balances from ordinary budget containers into Unallocated for each such month. Savings and Unallocated are excluded. The sweep is a `container_transfer`, not income or expense. Rollover is idempotent: a completed sweep is recorded in `month_rollover_runs` and is never replayed. If a late entry or correction changes a closed month's balances, the engine reverses and replays the affected rollover sweep.
- Money is stored as signed integer PHP centavos. Postings are the source of truth for balances, and wallet totals must equal container totals, including Unallocated, Savings, and archived balances.
- Database tests use a real `node:sqlite` adapter and enable WAL for file-backed test databases. Android/iOS SQLite and WAL behavior still require device or emulator verification.

## Run locally

```powershell
npm install
npm start
```

Then scan the QR code with Expo Go on an Android device, press `a` to open an Android emulator, or press `w` for the browser preview. Expo Go currently supports SDK 57; keep the installed Expo Go version aligned with the project SDK.

Run the browser preview directly with:

```powershell
npm run web
```

`npm run android` requires Android Studio, an Android SDK, and a running emulator or connected device.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android
npx expo export --platform web
```

The current suite contains 71 tests covering migrations, persistence, foreign keys, rollback, WAL, idempotency, calendar boundaries, peso parsing, balance invariants, transfers, reversals/corrections, container lifecycle, historical labels, recorded-date metadata, net savings, late entries, Unallocated bootstrapping, allocation/return flows, system-container protections, allocation idempotency, Savings container protection and accumulation, Savings transfers (contribute, withdraw, Savings→ordinary), monthly rollover sweeps (ordinary and archived containers, excluding Savings and Unallocated), multiple missed months, leap-year and year-boundary rollover, local-midnight cutoff and timezone metadata, late entry and correction replay, clock-backward stability, rollover atomicity and idempotency, file-backed close/reopen persistence without duplicate sweeps, new allowance after rollover, and full carryover/net-savings/Savings-balance reporting. The database tests run against real SQLite via `node:sqlite`; they do not verify native Expo SQLite behavior.

## Current boundaries

- Phase 2 screens still read and mutate the in-memory mock store in `src/data/financeStore.tsx`; SQLite persistence is implemented but not yet connected to those screens.
- Reloading the app, or using **Reset mock session** in Profile, restores the sample data. Database-backed screen persistence is deferred.
- Native Expo SQLite startup, restart, migration, and WAL behavior is unverified until tested on Android. WAL is enabled only for non-web native initialization; in-memory test databases do not use WAL.
- The system Unallocated and Savings containers are fully implemented in the engine. Neither system balance is wired into the current mock-backed screens. There are no separate long-term savings goals or targets.
- The assistant is a UI preview; it does not call an AI model and cannot save transactions.
- The virtual GCash wallet is manually maintained and is not connected to GCash.
- No cloud sync, authentication, or encryption is implemented.
