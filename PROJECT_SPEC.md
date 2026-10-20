# Pocketa Project Specification

## Document Status and Provenance

- **Status:** Reconstructed planning specification. This is not the original master specification, which was unavailable in the repository and in the current conversation.
- **Basis:** The Phase 1 planning summary and requirements stated in this conversation, plus the existing `README.md`.
- **Repository name:** `Pocketalk-App`.
- **Product name:** **Pocketa** is used in this document. The repository and README still use “Pocketalk-App”; the naming conflict is unresolved.
- **Implementation status:** No application code, database, UI, LLM integration, or automated tests have been implemented or verified. Phase 1 was research and planning only. Phase 2 has not started.
- **Authority:** Until the original master specification is supplied, this document is the working source of truth for requirements and scope. Requirements that were not established are marked `ASSUMPTION`, `PROPOSED`, or `UNRESOLVED`.

Status labels used in this document:

- **ESTABLISHED:** Explicitly required or decided in the available project context.
- **PROPOSED:** A Phase 1 planning direction that still requires user approval or verification.
- **ASSUMPTION:** A necessary working assumption that must be confirmed.
- **UNRESOLVED:** A decision that has not been made and must not be treated as final.

## 1. Product Summary

Pocketa is an offline-first mobile budgeting app for students, designed around natural-language entry and container-based budgeting. It helps a user record allowance, income, and expenses, divide available money into purpose-specific containers, track a manually maintained virtual wallet, and review spending history.

The app uses a local AI assistant to turn natural-language statements such as “I spent ₱120 on lunch” into a proposed financial transaction. The assistant is advisory only. Every proposed financial change must be validated by deterministic application logic and explicitly confirmed by the user before it is saved.

### 1.1 Core value proposition

- Make budgeting fast and approachable for students.
- Keep the core experience usable without an internet connection or cloud account.
- Separate “where the money is” (wallets) from “what the money is for” (containers).
- Make every financial change traceable and reversible.
- Reduce friction through natural-language entry without surrendering financial control to an AI model.

### 1.2 Target users

- Filipino students, especially those managing a periodic allowance.
- Users who track cash and a manually maintained virtual GCash balance.
- Users on Android devices who need offline access and may have limited connectivity.
- Users who want simple, friendly budgeting guidance rather than full accounting software.

The exact target Android versions, minimum device specifications, and minimum RAM baseline are `UNRESOLVED`.

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide a clear home dashboard of available funds, container budgets, and recent activity.
- Support planned allocations to budget containers without treating those allocations as spending.
- Track external income and expenses accurately.
- Support transfers between wallets and between containers without creating income or expense.
- Track savings goals separately from spending targets, with savings balances represented by dedicated containers.
- Provide a transaction history that supports review and reversal.
- Provide a local AI chatbot that proposes transactions in a structured format for user confirmation.
- Keep core budgeting fully functional offline.
- Maintain a modern, accessible, student-friendly Philippine-peso-first interface.
- Keep the data layer replaceable and testable so UI mock data can later be swapped for SQLite-backed repositories.

### 2.2 Non-goals for the initial product

- Real GCash integration, bank integration, or automated account aggregation.
- Collection or storage of GCash PINs, passwords, OTPs, or other financial credentials.
- Cloud-hosted LLM inference or an account/backend dependency for core budgeting.
- Production financial logic in the Phase 2 UI-foundation phase.
- Investment, credit, tax, or lending advice.
- Multi-user accounts, social features, or shared budgets unless later approved.
- Multi-currency support in the MVP; PHP is the working assumption.
- Guaranteed support for every Android device or every on-device model/runtime combination.

## 3. Functional Requirements

### 3.1 Home dashboard

The dashboard should provide a strong visual hierarchy and a quick understanding of the user’s financial position.

Required capabilities:

- Show the total available balance.
- Show wallet balances, including the manually maintained virtual GCash wallet.
- Show budget container summaries: allocated amount, spent amount, and remaining amount.
- Show savings goal progress.
- Show recent transactions.
- Provide a clear entry point for adding a transaction.
- Provide a clear entry point for the AI assistant.
- Distinguish planned allocations from actual spending.
- Support loading, empty, and error states.
- Support light and dark modes.

