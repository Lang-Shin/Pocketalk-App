# Pocketa

AI-powered mobile app for natural language allowance and container-based budget tracking.

## Status

The Phase 2 UI foundation was never separately approved; its exploratory Expo scaffold became the base for Phase 4. Phase 3 added a local SQLite ledger (migrations v1–v4), repositories, a deterministic finance engine, the system Unallocated account, the permanent system Savings container, and automatic monthly rollover. Phase 4 connects Home, Budgets, Wallet, History, and Monthly History to that ledger through a SQLite-backed finance service and provider, including active and historical months, container lifecycle, Unallocated allocation, Savings transfers, rollover, and reporting. Phase 5 adds a local assistant prototype that turns constrained expense, income, Savings-contribution, and Savings-withdrawal sentences into validated drafts. It uses deterministic on-device rules, never writes directly, and saves only after explicit confirmation through the finance service. No LLM runtime or model file is integrated or benchmarked, so the on-device AI feasibility gate remains open. Profile content still uses sample data. Automated checks pass, but React Native UI/accessibility/E2E tests are not implemented. There is no GCash integration or cloud AI connection.

## Implemented screens

SQLite-backed screens:

- **Home** reads the active month, wallet totals, recent activity, Savings balance, and month summary.
- **Budgets** reads and writes active/historical months, container limits and metadata, Unallocated, Savings, rollover results, and container lifecycle actions.
- **Wallet** reads wallet totals and wallet activity and records wallet transfers, income, expenses, and container transfers.
- **History** reads transactions by effective date with type/date/container/wallet filters and transaction detail.
- **Monthly History** reads historical summaries, container results, rollover results, Savings contributions/withdrawals/ending balance, and prior-month transactions.

Sample-backed screen:

- **Profile** uses local sample profile content; theme preference is session-only.

Local assistant prototype:

- **Assistant** uses deterministic local intent rules, not an LLM. It classifies transaction, transfer, financial-question, and clarification-request messages into typed intents.
- Typed intents include `income`, `expense`, `wallet_transfer`, `container_transfer`, `balance_inquiry`, `spending_summary`, `income_summary`, `budget_inquiry`, `clarification_request`, and `unknown`. Savings transfers use `container_transfer`.
- It drafts expenses, income, wallet-to-wallet transfers, ordinary container-to-container transfers, Savings contributions, and Savings withdrawals, or answers read-only questions about active-month income, expenses, net savings, balances, and budget remaining.
- Ambiguous or missing transfer endpoints, containers, or wallets produce a clarification; future dates, archived containers, insufficient balances, unsupported intents, and historical question periods are rejected.
- Drafts show their amount, source, destination, effective date, period, and available balance, but cannot be saved from this phase. Confirmation and ledger writes belong to Phase 6.
- Chat state is session-only and drafts are not persisted to an `ai_drafts` audit table. No model is downloaded or bundled.

Connected workflows:

- Startup, migration, loading, error, and retry states through `FinanceSession` and `FinanceProvider`.
- Active month from the device local date, with foreground/resume refresh and historical month selection.
- Income and expense entry with effective dates, optional notes, wallet/container validation, and idempotency.
- Wallet-to-wallet transfers and container transfers routed to Unallocated allocation, return to Unallocated, Savings contribution, or Savings withdrawal.
- Container create, rename, recolor, re-icon, optional monthly limit, archive, reactivate, and safe delete.
- Automatic calendar-month rollover into Unallocated, excluding Savings and Unallocated.
- Monthly reporting that keeps net savings separate from Savings contributions, withdrawals, and ending balance.
- Local assistant interpretation with drafts, clarification choices, read-only financial answers, and the same deterministic validation rules used by manual entry.
- Default Cash on hand and Virtual GCash wallets, with no bank or GCash connection.

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

## Assistant prototype

