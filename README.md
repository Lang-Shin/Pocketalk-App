# Pocketa

AI-powered mobile app for natural language allowance and container-based budget tracking.

## Status

The Phase 2 UI foundation remains an unapproved exploratory Expo scaffold. Phase 3 added a local SQLite ledger (migrations v1–v4), repositories, a deterministic finance engine, the system Unallocated account, the permanent system Savings container, and automatic monthly rollover. Phase 4 now connects the budgeting screens to that ledger through a SQLite-backed finance service and provider, including active and historical months, container lifecycle, Unallocated allocation, Savings transfers, and reporting. Phase 4 is awaiting review. Profile and assistant content still use sample data, and there is no GCash integration or AI model connection.

## Stack

- Expo SDK 57 / React Native 0.86
- TypeScript in strict mode
- Expo Router with typed routes
- Expo SQLite with versioned migrations
- React Native Safe Area Context, Screens, Gesture Handler, and Reanimated

## SQLite and ledger

- `src/db/migrations.ts` owns the versioned schema (v1–v4) and applies pending migrations transactionally.
- `src/db/financeRepository.ts` contains parameterized reads and writes; `src/db/financeEngine.ts` enforces accounting, lifecycle, idempotency, rollover, and reversal/correction rules.
- `src/db/expoDatabase.ts` exposes `openPocketaDatabase()` to open and migrate the on-device database once per session and enable WAL on native platforms. `FinanceProvider` calls it at startup, initializes system containers and default wallets through the engine/service, and gates the app on a loading or error state.
- `metro.config.js` adds the WebAssembly asset and cross-origin isolation headers required by `expo-sqlite` on web. The web export bundles, but browser worker/runtime behavior remains unverified.
- `src/data/financeService.ts` wraps engine reads and actions for the screens and routes container transfers to allocation, return, Savings contribution, or Savings withdrawal operations. `src/db/defaultWallets.ts` idempotently creates the manually maintained Cash on hand and Virtual GCash wallets.
- `src/db/systemContainers.ts` owns the stable Unallocated and Savings identities and their idempotent bootstrap. Income without a user container is posted to Unallocated; `allocateToContainer`, `returnToUnallocated`, and `transferBetweenContainers` create container-only transfers.
- The **Unallocated** account cannot be renamed, archived, limited, deleted, or used for direct expenses. It remains part of the invariant and reports but is hidden from ordinary container lists by default.
- The **Savings** container accumulates across months and is never swept by monthly rollover. Users transfer money between Savings and any active budget container (including Unallocated) through `contributeToSavings` and `withdrawFromSavings`. These are `savings`-kind transfers, not income or expenses, and do not affect net savings. Savings cannot be renamed, archived, limited, deleted, or spent from directly. There are no separate long-term savings goals or targets.
- **Automatic monthly rollover**: at initialization and before relevant queries, the engine detects past calendar months that have not been processed and sweeps positive balances from ordinary budget containers into Unallocated for each such month. Savings and Unallocated are excluded. The sweep is a `container_transfer`, not income or expense. Rollover is idempotent: a completed sweep is recorded in `month_rollover_runs` and is never replayed. If a late entry or correction changes a closed month's balances, the engine reverses and replays the affected rollover sweep.
- **Unallocated carryover**: swept balances remain available as carried actual money. Carryover is not new income and does not change wallet totals; monthly budget limits are planning values and never carry as funds.
- **Reporting distinction**: monthly net savings is external income minus external expenses for the selected period. It is a flow, not a balance. The Savings ending balance is a cumulative stock, and Savings contributions/withdrawals are transfers that must not be added to net savings.
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

The current suite contains 87 tests covering migrations, persistence, foreign keys, rollback, WAL, idempotency, calendar boundaries, peso parsing, balance invariants, transfers, reversals/corrections, container lifecycle, historical labels, recorded-date metadata, net savings, late entries, Unallocated bootstrapping, allocation/return flows, system-container protections, allocation idempotency, Savings container protection and accumulation, Savings transfers (contribute, withdraw, Savings→ordinary), monthly rollover sweeps (ordinary and archived containers, excluding Savings and Unallocated), multiple missed months, leap-year and year-boundary rollover, local-midnight cutoff and timezone metadata, late entry and correction replay, clock-backward stability, rollover atomicity and idempotency, file-backed close/reopen persistence without duplicate sweeps, new allowance after rollover, full carryover/net-savings/Savings-balance reporting, and service-level default-wallet, optional income/expense notes, default-Unallocated income, overdraft rejection, archived-container reactivation, system-container protection, all container/Savings transfer routes and transfer idempotency, metadata, read-only history, monthly-history flows, saved historical transactions, month-end rollover results, explicit open/pre-baseline months, and history type/date/container/wallet filter combinations. The database and service tests run against real SQLite via `node:sqlite`; they do not verify native Expo SQLite behavior. No React Native UI test framework is installed, so screen behavior and accessibility remain manually unverified.

## Current boundaries

- Phase 4 is implemented and awaiting review. Budget screens read and write the local SQLite ledger; Profile and assistant content still use the sample repository. There are no separate long-term savings goals or targets.
- The active month follows the device's local date. Provider refreshes on foreground/resume and while the app remains open, but native device timezone-change and overnight rollover behavior is still unverified.
- Native Expo SQLite startup, restart, migration, and WAL behavior is unverified until tested on Android. WAL is enabled only for non-web native initialization; in-memory test databases do not use WAL.
- Web SQLite bundling is configured through `metro.config.js`, but browser worker/WASM runtime behavior has not been verified; Android/iOS are the primary targets.
- Budget-limit behavior across rollover remains `UNRESOLVED` in the specification. Materialized versus derived monthly summaries and the late-correction overdraw recovery UX are also unresolved.
- There is no React Native UI test framework or end-to-end device test yet. Screen persistence, accessibility, safe-area, keyboard, and touch flows require manual verification.
- The assistant is a UI preview; it does not call an AI model and cannot save transactions.
- The virtual GCash wallet is manually maintained and is not connected to GCash.
- No cloud sync, authentication, or encryption is implemented.