The exact dashboard card order and whether balances are shown per wallet on the dashboard are `UNRESOLVED`.

### 3.2 Budget containers

- Create and manage budget containers with a name and planned allocation.
- Display allocated, spent, and remaining amounts for the active period.
- Display progress in a way that distinguishes safe, near-limit, and over-limit states.
- Allow planned allocation changes without changing actual wallet balances.
- Allow transfers between containers without creating income or expense.
- Prevent allocations from exceeding available funds unless an explicit policy allows it; the policy is `UNRESOLVED`.
- Support active and archived containers.
- Show how container activity relates to transactions and savings goals.
- Provide a clear empty state when no containers exist.

The exact container categories, icon set, period model, and rollover behavior are `UNRESOLVED`.

### 3.3 Virtual wallet

- Display wallet balances, including cash and a manually maintained virtual GCash wallet.
- Allow the user to record wallet transfers.
- Make clear that the virtual GCash wallet is manually maintained and is not connected to GCash.
- Never request or store GCash credentials, PINs, passwords, or OTPs.
- Show wallet-level history.
- Support wallet creation/archiving only if later approved; the MVP wallet set is `UNRESOLVED`.

### 3.4 Transactions

- Record external income, expenses, wallet transfers, container transfers, savings contributions, allocations, and adjustments through deterministic workflows.
- Capture an amount, date/time, description or payee, and the relevant wallet/container references.
- Show transactions in a history view with clear type and direction.
- Support filtering by date, type, wallet, and container if approved; the exact filters are `UNRESOLVED`.
- Support voiding or reversing a transaction without deleting financial history.
- Prevent duplicate submission through idempotency handling.
- Show confirmation before saving a chatbot-proposed transaction.
- Keep transaction calculations separate from AI output.

### 3.5 AI chatbot

- Accept natural-language financial statements and questions.
- Interpret the user’s intent in a constrained set of supported intents.
- Produce a structured draft transaction, not a committed transaction.
- Display the proposed amount, type, source, destination, container, and date before confirmation.
- Require explicit user confirmation before saving any financial change.
- Validate the draft with deterministic rules and schemas before writing to the database.
- Ask for clarification when required information is missing or ambiguous.
- Refuse or safely handle unsupported, unsafe, or inconsistent requests.
- Work without a cloud LLM.
- Show the local model/runtime status and provide graceful degradation if the model is unavailable.
- Never calculate authoritative balances or write financial records directly.

### 3.6 Savings goals

- Represent each savings goal with a dedicated savings container.
- Show target amount and progress based on the container’s actual balance.
- Treat contributions as transfers into the savings container, not expenses.
- Do not treat the target amount as money held.
- Support completing, archiving, or adjusting a goal only according to a policy that is `UNRESOLVED`.

### 3.7 Profile and settings

- Display user/profile information without requiring a cloud account.
- Provide light, dark, and system theme options.
- Provide access to currency/formatting information; PHP is the MVP currency.
- Provide settings for data export/import or backup only if approved; the policy is `UNRESOLVED`.
- Provide model download/removal and AI status information if on-device AI is included.
- Provide privacy/security information.
- Provide app version and diagnostic information without exposing sensitive data.
- Provide a way to clear local data with explicit confirmation.

### 3.8 Search, filters, and reports

Search, advanced filters, charts, and reports are not established as MVP requirements. They are `UNRESOLVED` and should not be assumed without approval.

## 4. UX and Visual Requirements