- `src/ai/localAssistant.ts` contains the deterministic classifier, parser, container/wallet resolution, proposal validation, clarification model, and read-only question answers.
- Every result includes a typed `interpretation` object with the intent, optional integer minor-unit amount and PHP currency, effective date, source/destination wallets or containers, description, confidence, explicit `missingFields`, `clarificationQuestion`, and a short user-facing `reasoningSummary`. Confidence is parse metadata, not proof of correctness or authorization to write.
- `src/ai/providers` defines `AssistantProvider`; `MockAssistantProvider` is the current, clearly labeled rules-based implementation. The assistant screen accesses interpretation through this provider boundary.
- `src/features/assistant/AssistantScreen.tsx` sends user text through the provider and renders readable intent labels, drafts, extracted details, explicit missing fields, clarification chips, loading/error/retry states, and read-only answer cards. It reads local summaries but has no write or confirmation action.
- Phase 5 is interpretation-only: the assistant layer has no database or native model access and cannot create ledger entries, change balances, or bypass Phase 6 confirmation.
- The module is intentionally provider-ready for a future local-model adapter, but no model/runtime, download flow, integrity check, or benchmark exists yet. Chat messages are not persisted.

## Local model integration status

Target device: **OPPO Reno8 5G**, MediaTek Dimensity 1300, Mali-G77 MC9, **8 GB physical RAM**, 256 GB storage, Android. Virtual RAM is not counted as physical RAM. Target model: **Qwen2.5-1.5B-Instruct**, preferably quantized Q4_K_M where the runtime supports it.

The app is on Expo SDK 57, React Native 0.86.3, and the New Architecture. Expo Go cannot load the custom native libraries required by current on-device LLM runtimes, so a development build and prebuild/native changes would be required.

| Candidate | Architecture fit | Qwen2.5-1.5B footprint | Current assessment |
|---|---|---|---|
| `react-native-executorch` 0.10.x | Explicit Expo SDK 57 / RN 0.86 support; New Architecture; development build; Android 13+ and iOS 17+ per docs | Quantized 8da4w `.pte` is about 1.1 GiB; not Q4_K_M | Primary candidate when Expo compatibility is the priority; requires `react-native-blob-util`, Babel/worklets setup, and a dev build |
| `llama.rn` 0.12.x | New Architecture; Expo config plugin; development build | Q4_K_M GGUF is about 0.93-1.0 GB before KV/runtime overhead | Primary candidate if Q4_K_M and JSON-schema/GBNF output are required; RN 0.86 compatibility needs a dev-build spike |
| LiteRT-LM | Android/iOS native runtimes; no documented official React Native binding | Qwen2.5-1.5B artifacts exist | Requires a custom native bridge; defer |

The model file must not be bundled. Download must require explicit user awareness and integrity checking. No runtime dependency or model has been added, and there is no cloud fallback. See `docs/local-model-integration.md` for the runtime comparison, blockers, and the full OPPO Reno8 5G verification procedure.

The assistant now uses an `AssistantProvider` boundary with `load()`, `unload()`, and interpretation methods. The current provider is `MockAssistantProvider`, which runs the existing deterministic rules and is explicitly labeled as **not a language model**. A `LocalLlmProvider` should only be added after the target Android version is confirmed and a development-build spike passes memory, latency, thermal, offline, JSON-reliability, and failure-path checks.

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

At the Phase 5 prototype wrap-up, all listed checks pass: 141/141 tests, 21/21 `expo-doctor` checks, and successful Android and web exports. The user reports that Phase 4 was tested on a physical Android device; this session did not independently rerun native device checks.

The current suite contains 141 tests covering migrations, persistence, foreign keys, rollback, WAL, idempotency, calendar boundaries, peso parsing, balance invariants, transfers, reversals/corrections, container lifecycle, historical labels, recorded-date metadata, net savings, late entries, Unallocated bootstrapping, allocation/return flows, system-container protections, allocation idempotency, Savings container protection and accumulation, Savings transfers (contribute, withdraw, Savings→ordinary), monthly rollover sweeps (ordinary and archived containers, excluding Savings and Unallocated), multiple missed months, leap-year and year-boundary rollover, local-midnight cutoff and timezone metadata, late entry and correction replay, clock-backward stability, rollover atomicity and idempotency, file-backed close/reopen persistence without duplicate sweeps, new allowance after rollover, full carryover/net-savings/Savings-balance reporting, and service-level default-wallet, optional income/expense notes, default-Unallocated income, overdraft rejection, archived-container reactivation, system-container protection, all container/Savings transfer routes and transfer idempotency, metadata, read-only history, monthly-history flows, saved historical transactions, month-end rollover results, explicit open/pre-baseline months, history type/date/container/wallet filter combinations, and wallet balance preservation, multi-wallet balance derivation, global container balance aggregation, wallet-transfer invariant preservation, responsive content/grid sizing at phone, tablet, and wide viewports, and session-level integration across startup, loading/error/retry states, income, expenses, transfers, Savings, container lifecycle, duplicate submission, revision-driven refresh, rollover, historical reporting, and file-backed restart persistence, plus assistant transaction/transfer/question/clarification classification, amount/date handling, Taglish input, wallet and container transfer drafting, missing/ambiguous endpoint clarification, archived-container rejection, future-date blocking, balance checks, read-only monthly/balance/budget answers, structured interpretation metadata, provider-boundary behavior, and the absence of an assistant execution step. The database and service tests run against real SQLite via `node:sqlite`; they do not verify native Expo SQLite behavior. No React Native UI test framework is installed, so screen behavior and accessibility remain manually unverified.

## Current boundaries

- Phase 4 implementation is complete for its approved screen and workflow scope, but the phase gate remains open. Home, Budgets, Wallet, History, and Monthly History read and write the local SQLite ledger. Phase 5 adds a deterministic, interpretation-only local assistant prototype; no LLM runtime or model file is integrated or benchmarked. Profile content still uses sample data. There are no separate long-term savings goals or targets, no automatic monthly allowance income, no cloud sync, and no real GCash integration.
- Assistant chat state, drafts, and read-only answers are session-only. Confirmation and ledger execution are Phase 6 work and are not implemented here. There is no `ai_drafts` audit table, model download, model-integrity check, prompt-injection evaluation, or on-device performance/thermal benchmark. The deterministic rules are a prototype, not an accuracy-validated natural-language model.
- The active month follows the device's local date. Provider refreshes on foreground/resume and while the app remains open, but native device timezone-change and overnight rollover behavior is still unverified.
- The user reports that Phase 4 was tested on a physical Android device. This session did not independently rerun native Expo SQLite startup, restart, migration, WAL, transaction, navigation/form, keyboard, or storage-path checks. Configuration inspection is not a substitute for device verification. WAL is enabled only for non-web native initialization; in-memory test databases do not use WAL.
- Web SQLite bundling is configured through `metro.config.js`, but browser worker/WASM runtime behavior has not been verified; Android/iOS are the primary targets.
- Budget-limit behavior across rollover remains `UNRESOLVED` in the specification. Materialized versus derived monthly summaries and the late-correction overdraw recovery UX are also unresolved.
- There is no React Native UI test framework or end-to-end device test. Screen rendering, accessibility semantics, safe-area, keyboard, and touch flows require manual verification, so the Phase 4 gate is not fully closed. Responsive layout and card-grid sizing are covered by unit tests at 320, 360, 390, 430, 768, and 1280 widths, and web screenshots were checked at those sizes, but on-device visual checks are still manual.
- The assistant is a deterministic local-rule prototype behind `MockAssistantProvider`, not an AI model. It only classifies messages, prepares drafts, and answers read-only questions in Phase 5; it cannot save transactions or change balances. Confirmation and execution are deferred to Phase 6. It does not persist chat history or AI draft audit records.
- The virtual GCash wallet is manually maintained and is not connected to GCash.
- Wallet management (custom wallet creation, archiving, and lifecycle) remains unresolved in the specification (§14 Decision 24). The app exposes the two established default wallets (Cash on hand and Virtual GCash) under the approved global-container accounting model; containers are global allocations of recorded funds and do not belong to individual wallets.
- No cloud sync, authentication, or encryption is implemented.