- **Aesthetic:** Modern fintech, friendly to students, calm and trustworthy. Do not imitate the official GCash app or copy its branding, layout, or assets.
- **Currency:** Clear Philippine peso formatting. Use the `₱` symbol and appropriate grouping. Financial values must be derived from integer minor units and formatted at the presentation boundary.
- **Hierarchy:** The most important balances and actions must be immediately scannable. Avoid decorative clutter that competes with financial information.
- **Accessibility:** Accessible contrast, readable type sizes, touch targets, labels, focus behavior, and screen-reader semantics. Do not rely on color alone to communicate status.
- **Theme:** Consistent design tokens for color, typography, spacing, radii, elevation, and motion. Support light and dark modes, with a system-following default unless later decided.
- **Responsiveness:** Layouts must adapt to common Android phone sizes, safe areas, keyboard insets, and long text. Tablet-specific layouts are `UNRESOLVED`.
- **Motion:** Smooth, restrained animations that clarify state changes. Respect reduced-motion preferences where supported.
- **Components:** Reusable balance cards, budget cards, transaction rows, progress indicators, chat bubbles, and confirmation dialogs.
- **States:** Every data-driven screen must define loading, empty, error, and populated states.
- **Mock data:** Mock data may be used in the UI-foundation phase, but it must be isolated behind repository/selector boundaries so it can be replaced by SQLite-backed data without rewriting screens.

## 5. Technology Stack and Architecture

### 5.1 Established stack requirements

- React Native.
- Expo.
- TypeScript.
- Expo Router.
- Local SQLite for persistent application data.
- Offline-first operation.
- On-device/local LLM as an unverified technical requirement.
- No cloud backend or cloud LLM required for the core experience.

### 5.2 Phase 1 planning direction

These items were recommended during Phase 1 and remain subject to approval or verification:

- **Expo SDK 57** with React Native 0.86 and React 19.2 for stability. Expo SDK 58 was released on 2026-10-15 but was considered too new at planning time.
- TypeScript in strict mode.
- Expo Router for file-based navigation.
- `expo-sqlite` with WAL mode, foreign keys enabled, transactional writes, and versioned migrations.
- Repository and domain-service layering so UI components do not issue ad hoc SQL.
- Zod or an equivalent schema library for validating external and AI-generated data.
- A query/state approach such as `useLiveQuery` and/or a small store such as Zustand. The final state-management choice is `UNRESOLVED`.
- A custom Expo development build for native LLM modules. Expo Go is sufficient only for non-native UI work; it cannot load arbitrary custom native modules.
- An AI provider abstraction so the runtime can be replaced without leaking native details into screens.
- Drizzle ORM or raw SQL. The choice is `UNRESOLVED`; raw SQL may still be needed for constraints, triggers, and reporting.

### 5.3 Architectural boundaries

- **Presentation:** Screens and reusable UI components. No direct database or native LLM calls.
- **Application/domain:** Deterministic use cases such as recording income, recording expense, transferring funds, allocating budget, reversing transactions, and validating drafts.
- **Data:** Repositories, migrations, SQLite access, and mapping between database rows and domain models.
- **AI:** Prompt construction, local model lifecycle, output parsing, schema validation, and draft creation. The AI layer cannot write financial records.
- **Platform:** Native modules, model files, file-system access, and device capabilities behind adapters.

A screen or chatbot must call a validated use case, not write directly to tables or mutate balances.

### 5.4 Proposed folder structure

```text
src/
  app/                 Expo Router routes and layouts
  features/            Feature-specific screens, components, and hooks
  domain/              Entities, value objects, use cases, accounting rules
  db/                  Schema, migrations, repositories, query helpers
  ai/                  Model adapters, prompts, schemas, draft workflow
  components/          Shared design-system components
  lib/                 Formatting, dates, ids, result types, utilities
  theme/               Design tokens and theme providers
tests/
scripts/
```

The exact feature folders and navigation route names are `UNRESOLVED`.

## 6. Database Design

### 6.1 Storage principles

- SQLite is the local source of truth.
- All financial amounts are stored as signed integers in PHP centavos (minor units). Floating-point values must not be used for money.
- Financial writes occur inside database transactions.
- Schema changes are versioned migrations.
- Foreign keys and relevant check constraints must be enabled.
- Balances are derived from postings, not stored as independent mutable numbers.
- Historical financial records are voided or reversed, not deleted.
- One currency (PHP) is used for MVP unless multi-currency is later approved.

### 6.2 Proposed tables

The following is the Phase 1 conceptual schema. Exact SQL columns, indexes, constraints, and migration sequencing require approval in the data-layer phase.

| Table | Purpose | Important design notes |
|---|---|---|
| `wallets` | Where money is held: cash, virtual GCash, etc. | Manually maintained; no real GCash connection. Needs name, kind, currency, active/archived state, timestamps. |
| `containers` | What money is for: budget categories and dedicated savings containers. | Needs name, active/archived state, display metadata, timestamps. |
| `budget_periods` | Defines the budgeting period used for allocations and reporting. | Period model and rollover behavior are `UNRESOLVED`. |
| `allocations` | Planned amounts assigned to containers for a period. | Planned only. Must never affect wallet or container balances. |
| `transactions` | Groups a financial event and its postings. | Needs kind, status, occurred-at timestamp, local date, description, idempotency key, and audit timestamps. |
| `postings` | Signed ledger entries referencing a wallet and/or container. | Single source of truth for balances. Amounts are integer centavos. |
| `savings_goals` | User savings targets. | Linked 1:1 to a dedicated savings container. Target is not money held. |
| `ai_drafts` | Audit record of chatbot-proposed actions. | Stores input, proposed structured payload, validation state, model/runtime metadata, and confirmation status. |
| `app_meta` | Schema version, local settings, and model metadata. | Must not contain GCash credentials or other secrets. |

### 6.3 Relationship and integrity rules

- A posting must reference at least one of a wallet or a container.
- Wallet-only postings are valid only for wallet transfers and wallet adjustments.
- Container-only postings are valid only for allocations, container transfers, and savings contributions.
- Income and expenses require matched wallet and container postings.
- Every transaction must have an idempotency key or equivalent duplicate-prevention mechanism.
- A savings goal references exactly one dedicated savings container.
- Archived records remain available for historical reporting.
- The final uniqueness, nullability, and check constraints are `UNRESOLVED` pending schema design.

## 7. Financial Accounting Rules

These rules are mandatory. They must be implemented in deterministic, tested application/domain code.

### 7.1 Balances

- **Wallet balance** = sum of postings for that wallet.
- **Container balance** = sum of postings for that container.
- **Total available funds** must not double-count the wallet view and the container view.
- The system must maintain this invariant after every committed transaction:

```text
sum(all wallet balances) == sum(all container balances)
```

- Balances are derived from postings. Do not store a second independently editable balance field.
- Planned allocations, goal targets, and progress percentages are not balances.

### 7.2 Posting rules

| Event | Wallet postings | Container postings | Effect |
|---|---|---|---|
| External income | Positive on destination wallet | Positive on destination container | Increases recorded funds on both axes |
| Expense | Negative on source wallet | Negative on source container | Decreases recorded funds on both axes |
| Allocation / budget assignment | None | Positive on destination container, negative on source container | Sums to zero; no income or expense |
| Wallet transfer | Positive on destination wallet, negative on source wallet | None | Sums to zero; no income or expense |
| Container transfer | None | Positive on destination container, negative on source container | Sums to zero; no income or expense |
| Savings contribution | None | Positive on savings container, negative on source container | Sums to zero; not an expense |
| Adjustment | Paired wallet and container postings | Paired wallet and container postings | Corrects records while preserving the ledger invariant |

### 7.3 Explicit exclusions

- Transfers between containers must not create income or expenses.
- Wallet transfers must not create income or expenses.
- Savings contributions must not be recorded as expenses.
- Planned allocations must not reduce actual balances and must not be treated as spending.
- Savings goal target amounts must not be treated as money held.
- Do not count both the wallet balance and the container balance as separate spendable totals.
- The AI model must never directly modify a balance or write a transaction.

### 7.4 Reversal and correction

- Posted transactions are voided/reversed rather than deleted.
- A reversal creates the opposite financial effect and preserves an audit link to the original transaction.
- The original transaction must not remain silently counted after a successful reversal.
- The exact reversal schema and user-facing undo window are `UNRESOLVED`.

### 7.5 Validation and write order

1. Validate required fields, amount, references, and intent.
2. Validate that the resulting postings preserve the accounting invariant.
3. Enforce balance/overdraft policy.
4. Begin a database transaction.
5. Insert the transaction and postings atomically.
6. Commit only if all constraints pass.
7. Return a receipt derived from committed records.

Negative balances and overdraft behavior are `UNRESOLVED` and must be explicitly decided before production use.

## 8. AI and Chatbot Workflow

### 8.1 Status of on-device AI

On-device LLM support is an **unverified technical requirement**, not a confirmed working implementation. Qwen3-4B is a candidate to investigate and benchmark, not a settled runtime or model choice.

Phase 1 research found:

- Qwen3-4B-Instruct-2507 has a native context of 262,144 tokens, but practical mobile context must be much smaller.
- A Q4_K_M GGUF is approximately 2.5 GB. A Q4_0 GGUF is available and may be relevant to GPU paths that support Q4_0.
- FP16 KV cache is roughly 144 KiB per token: about 288 MiB at 2K context and 576 MiB at 4K context.
- Total weights and runtime at 4K context are roughly 3.5–4.1 GB, which is unsafe to assume on 8 GB devices without measurement.
- `llama.rn` is a candidate React Native binding. Its Android OpenCL support is limited to Q4_0/Q6_K, so Q4_K_M may use CPU instead.
- LiteRT-LM has official Qwen3-4B artifacts, but the current React Native bridge reviewed in Phase 1 did not list Qwen3-4B support. A fork or custom native integration may be required.
- Qwen3-1.7B is a possible fallback if Qwen3-4B cannot meet memory/performance targets.
- No benchmark has been run on the target physical device. All performance figures from external sources are unverified for Pocketa.

### 8.2 Chatbot workflow

The required high-level workflow is:

1. User enters natural language.
2. The app constructs a constrained prompt and invokes the local model.
3. The model returns a structured draft, ideally constrained JSON.
4. The app parses the response and validates it with a schema.
5. Deterministic application logic validates the proposed intent, references, amounts, and accounting effects.
6. The app displays a confirmation UI showing the exact proposed transaction and relevant resulting balances.
7. If the user cancels, nothing is written.
8. If the user explicitly confirms, a deterministic use case writes the transaction atomically.
9. The app shows a receipt and offers reversal according to the approved policy.

Confirmation is mandatory. A model response, model confidence, or chat message is never authorization to write.

### 8.3 Trust boundaries

- Model output is untrusted input.
- The model may interpret language and propose fields, but cannot compute authoritative totals, mutate balances, or call database writes.
- The model must not receive GCash credentials or unnecessary sensitive data.
- Prompt injection in user text must not bypass confirmation or validation.
- Unsupported or ambiguous requests must lead to clarification or refusal, not guessed financial writes.
- Model files must be integrity-checked where feasible.
- The exact prompt-injection defenses and model-output logging policy are `UNRESOLVED`.

### 8.4 Performance and quality targets

The following are proposed gates, not achieved results:

- No out-of-memory failure on the target 8 GB device class.
- Peak app memory below 4.5 GB.
- Median end-to-end proposal time below 5 seconds.
- 95th-percentile end-to-end proposal time below 10 seconds.
- Valid JSON response rate above 99% after constrained decoding/parsing.
- Intent accuracy above 90% on a defined evaluation set.
- Amount accuracy above 95% on a defined evaluation set.
- Decode throughput decrease below 30% over a 10-minute thermal test.

These thresholds require user approval and a physical-device benchmark.

## 9. Offline-First Behavior

- The app must launch and perform core budgeting without a network connection.
- SQLite is the local source of truth.
- No cloud account or backend is required for core flows.
- The chatbot must run locally; cloud LLM fallback is not part of the core design.
- Network access may be used for optional model download/update, but the app must degrade gracefully and never block core budgeting on connectivity.
- Model download size, storage requirements, resumability, and deletion behavior are `UNRESOLVED`.
- Data export/import and backup are `UNRESOLVED`; if implemented, they must preserve accounting invariants and must not expose secrets.
- Multi-device sync is not part of the MVP unless explicitly approved.
- Migrations must be safe for existing local data and must not silently discard financial records.
- The app must handle low-storage and interrupted-download conditions without corrupting budgeting data.

## 10. Security and Privacy

- Do not integrate with GCash or imitate its official app.
- Never request, collect, or store GCash PINs, passwords, OTPs, or similar credentials.
- Do not log sensitive financial details or model prompts containing personal information by default.
- Do not commit secrets or credentials to the repository.
- Treat all AI output as untrusted input.
- Require explicit user confirmation for chatbot-proposed financial changes.
- Keep financial writes behind deterministic validation and authorization logic.
- Consider local database encryption (for example SQLCipher) and device authentication. Both are `UNRESOLVED` and must not be claimed as implemented.
- Protect exported backups and diagnostics; redact sensitive values.
- Review third-party dependencies and model licenses before distribution.
- Define a privacy policy and data-retention behavior before release. This is `UNRESOLVED`.
- Handle app backgrounding by unloading or pausing the LLM appropriately to reduce memory pressure.

## 11. Testing and Verification Strategy

No tests exist yet. The following strategy is required for later phases.

### 11.1 Unit tests

- Money parsing and Philippine peso formatting using integer centavos.
- Every posting rule and transaction type.
- Accounting invariant: sum of wallet balances equals sum of container balances.
- Allocation and savings behavior: no income/expense created by transfers.
- Idempotency and duplicate-commit prevention.
- Reversal behavior and historical integrity.
- Date/period boundary behavior.
- AI draft schema validation and rejection of malformed output.
- Domain validation that blocks AI-originated invalid writes.

### 11.2 Integration and database tests

- Migrations from a fresh database and from prior versions.
- Foreign-key and check-constraint enforcement.
- Atomic rollback on failed writes.
- Repository mapping and query correctness.
- Concurrent or repeated submission behavior.
- Backup/import only if implemented.

### 11.3 UI and end-to-end tests

- Navigation between dashboard, containers, wallet, assistant, history, and profile.
- Light/dark themes and system theme changes.
- Loading, empty, error, and populated states.
- Confirmation and cancellation paths for chatbot drafts.
- Accessibility labels, contrast, touch targets, and screen-reader behavior.
- Responsive layout on representative Android sizes.
- Keyboard and safe-area behavior.

### 11.4 AI evaluation and device benchmarks

- A versioned evaluation set of natural-language statements and expected drafts.
- Constrained-JSON validity and parse-failure handling.
- Intent/amount/entity accuracy.
- Prompt-injection and unsafe-request tests.
- Physical-device performance, memory, thermal, and battery measurements.
- Offline behavior with no network.
- Model unavailable/corrupt/out-of-storage scenarios.

### 11.5 Verification rules

- Run the repository’s actual lint, typecheck, and test commands when they exist.
- Report the exact commands and actual results.
- Do not claim that a feature works because code was written; verify it.
- Do not claim device performance without measurement on the relevant hardware.
- UI mock screens must be identified as mock-backed until connected to repositories.

The exact test framework and CI setup are `UNRESOLVED`.

## 12. Development Phases

The sequence is a planning proposal. Each phase requires user approval before the next begins.

### Phase 0 — Documentation and project governance

- Establish this specification and persistent agent instructions.
- Status: documentation work only; no app features implemented.

### Phase 1 — Planning and feasibility research

- Define architecture, accounting model, schema direction, and AI feasibility questions.
- Research Expo, SQLite, Android memory limits, llama.rn, LiteRT-LM, and Qwen3 candidates.
- Status: research/planning completed in conversation; no code or device benchmark produced.

### Phase 2 — UI foundation

- Configure the React Native/Expo/TypeScript project.
- Set up Expo Router and navigation.
- Establish theme, typography, spacing, reusable components, and light/dark modes.
- Build the dashboard, containers, wallet, AI chatbot, history, and profile screens.
- Use realistic mock data behind replaceable boundaries.
- Responsive Android-oriented layouts and restrained motion.
- No LLM integration, cloud backend, or production financial logic.
- Status: not started.

### Phase 3 — SQLite data layer

- Implement schema, migrations, repositories, and query boundaries.
- Move mock-backed screens to SQLite-backed data.
- Add database integration tests.

### Phase 4 — Deterministic financial engine

- Implement transactions, postings, allocations, transfers, savings, reversals, idempotency, and invariant validation.
- Add comprehensive unit and integration tests.
- Resolve overdraft, period, and container policies before production use.

### Phase 5 — On-device AI feasibility spike

- Integrate the most credible local runtime in a development build.
- Benchmark Qwen3-4B and fallback candidates on target hardware.
- Validate memory, latency, thermal behavior, JSON reliability, and model storage.
- Choose or reject a model/runtime based on measured evidence.

### Phase 6 — Chatbot integration

- Connect validated local-model drafts to confirmation UI and deterministic use cases.
- Add evaluation, prompt-injection, and failure-path tests.
- Keep all writes user-confirmed.

### Phase 7 — Hardening and release

- Security review, accessibility audit, offline/data-loss testing, backup policy, performance tuning, and release packaging.
- Confirm licensing and privacy requirements.

## 13. Assumptions

- **ASSUMPTION:** The app is named Pocketa, despite the repository name `Pocketalk-App`.
- **ASSUMPTION:** The initial audience is Filipino students using PHP.
- **ASSUMPTION:** Cash and a manually maintained virtual GCash wallet are the initial wallet types.
- **ASSUMPTION:** A single user and a single local device are the MVP model.
- **ASSUMPTION:** Core budgeting does not require login, cloud sync, or a network connection.
- **ASSUMPTION:** The AI assistant is part of the intended product, but its runtime and model are not yet validated.
- **ASSUMPTION:** Phase 2 UI may use mock data, provided the data boundary is replaceable.
- **ASSUMPTION:** Expo SDK 57 is the preferred starting point, subject to approval and compatibility verification.
- **ASSUMPTION:** Light and dark themes are required; the default may follow the system.
- **ASSUMPTION:** English is the initial interface language; Taglish/localization is not finalized.

## 14. Unresolved Decisions

The following must not be treated as settled:

1. **Master specification:** The original document has not been provided; this file is a reconstruction.
2. **App name:** Pocketa versus Pocketalk-App.
3. **Target device baseline:** Android versions, minimum RAM, and representative physical test devices.
4. **Expo version:** SDK 57 versus SDK 58 or another version.
5. **Navigation structure:** Exact tab/stack arrangement for the six top-level screens.
6. **MVP feature cut:** Which features are required for the first release versus later phases.
7. **AI in MVP:** Whether the chatbot ships in the MVP or after the core budgeting release.
8. **AI model/runtime:** Qwen3-4B versus Qwen3-1.7B; llama.rn versus LiteRT-LM versus another runtime; quantization; context length; model distribution.
9. **AI performance gates:** Final latency, memory, accuracy, and thermal thresholds.
10. **Database access layer:** Drizzle versus raw SQL or a hybrid.
11. **Exact schema:** Columns, indexes, constraints, migration sequence, and audit fields.
12. **Budget period model:** Weekly, semi-monthly, monthly, custom, and rollover behavior.
13. **Container scope:** Global containers versus per-wallet containers.
14. **Overdraft policy:** Whether negative wallet/container balances are allowed and how they are presented.
15. **Allocation policy:** Whether planned allocations may exceed available funds.
16. **Savings policy:** Withdrawal, goal completion, target adjustment, and archiving behavior.
17. **Reversal policy:** Undo window, audit presentation, and whether reversal requires a reason.
18. **Encryption and authentication:** Whether to use SQLCipher, biometric/device authentication, or neither in the MVP.
19. **Backup/export:** Format, encryption, destination, import validation, and retention.
20. **Localization:** English-only versus English/Taglish/Filipino.
21. **State management:** `useLiveQuery`, Zustand, React Context, or a combination.
22. **Testing tools and CI:** Unit, component, end-to-end, and device-test frameworks.
23. **Charts and reports:** Whether they belong in the MVP.
24. **Wallet management:** Whether users can create/archive wallets in the MVP.
25. **Data retention and privacy policy:** Required before public release.

## 15. Definition of Done for Any Phase

A phase is complete only when:

- The approved scope is implemented.
- Existing working code is preserved.
- Relevant lint, typecheck, and tests pass, with actual results reported.
- New financial logic has deterministic validation and tests.
- AI-originated writes require explicit confirmation and never bypass domain rules.
- Offline behavior is not regressed.
- Mock implementations are clearly identified.
- Documentation reflects actual behavior and remaining gaps.
- The user has reviewed and approved the phase before work proceeds to the next phase.
