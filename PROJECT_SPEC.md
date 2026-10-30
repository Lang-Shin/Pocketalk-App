# Pocketa Project Specification

## Document Status and Provenance

- **Status:** Reconstructed planning specification. This is not the original master specification, which was unavailable in the repository and in the current conversation.
- **Basis:** The Phase 1 planning summary and requirements stated in this conversation, plus the existing `README.md`.
- **Requirements revision:** This revision adds monthly calendar budget cycles with permanent savings history, and fully customizable budget-container lifecycle requirements.
- **Repository name:** `Pocketalk-App`.
- **Product name:** **Pocketa** is used in this document. The repository and README still use “Pocketalk-App”; the naming conflict is unresolved.
- **Implementation status:** Phase 1 was research and planning only. Phase 2 (UI foundation) exists as an uncommitted exploratory Expo scaffold but is not approved as Phase 2 completion. Phase 3 (SQLite data layer and financial engine) is implemented: migrations v1–v4, a deterministic `FinanceEngine`, the system Unallocated and Savings containers, automatic monthly rollover, savings transfers, idempotency, reversals, corrections, effective-dated container metadata, container lifecycle, and SQLite-backed tests. Phase 4 (UI integration) is implemented and awaiting review: budget screens use a SQLite-backed service/provider, active and historical months, container lifecycle, Unallocated allocation, Savings transfers, and reporting are connected, and 78 tests pass. Profile and assistant content remain sample-backed. Phase 5+ (AI, hardening) has not been started.
- **Authority:** Until the original master specification is supplied, this document is the working source of truth for requirements and scope. Requirements that were not established are marked `ASSUMPTION`, `PROPOSED`, or `UNRESOLVED`.

Status labels used in this document:

- **ESTABLISHED:** Explicitly required or decided in the available project context.
- **PROPOSED:** A Phase 1 planning direction that still requires user approval or verification.
- **ASSUMPTION:** A necessary working assumption that must be confirmed.
- **UNRESOLVED:** A decision that has not been made and must not be treated as final.

## 1. Product Summary

Pocketa is an offline-first mobile budgeting app for students, designed around natural-language entry and container-based budgeting. It helps a user record allowance, income, and expenses, divide available money into purpose-specific containers, track a manually maintained virtual wallet, and review spending history. Budgeting is organized into calendar-month cycles, with permanent monthly savings history and user-defined containers that can be customized, archived, reactivated, and safely retired.

The app uses a local AI assistant to turn natural-language statements such as “I spent ₱120 on lunch” into a proposed financial transaction. The assistant is advisory only. Every proposed financial change must be validated by deterministic application logic and explicitly confirmed by the user before it is saved.

### 1.1 Core value proposition

- Make budgeting fast and approachable for students.
- Keep the core experience usable without an internet connection or cloud account.
- Separate “where the money is” (wallets) from “what the money is for” (containers).
- Make every financial change traceable and reversible.
- Make monthly budgeting automatic while preserving every prior month’s results.
- Let users shape containers around their real life instead of forcing fixed categories.
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
- Support planned monthly budget limits and actual container funding without treating either as spending.
- Track external income and expenses accurately.
- Support transfers between wallets and between containers without creating income or expense.
- Support calendar-month budget cycles that become active automatically from the device’s local date, without a manual reset.
- Preserve monthly income, expense, net-savings, and budget-performance history permanently, with month selection and comparison.
- Maintain one permanent Savings container that accumulates money across months and is clearly distinguished from monthly net savings.
- Support user-defined budget containers with custom names, icons, colors, optional monthly limits, and a safe archive/reactivate/delete lifecycle.
- Provide a transaction history that supports review, reversal, and effective-date-based historical correction.
- Provide a local AI chatbot that proposes transactions in a structured format for user confirmation.
- Keep core budgeting fully functional offline.
- Maintain a modern, accessible, student-friendly Philippine-peso-first interface.
- Keep the data layer replaceable and testable so UI mock data can later be swapped for SQLite-backed repositories.

### 2.2 Non-goals for the initial product

- Real GCash integration, bank integration, or automated account aggregation.
- Collection or storage of GCash PINs, passwords, OTPs, or other financial credentials.
- Cloud-hosted LLM inference or an account/backend dependency for core budgeting.
- Production financial logic in the Phase 2 UI-foundation phase.
- Separate long-term savings goals, target amounts, or goal-progress tracking.
- Investment, credit, tax, or lending advice.
- Multi-user accounts, social features, or shared budgets unless later approved.
- Multi-currency support in the MVP; PHP is the working assumption.
- Guaranteed support for every Android device or every on-device model/runtime combination.

## 3. Functional Requirements

### 3.1 Home dashboard

The dashboard should provide a strong visual hierarchy and a quick understanding of the user’s financial position.

Required capabilities:

- Show the active calendar month and the active period dates.
- Show the total available balance.
- Show wallet balances, including the manually maintained virtual GCash wallet.
- Show budget container summaries: monthly limit, spent amount, and remaining amount for the active period.
- Show container actual balances separately from monthly budget usage where both are displayed.
- Show the permanent Savings balance and distinguish it from monthly net savings and monthly Savings contributions.
- Show recent transactions, including entries whose effective date belongs to a prior month.
- Provide a clear entry point for adding a transaction.
- Provide a clear entry point for the AI assistant.
- Provide a clear entry point for monthly savings history and container management.
- Distinguish planned monthly limits from actual spending and actual balances.
- Support loading, empty, and error states.
- Support light and dark modes.

The exact dashboard card order and whether balances are shown per wallet on the dashboard are `UNRESOLVED`.

### 3.2 Budget containers

User-created budget containers are data records, not hardcoded categories or screen components. A user must be able to shape containers around their actual needs.

Separately, the app maintains exactly one system-managed **Unallocated** account for recorded income that has not been assigned to a user container. It is not a user-created category and is not exposed as an ordinary container for rename, archive, budget-limit, or delete operations. See §7.9 for its accounting behavior.

Required container capabilities:

- Create containers with a custom name, icon, color, optional monthly budget limit, and display order.
- Rename a container and change its icon, color, or optional monthly budget without changing its immutable identity.
- Display the container’s actual balance separately from its monthly budget limit, monthly spending, and monthly remaining amount.
- Display monthly progress in a way that distinguishes safe, near-limit, and over-limit states without relying on color alone.
- Change a monthly budget limit without changing actual wallet or container balances.
- Keep changes to a monthly budget limit from silently rewriting prior months’ historical budget performance. The exact effective scope of recurring and mid-month limit changes is `UNRESOLVED`.
- Allow transfers between containers without creating income or expense.
- Prevent funding or monthly limit changes from violating balance or allocation policy. Monthly limits are non-negative planning values; actual allocations cannot exceed available recorded funds, and overdrafts are blocked in the current model.
- Support active and archived containers, including archiving a container with a remaining balance.
- Support seasonal use cases such as archiving Rent or Bills during summer vacation and reactivating them when needed.
- Reactivate an archived container for the current and future months without retroactively creating budgets for the archived months.
- Preserve all transaction history, postings, budget limits, and audit records when a container is renamed, recolored, re-iconed, archived, or reactivated.
- Show archived containers and their remaining balances in a clearly labeled archived area so funds do not appear to vanish.
- Exclude archived containers from new spending and active monthly planning until reactivated. The current model rejects new income, expenses, and transfers involving an archived container; its balances and history remain visible.
- Include archived containers in historical reports for every period in which they had activity, a budget limit, or a balance.
- Prevent duplicate or ambiguous container names if the approved policy requires unique names; the uniqueness policy is `UNRESOLVED`.
- Validate names, icons, colors, and limits and provide accessible labels for every customization control.
- Provide loading, empty, error, and populated states when managing containers.

Container lifecycle and historical meaning:

- Archive is the normal safe retirement path. It must not move money, delete history, or change past reports.
- Deleting a container with a remaining balance or any transaction/history references must be blocked until the user resolves the consequences. The required safe path is to explain the impact, transfer any remaining funds if desired, and archive the container.
- Financial history must never be cascade-deleted when a container is deleted or archived. A hard delete is allowed only for a container with no balance, no transactions, no limits, and no audit references, subject to explicit confirmation; a soft-delete/tombstone policy remains `UNRESOLVED`.
- Renaming or changing metadata must not rewrite past transaction meaning. The data model must preserve effective-dated container display metadata or an equivalent immutable historical label, so reports can show the name/icon/color that applied when the activity occurred. Whether historical views also show the current name or “formerly known as” is `UNRESOLVED`.
- Historical results must not change merely because a container is archived. They may change only through an audited correction to the underlying financial records.

Terminology:

- **Monthly budget limit** is a planning cap. It is not a balance and creates no postings.
- **Container actual balance** is derived from postings and represents recorded money assigned to the container.
- **Budget spending** is the sum of external expense postings assigned to the container in the selected period.
- Changing a monthly budget limit must never be confused with funding a container or transferring actual money.

The exact icon set, color validation rules, name-length limits, sorting behavior, and per-month limit overrides are `UNRESOLVED`.

### 3.3 Virtual wallet

- Display wallet balances, including cash and a manually maintained virtual GCash wallet.
- Allow the user to record wallet transfers.
- Make clear that the virtual GCash wallet is manually maintained and is not connected to GCash.
- Never request or store GCash credentials, PINs, passwords, or OTPs.
- Show wallet-level history.
- The initial UI exposes one primary, manually maintained virtual wallet. The storage layer retains multi-wallet support, but containers are global and must not imply per-wallet allocation. Additional wallet-management UI remains `UNRESOLVED`.

### 3.4 Transactions

- Record external income, expenses, wallet transfers, container transfers, savings contributions, actual container funding, and adjustments through deterministic workflows.
- Capture an amount, effective local date, recorded timestamp, description or payee, and the relevant wallet/container references.
- Store the transaction’s effective local calendar date explicitly rather than deriving it later from a UTC timestamp. The recorded time zone or UTC offset must also be retained for audit.
- Default a new transaction’s effective date to the device’s current local date, while allowing the user to choose a different date for a late entry or correction.
- Show transactions in a history view with clear type, direction, effective date, and recorded date when they differ.
- Group monthly reports strictly by effective date, not by the date the entry was keyed in.
- Allow late entries into a prior month. A prior-month entry updates that month’s report immediately and must not be misclassified into the active month.
- Support correcting a prior-period transaction through an audited reversal and replacement. By default, the reversal must use the original effective date so the original month is corrected rather than distorted by the correction date. The exact correction workflow is `UNRESOLVED`.
- Keep actual balances current when a late or corrected transaction is saved; only the monthly reporting period is historical.
- Support filtering by date, type, wallet, and container if approved; the exact filters are `UNRESOLVED`.
- Support voiding or reversing a transaction without deleting financial history.
- Prevent duplicate submission through idempotency handling across retries and app restarts.
- Show confirmation before saving a chatbot-proposed transaction.
- Keep transaction calculations separate from AI output.
- Future-dated entries are blocked in the current model. Late entries remain allowed.

### 3.5 AI chatbot

- Accept natural-language financial statements and questions.
- Interpret the user’s intent in a constrained set of supported intents.
- Produce a structured draft transaction, not a committed transaction.
- Display the proposed amount, type, source, destination, container, effective date, and affected monthly period before confirmation.
- Reject drafts that reference archived or deleted containers unless the user explicitly chooses a valid active replacement.
- Require explicit user confirmation before saving any financial change.
- Validate the draft with deterministic rules and schemas before writing to the database.
- Ask for clarification when required information is missing or ambiguous.
- Refuse or safely handle unsupported, unsafe, or inconsistent requests.
- Work without a cloud LLM.
- Show the local model/runtime status and provide graceful degradation if the model is unavailable.
- Never calculate authoritative balances or write financial records directly.
- Never create, rename, archive, reactivate, or delete containers, and never change monthly budget limits.

### 3.6 Permanent Savings

- Provide one system-managed Savings container with a stable identity.
- Create it idempotently during database initialization; it cannot be duplicated, renamed, archived, or deleted.
- Treat contributions and withdrawals as internal container transfers, not income or expenses.
- Allow transfers between Savings, Unallocated, and active ordinary budget containers.
- Exclude Savings from automatic month-end rollover.
- Show the Savings balance, monthly contributions, and monthly withdrawals separately from net savings.
- Do not provide separate long-term savings goals, target amounts, progress percentages, or goal-completion workflows.

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

Monthly budget-period reporting, monthly savings history, historical month selection, and month comparison are established requirements. Search, advanced filters, charts, and other report types are not established as MVP requirements; they are `UNRESOLVED` and must not be assumed without approval.

### 3.9 Monthly budget cycles

- **Default period:** Calendar months. Each period starts on the first day of the month and ends on the last day of that month in the user’s local calendar, including the correct length of February in leap and non-leap years.
- **Active period:** Derived automatically from the device’s current local date. No “start new month” or reset button is required.
- **Automatic rollover:** The app must determine the active period on launch, on foreground/resume, when the local date changes, and when the device time zone changes. A period must be correct even if the app was closed on the first day or for several months.
- **Closed-month sweep:** For each closed calendar month that has not yet been processed, positive balances in ordinary budget containers are transferred into Unallocated through an internal `container_transfer`. Savings and Unallocated are excluded. Archived ordinary containers are swept if they still hold a positive balance.
- **No new money:** Rollover is not income or an expense, creates no new allowance, and leaves all wallet balances unchanged. It moves only container allocations.
- **Fresh monthly plan:** The active month exposes that period’s budget limits and spending totals. Limits are period-scoped planning values derived from the user’s configured container budgets or an approved per-month override.
- **No automatic reset of balances:** Budget usage resets only because it is filtered to the new period. Unused budget limits are not money. Rollover moves actual unused ordinary-container balances to Unallocated; Savings balances are never swept.
- **Spending totals:** Monthly spending is calculated from external expense postings whose effective date falls within the selected calendar month.
- **Historical permanence:** Transactions, postings, monthly summaries, and prior-month results must be preserved permanently unless the user explicitly deletes all local data. No rollover process may overwrite or discard them.
- **Historical corrections:** Late entries and audited corrections post to the transaction’s effective period. Corrections must update the affected month’s report and preserve an audit trail. If a late write changes a closed month’s ordinary-container balances, existing rollover sweeps from that month onward are reversed and replayed atomically under a new revision.
- **Time-zone stability:** Historical reports use the effective local date recorded with each transaction. Changing the device time zone must not silently move past transactions into different months. The active period may change with the device’s current local date. Moving the clock backward must not undo a completed rollover.
- **Offline operation:** Monthly rollover, reporting, and comparison must work entirely from local data without a server or network connection.
- **Month state:** Whether completed months are locked against ordinary edits, and how a time-zone change that alters the active month is communicated to the user, are `UNRESOLVED`.
- **Limit rollover:** Carrying unused budget limits into a future month as a planning feature is `UNRESOLVED`; if ever supported, it must never create money or change actual balances.
- **Non-calendar cycles:** Weekly, semi-monthly, or custom cycle support is not part of the established MVP model and is `UNRESOLVED`.

### 3.10 Monthly savings history

- Provide a monthly history screen that lists calendar months containing financial activity or budget data and allows navigation to adjacent months, including empty ones.
- Allow the user to select a previous month and inspect its results.
- For the selected month, show at minimum:
  - External income.
  - External expenses.
  - Net savings.
  - Total monthly budget limits.
  - Total budget spending.
  - Total budget remaining or over-budget amount.
  - Per-container budget performance.
  - Monthly Savings contributions and withdrawals.
  - System Savings ending balance.
  - Unallocated carryover from the prior month.
  - Current available budget, including Unallocated and active ordinary-container balances.
- **Net savings definition:** External income minus external expenses for the selected month, calculated from transactions by effective date. Net savings is a flow metric, not a wallet or container balance or an ending balance.
- **Exclusions:** Wallet transfers, container transfers, actual container funding, Savings contributions, and monthly budget limits must not increase or decrease net savings.
- **Savings containers:** Show Savings contributions, withdrawals, and ending balances separately from net savings. A transfer into Savings is not an expense, and an external income deposited into a user savings container is counted as income exactly once.
- **No double counting:** The app must never count a transfer into a savings container as both a saving and an expense or as additional income.
- **Historical results:** Reports must update when a prior-period transaction is added or corrected through the approved audited workflow. Past results must not be silently rewritten by a new month’s budget configuration.
- **Empty periods:** When a month with no activity is selected, show an explicit empty state rather than a missing-data or error state. Whether such months appear in the main history list is `UNRESOLVED`.
- **Comparison:** Users must be able to compare the selected month with at least one previous month. The exact comparison UI, metrics, and number of selected months are `UNRESOLVED`.
- **Permanence:** Monthly summaries and historical results must remain available offline and must not be deleted by rollover, archiving a container, or renaming a container. They may be removed only through the explicit whole-local-data deletion flow, with clear confirmation.

## 4. UX and Visual Requirements

- **Aesthetic:** Modern fintech, friendly to students, calm and trustworthy. Do not imitate the official GCash app or copy its branding, layout, or assets.
- **Currency:** Clear Philippine peso formatting. Use the `₱` symbol and appropriate grouping. Financial values must be derived from integer minor units and formatted at the presentation boundary.
- **Hierarchy:** The most important balances and actions must be immediately scannable. Avoid decorative clutter that competes with financial information.
- **Accessibility:** Accessible contrast, readable type sizes, touch targets, labels, focus behavior, and screen-reader semantics. Do not rely on color alone to communicate status.
- **Theme:** Consistent design tokens for color, typography, spacing, radii, elevation, and motion. Support light and dark modes, with a system-following default unless later decided.
- **Responsiveness:** Layouts must adapt to common Android phone sizes, safe areas, keyboard insets, and long text. Tablet-specific layouts are `UNRESOLVED`.
- **Motion:** Smooth, restrained animations that clarify state changes. Respect reduced-motion preferences where supported.
- **Components:** Reusable balance cards, budget cards, transaction rows, progress indicators, chat bubbles, month selectors, historical-period banners, container editors, archive controls, and destructive-action dialogs.
- **Monthly context:** The active month and its date range must be visible wherever budget usage is shown. Historical screens must clearly indicate that the user is viewing a past period.
- **Balance versus plan:** Actual balances must be visually and textually distinct from monthly budget limits, budget spending, and net savings. Do not present them as interchangeable numbers.
- **Container management:** Provide an accessible flow to create, rename, re-icon, recolor, archive, reactivate, and safely delete containers. Destructive outcomes and historical consequences must be explained before confirmation.
- **Archived visibility:** Archived containers and their remaining balances must remain discoverable in a labeled archived section.
- **Monthly history:** Provide a month selector, per-month results, comparison affordance, and clear separation between net savings and savings-container contributions/balances.
- **States:** Every data-driven screen must define loading, empty, error, and populated states, including empty months, months without limits, and containers with no history.
- **Mock data:** Mock data may be used in the UI-foundation phase, but it must be isolated behind repository/selector boundaries so it can be replaced by SQLite-backed data without rewriting screens. Mock months and mock container lifecycles must be clearly identified.

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
- **Application/domain:** Deterministic use cases such as recording income, recording expense, transferring funds, changing monthly budget limits, reversing transactions, correcting effective dates, archiving/reactivating containers, and validating drafts.
- **Period/reporting service:** A deterministic calendar service that computes month keys, inclusive start/end dates, leap-year behavior, active local month, and selected historical periods. It must accept an injectable clock/time-zone input for tests rather than reading the device clock throughout the domain.
- **Reporting service:** Read-only projections for monthly income, expenses, net savings, budget performance, savings-container contributions, ending balances, and month comparison. Reports must derive from postings/transactions and must not let the AI author authoritative totals.
- **Container lifecycle service:** Deterministic rules for container metadata changes, archiving, reactivation, safe deletion, and effective-dated historical labels.
- **Data:** Repositories, migrations, SQLite access, period/limit queries, historical metadata, and mapping between database rows and domain models.
- **AI:** Prompt construction, local model lifecycle, output parsing, schema validation, and draft creation. The AI layer cannot write financial records.
- **Platform:** Native modules, model files, file-system access, device clock/time-zone observation, and capabilities behind adapters.

A screen or chatbot must call a validated use case, not write directly to tables or mutate balances. Screens must not implement their own month-boundary or rollover logic.

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
- Monthly budget limits are planning data, not balances and not postings.
- The effective local calendar date must be stored explicitly on each transaction for period reporting.
- Reported monthly periods are determined from effective dates, never from the time an entry was keyed in.
- Historical financial records are voided or reversed, not deleted.
- Renames, color/icon changes, archiving, and safe deletion must not cascade-delete or rewrite financial history.
- Historical container display metadata must be reconstructable for reporting, either through effective-dated metadata history or immutable snapshots on the relevant records.
- Monthly summaries may be derived or materialized. If materialized, they must remain reproducible from the ledger and must retain change history across corrections.
- One currency (PHP) is used for MVP unless multi-currency is later approved.

### 6.2 Proposed tables

The following is the Phase 1 conceptual schema. Exact SQL columns, indexes, constraints, and migration sequencing require approval in the data-layer phase.

| Table | Purpose | Important design notes |
|---|---|---|
| `wallets` | Where money is held: cash, virtual GCash, etc. | Manually maintained; no real GCash connection. Needs name, kind, currency, active/archived state, timestamps. |
| `containers` | User-defined budget and savings containers. | Immutable ID plus current name, icon, color, sort order, kind, optional recurring monthly limit, active/archived/deleted state, and timestamps. Must not be hardcoded in UI. |
| `container_metadata_history` | Effective-dated history of user-visible container metadata. | Preserves names, icons, and colors across renames so historical reports retain their original meaning. Table/event design is `UNRESOLVED`. |
| `container_lifecycle_events` | Audit history for archive, reactivate, and safe-delete actions. | Must not delete financial records. Exact schema is `UNRESOLVED`. |
| `budget_periods` | Calendar-month reporting periods. | Needs a unique month key such as `YYYY-MM`, inclusive start/end dates, and the local-calendar basis. Whether periods are materialized for every month or derived is `UNRESOLVED`. |
| `allocations` | Monthly budget limits assigned to containers for a period. | Planning data only. Must never affect wallet or container balances. At most one limit per container/period unless a later policy says otherwise. |
| `transactions` | Groups a financial event and its postings. | Needs kind, status, effective local date, recorded UTC timestamp, recorded time zone/offset, description, idempotency key, reversal/correction links, and audit timestamps. |
| `postings` | Signed ledger entries referencing a wallet and/or container. | Single source of truth for balances. Amounts are integer centavos. Historical container references must survive archiving and safe deletion. |
| `monthly_summaries` | Preserved monthly results and comparison inputs. | Required fields include period, income, expenses, net savings, total limits, total spending, over/under amount, and generation metadata. Derived-or-stored policy is `UNRESOLVED`; summaries must never replace the ledger. |
| `monthly_container_results` | Per-container monthly budget performance. | Stores or derives monthly limit, spending, remaining/over amount, and historical container display label. Exact schema is `UNRESOLVED`. |
| `month_rollover_runs` | Records of completed monthly rollover sweeps. | `month_key` primary key; includes sweep transaction IDs and revision number for idempotency and late-correction replay. |
| `ai_drafts` | Audit record of chatbot-proposed actions. | Stores input, proposed structured payload, validation state, model/runtime metadata, effective date, and confirmation status. |
| `app_meta` | Schema version, local settings, and model metadata. | Must not contain GCash credentials or other secrets. |

### 6.3 Relationship and integrity rules

- A posting must reference at least one of a wallet or a container.
- Wallet-only postings are valid only for wallet transfers and wallet adjustments.
- Container-only postings are valid only for actual container funding/transfers and savings contributions.
- Income and expenses require matched wallet and container postings.
- Every transaction must have an effective local date, an idempotency key or equivalent duplicate-prevention mechanism, and audit timestamps.
- Exactly one system Savings container exists with stable `id = 'system-savings'` and `system_key = 'savings'`; user containers cannot reuse either identity.
- Archived records remain available for historical reporting.
- A container’s identity must not change when it is renamed, recolored, re-iconed, archived, or reactivated.
- Referential relationships from transactions, postings, limits, and summaries to containers must not cascade-delete financial history.
- Monthly budget limits must be unique per container and period under the approved policy and must be non-negative integer centavos.
- A period’s computed start/end dates must match its month key and local-calendar rules.
- The final uniqueness, nullability, deletion, and check constraints are `UNRESOLVED` pending schema design.

### 6.4 Historical period and container requirements

- A previously reported month must remain queryable even after many later months exist.
- A late transaction must be assignable to its correct historical month through its effective date.
- A corrected transaction must update the appropriate historical month through an audited reversal/replacement flow, not by deleting the original record.
- A renamed container must not make old transactions appear to have belonged to a different container category retroactively. Historical display must use effective-dated metadata or a preserved snapshot.
- An archived container must remain present in reports for periods where it had activity, a limit, or a balance.
- A safe container deletion must never remove rows required to reconstruct prior reports.
- Monthly summaries must be reproducible from preserved ledger data. If they are materialized for performance, corrections must update them through an auditable process.
- Migration v4 implements the current container, rollover-run, period, limit, and metadata-history schema. Materialized monthly summaries remain unimplemented; summaries are currently derived from the ledger.

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
- Planned monthly budget limits are not balances.
- **Monthly budget spending** is the sum of external expense postings assigned to a container whose effective date falls inside the selected period.
- **Monthly net savings** is external income minus external expenses for the selected period. It is a flow metric, not a balance.
- A container’s **ending balance** for a period is its posting-derived balance at the period end. It must not be presented as that month’s net savings.
- Actual balances carry across month boundaries unchanged unless a valid transaction, including an approved rollover sweep, changes them.

### 7.2 Posting rules

| Event | Wallet postings | Container postings | Effect |
|---|---|---|---|
| External income | Positive on destination wallet | Positive on destination container | Increases recorded funds on both axes |
| Expense | Negative on source wallet | Negative on source container | Decreases recorded funds on both axes |
| Actual container funding / container-to-container transfer | None | Positive on destination container, negative on source container | Sums to zero; no income or expense |
| Unallocated allocation / return | None | Positive on destination container, negative on source container | Internal allocation transfer; sums to zero; no income, expense, or savings contribution |
| Wallet transfer | Positive on destination wallet, negative on source wallet | None | Sums to zero; no income or expense |
| Savings contribution | None | Positive on Savings, negative on source container | Sums to zero; not an expense |
| Savings withdrawal | None | Negative on Savings, positive on destination container | Sums to zero; not income or an expense |
| Rollover sweep | None | Negative on ordinary container, positive on Unallocated | Sums to zero; not income or an expense |
| Adjustment | Paired wallet and container postings | Paired wallet and container postings | Corrects records while preserving the ledger invariant |

A monthly budget limit change creates **no postings**. It changes only the planning limit for the affected period and must never move money between containers or wallets.

In the Unallocated model, **allocation** means an actual internal transfer between Unallocated and a user container. It creates container postings, not wallet postings, and is not a monthly budget limit. Monthly budget limits remain planning data and never move funds. Implementation and UI copy must keep these meanings distinct.

### 7.3 Explicit exclusions

- Transfers between containers must not create income or expenses.
- Wallet transfers must not create income or expenses.
- Savings contributions and withdrawals must not be recorded as expenses or income.
- Actual container funding and rollover sweeps must not create income or expenses.
- Planned monthly budget limits must not reduce actual balances and must not be treated as spending.
- Creating, renaming, recoloring, archiving, reactivating, or safely deleting a container must not create income, expenses, or money.
- A Savings ending balance must not be labeled as monthly net savings or monthly contributions.
- Do not count both the wallet balance and the container balance as separate spendable totals.
- Do not auto-sweep unused budget limits or container balances at month rollover.
- The AI model must never directly modify a balance or write a transaction.

### 7.4 Reversal and correction

- Posted transactions are voided/reversed rather than deleted.
- A reversal creates the opposite financial effect and preserves an audit link to the original transaction.
- The original transaction must not remain silently counted after a successful reversal.
- A correction to a prior-period transaction must update the historical month it belongs to. By default, the reversal carries the original transaction’s effective date; the replacement carries the corrected effective date.
- If a correction moves a transaction to another month, the original is reversed in the original period and the replacement is recorded in the destination period, with both events auditable.
- The recorded timestamp of a correction is retained for audit, but it must not be used as the reporting period when the effective date belongs to another month.
- Historical corrections must not be performed by silently editing or deleting committed rows.
- The exact reversal schema, correction workflow, and user-facing undo window are `UNRESOLVED`.

### 7.5 Validation and write order

1. Validate required fields, amount, references, intent, effective date, and period key.
2. Validate that references point to valid, non-deleted records and that archived or inactive containers are not used for new activity unless policy allows it.
3. Validate that the resulting postings preserve the accounting invariant.
4. Enforce balance/overdraft and container-funding policies.
5. Validate that a monthly budget limit is non-negative and does not conflict with the period/container uniqueness policy.
6. Begin a database transaction.
7. Insert or reverse the transaction and postings atomically.
8. Update or invalidate any affected materialized monthly summary within the same consistent operation.
9. Commit only if all constraints pass.
10. Return a receipt derived from committed records.

Negative wallet and container balances are blocked in the current model. Overdrafts and any future change to this policy require explicit approval.

### 7.6 Month rollover accounting

- The active calendar month is derived from the current local clock. It is not a mutable “current period” flag that a user must advance.
- When a calendar month closes, remaining positive balances in ordinary budget containers are transferred to Unallocated. This is an internal container transfer with no wallet postings.
- Savings and Unallocated are never swept. Archived ordinary containers with remaining funds are swept.
- Rollover creates no income, expense, allowance, or wallet balance change. It does not erase money. It only reallocates container balances.
- At the start of a month, budget usage is fresh because reports filter by the new period; prior-month summaries remain unchanged.
- A container’s optional monthly limit for the new month is planning data. It creates no posting and does not reserve funds.
- If the app was closed through one or more month boundaries, reopening must process every pending closed month in order and retain all historical periods.
- The first processed closed month establishes the rollover baseline. Months before that baseline are not retrospectively swept; this avoids inventing rollover history for periods that were never processed.
- A month with no transactions must still be representable in history and comparisons.
- Late entries and corrections may target a prior month while actual balances update immediately. If they affect an ordinary container balance in a closed month, rollover sweeps from that month through the latest processed month are reversed and recomputed in the same transaction.
- A late correction is rejected atomically if the replay would make any wallet or container balance negative, including at intermediate dates. This prevents reclaiming rollover funds that were already spent while preserving the non-negative balance rule.
- Rollover writes are recorded in `month_rollover_runs` with a revision number and sweep transaction IDs. Processing is atomic and idempotent; repeated initialization, restarts, or clock changes must not duplicate a sweep.
- Unused budget limits never become funds. Actual unused ordinary-container balances move to Unallocated; Savings balances remain in Savings.
- Non-calendar cycles and automatic limit carry-forward are not established and are `UNRESOLVED`.

### 7.7 Net savings and savings-container rules

- **Net savings** for a month = external income for that month minus external expenses for that month.
- External income increases recorded funds and is counted once, even when deposited directly into a savings container.
- External expenses decrease recorded funds and are counted once.
- Wallet transfers, container transfers, actual container funding, rollover sweeps, and Savings contributions never change net savings.
- A Savings ending balance is a stock measure. It must be displayed separately from net savings and from monthly contributions/withdrawals.
- Savings contributions and withdrawals are transfers, not expenses or negative income.
- The monthly history screen must show enough labels and explanatory text to prevent users from adding net savings and Savings contributions together as if they were independent money.
- Budget-performance spending excludes Savings contributions.
- Current available budget includes Unallocated and active ordinary budget-container balances. It excludes Savings, archived balances, and monthly limits.

### 7.8 Container lifecycle accounting

- Renaming, recoloring, re-iconing, reordering, archiving, and reactivating a container are metadata/lifecycle changes. They create no postings and no income or expense.
- Archiving a container does not move its balance, alter its postings, or change historical results.
- An archived container with a remaining balance remains part of total recorded funds and must remain visible in a labeled archived view.
- Reactivation affects current/future planning only. It must not backfill budget limits into months when the container was archived.
- Safe deletion is blocked while a container has a balance or historical financial references.
- The safe resolution for such a container is to transfer any remaining funds through a normal container transfer if the user chooses, then archive the container.
- A safe delete must never cascade-delete transactions, postings, budget limits, or monthly summary data required for audit.
- Deleting an unused container with no balance, history, or references may be allowed after explicit confirmation; the exact hard-delete versus tombstone policy is `UNRESOLVED`.
- Historical reports must preserve the container’s identity and effective display metadata even after renaming or archiving.
- A container transfer remains balanced at all times and must not alter the invariant `sum(wallet balances) == sum(container balances)`.

### 7.9 System Unallocated account

- Exactly one system-managed Unallocated account exists. It represents recorded funds that have not yet been assigned to a user container.
- Its identity is stable and app-owned. It is created idempotently during database initialization or before the first operation that needs it. Reopening the database must not create duplicates.
- External income with no selected user container posts to Unallocated by default. Income may also be assigned directly to a user container.
- Moving money between Unallocated and a user container is an internal allocation transfer with container-only postings. Allocations from Unallocated target user-owned budget containers; returns may come from any user-owned container. These transfers must not change wallet balances, income, expenses, savings contributions, or net savings.
- Expenses cannot be posted directly from Unallocated. Funds must first be allocated to a user container.
- Unallocated cannot be renamed, recolored, re-iconed, archived, reactivated, limited, or deleted by user workflows. Database guards enforce the same restrictions.
- Unallocated is excluded from ordinary container-management lists but remains visible in balances, snapshots, and reports that explain the full allocation of recorded funds.
- Unallocated participates in the global invariant and historical reporting. Its balance must never be silently swept, reset, or moved at month rollover.
- Its stable internal identifier must not become the normal way UI code or users identify an allocation target. Allocation operations accept user-container IDs.

### 7.10 System Savings container

- Exactly one system-managed Savings container exists with `id = 'system-savings'` and `system_key = 'savings'`. Both are immutable.
- The Savings container is created idempotently alongside Unallocated during database initialization.
- Its `kind` is `'savings'` and its `status` is always `'active'`. Database triggers prevent archiving, deletion, budget limits, and metadata changes. No other container may use its ID or system key.
- Savings accumulates across months. Monthly rollover never sweeps funds out of Savings.
- Users contribute to Savings (from any active ordinary budget container or from Unallocated) through a `savings`-kind `container_transfer` with no wallet postings.
- Users withdraw from Savings (to any active ordinary budget container or to Unallocated) through a `savings`-kind `container_transfer` with no wallet postings.
- Expenses cannot be posted directly from Savings. Funds must first be transferred to an ordinary active container.
- Savings has no target amount, progress percentage, goal-completion state, or separate long-term goal workflow.
- Savings transfers must not affect net savings, income, or expense totals.
- Savings participates in the global invariant: `sum(wallet balances) == sum(container balances)` holds including Savings balances.
- Monthly reporting must provide: `savingsContributionsMinor` (in-transfers that month), `savingsWithdrawalsMinor` (out-transfers that month), and `systemSavingsEndingBalanceMinor` (cumulative balance at end of period).

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
5. Deterministic application logic validates the proposed intent, references, amounts, effective date, historical period, container status, and accounting effects.
6. The app displays a confirmation UI showing the exact proposed transaction, effective date, affected historical month, and relevant resulting balances.
7. If the user cancels, nothing is written.
8. If the user explicitly confirms, a deterministic use case writes the transaction atomically.
9. The app shows a receipt and offers reversal according to the approved policy.

Confirmation is mandatory. A model response, model confidence, or chat message is never authorization to write.

### 8.3 Trust boundaries

- Model output is untrusted input.
- The model may interpret language and propose fields, but cannot compute authoritative totals, mutate balances, or call database writes.
- The model must not receive GCash credentials or unnecessary sensitive data.
- The model must not receive authority to alter container lifecycle state or monthly budget limits.
- Prompt injection in user text must not bypass confirmation or validation.
- Unsupported or ambiguous requests must lead to clarification or refusal, not guessed financial writes.
- The model must not silently invent an effective date, historical month, archived container, or deleted container reference; deterministic code and user confirmation must resolve those choices.
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
- Month rollover, historical month selection, monthly summaries, and month comparison must work entirely offline from local data.
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

The following testing strategy is established. Phase 3 tests are implemented and passing, and Phase 4 adds service-level integration tests (78 tests as of the Phase 4 update). React Native UI/accessibility and device end-to-end tests are still required but not implemented; no UI test framework is installed.

### 11.1 Unit tests

- Money parsing and Philippine peso formatting using integer centavos.
- Every posting rule and transaction type.
- Accounting invariant: sum of wallet balances equals sum of container balances.
- Monthly budget-limit behavior: limits never affect balances and are not spending.
- Container funding and savings behavior: no income/expense created by transfers.
- Net savings equals external income minus external expenses and excludes all transfers.
- Savings-container contributions and ending balances do not double-count income, expenses, or net savings.
- Idempotency and duplicate-commit prevention.
- Reversal behavior and historical integrity.
- Effective-date assignment, late entries, prior-period corrections, and time-zone changes.
- Calendar-month boundaries for 28-, 29-, 30-, and 31-day months.
- Year transitions, including December to January, and leap-year February.
- Automatic month rollover based on an injected clock, sweeping ordinary-container balances to Unallocated without changing wallets or creating income/expense, with no user reset action.
- AI draft schema validation and rejection of malformed output.
- Domain validation that blocks AI-originated invalid writes, archived references, and invalid effective dates.

### 11.2 Integration and database tests

- Migrations from a fresh database and from prior versions.
- Foreign-key and check-constraint enforcement.
- Atomic rollback on failed writes.
- Repository mapping and query correctness.
- Concurrent or repeated submission behavior.
- Monthly summary queries for income, expenses, net savings, limits, spending, and remaining/over amounts.
- Historical reports after late entries and audited corrections.
- Container rename, archive, reactivate, and safe-delete flows preserving references.
- Effective-dated container metadata reconstruction in historical reports.
- Migration of existing data into monthly periods, limits, and lifecycle metadata without loss.
- No cascade deletion of financial history.
- Monthly summaries remain reproducible from the ledger after corrections.
- Backup/import only if implemented.

### 11.3 UI and end-to-end tests

- Navigation between dashboard, containers, wallet, assistant, history, monthly savings history, container management, and profile.
- Light/dark themes and system theme changes.
- Loading, empty, error, and populated states, including empty months.
- Active-month display, automatic rollover, historical month selection, and month comparison.
- Confirmation and cancellation paths for chatbot drafts.
- Container creation, customization, rename, archive, reactivate, and blocked/safe delete flows.
- Archived balances remain visible and are not mistaken for active spending funds.
- Accessibility labels, contrast, touch targets, color-independent status, and screen-reader behavior.
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

### 11.5 Required monthly-cycle and container regression cases

At minimum, later implementation must include automated tests for:

- January 31 to February 1 and February 28/29 to March 1.
- 28-, 29-, 30-, and 31-day months.
- December 31 to January 1 year transition.
- Active month computation when the app was last opened in a prior month or year.
- Device time-zone changes before and after recording a transaction.
- Late entries into each prior month and their effect on historical reports.
- Corrections that reverse a prior-period transaction and apply a replacement.
- Duplicate submissions, retries, and repeated confirmation taps.
- Rollover sweep of ordinary and archived container balances into Unallocated, with wallet balances and prior summaries unchanged.
- Exclusion of Savings and Unallocated from rollover, including across multiple missed months and repeated initialization.
- Late closed-month entries and corrections that reverse and replay rollover without duplicating money.
- Fresh monthly limits create no automatic income or fund movement beyond the approved closed-month sweep.
- Net savings excluding wallet transfers, container transfers, funding, and savings contributions.
- Income deposited directly into a savings container counted exactly once.
- Savings-container contributions not counted as expenses or additional savings.
- Container rename while retaining the original historical label.
- Archive with a remaining balance, reactivation, and future-only budget limits.
- Blocked delete with balance/history and the safe transfer-plus-archive path.
- Delete of an unused container and preservation of all unaffected history.
- Archived containers still appearing in prior-period reports.
- Container transfers preserving both the accounting invariant and net-savings totals.

### 11.6 Verification rules

- Run the repository’s actual lint, typecheck, and test commands when they exist.
- Report the exact commands and actual results.
- Do not claim that a feature works because code was written; verify it.
- Do not claim device performance without measurement on the relevant hardware.
- UI mock screens must be identified as mock-backed until connected to repositories.
- Documentation alone does not prove that a monthly cycle, history screen, or container lifecycle feature works.

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
- Build the dashboard, containers, wallet, AI chatbot, history, monthly savings history, container management, and profile screens.
- Show the active month, historical month selection, and month comparison using mock data.
- Show container customization, archive/reactivate, and safe-delete flows using mock data.
- Use realistic mock data behind replaceable boundaries, clearly labeled as mock-backed.
- Responsive Android-oriented layouts and restrained motion.
- No LLM integration, cloud backend, database persistence, or production financial logic.
- Status: not started or accepted. An uncommitted exploratory UI scaffold exists but is not approved Phase 2 completion.

### Phase 3 — SQLite data layer and deterministic financial engine

- Implement schema, migrations, repositories, query boundaries, and the deterministic engine.
- Implement transactions, postings, budget limits, container funding, transfers, permanent Savings, automatic calendar rollover, reversals, effective-date corrections, idempotency, container lifecycle, and invariant validation.
- Add calendar-period, budget-limit, container-metadata-history, rollover-run, and reporting storage.
- Add database integration and migration tests, including preservation of historical data.
- Status: implemented and awaiting final review. Screens remain mock-backed.

### Phase 4 — UI integration

- Move the approved screens from mock data to SQLite-backed repositories and use cases.
- Wire active-month display, historical month selection, monthly savings history, container management, Savings transfers, and reporting to the deterministic engine.
- Present monthly net savings separately from Savings contributions, withdrawals, and ending balance, and present Unallocated carryover as carried money rather than income.
- Add UI, accessibility, and end-to-end tests for the integrated flows.
- Do not add AI, cloud sync, GCash integration, automatic allowance deposits, or separate long-term savings goals/targets.
- Status: implemented and awaiting review. Budget screens are SQLite-backed; Profile and assistant remain sample-backed. Service-level tests pass, but UI/accessibility and device end-to-end tests are not yet implemented.

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
- **ASSUMPTION:** Calendar months are the default and established MVP budget period.
- **ASSUMPTION:** The active month is derived from the device’s current local date; historical transactions retain their recorded effective local date.
- **ASSUMPTION:** Monthly budget limits are planning values and are distinct from actual container balances and actual funding transfers.
- **ASSUMPTION:** Budget containers are user-created records rather than fixed categories.
- **ASSUMPTION:** Historical monthly results must remain available offline unless the user explicitly deletes all local data.
- **ASSUMPTION:** Expo SDK 57 is the preferred starting point, subject to approval and compatibility verification.
- **ASSUMPTION:** Light and dark themes are required; the default may follow the system.
- **ASSUMPTION:** English is the initial interface language; Taglish/localization is not finalized.

## 14. Unresolved Decisions

The following remain open unless explicitly marked resolved. Resolved items record approved decisions and must be treated as settled:

1. **Master specification:** The original document has not been provided; this file is a reconstruction.
2. **App name:** Pocketa versus Pocketalk-App.
3. **Target device baseline:** Android versions, minimum RAM, and representative physical test devices.
4. **Expo version:** SDK 57 versus SDK 58 or another version.
5. **Navigation structure:** Exact tab/stack arrangement for the dashboard, containers, wallet, assistant, history, monthly savings history, container management, and profile screens.
6. **MVP feature cut:** Which features are required for the first release versus later phases.
7. **AI in MVP:** Whether the chatbot ships in the MVP or after the core budgeting release.
8. **AI model/runtime:** Qwen3-4B versus Qwen3-1.7B; llama.rn versus LiteRT-LM versus another runtime; quantization; context length; model distribution.
9. **AI performance gates:** Final latency, memory, accuracy, and thermal thresholds.
10. **Database access layer:** Drizzle versus raw SQL or a hybrid.
11. **Exact schema:** Columns, indexes, constraints, migration sequence, and audit fields.
12. **Budget period model:** Calendar months are established for the MVP. Non-calendar weekly/semi-monthly/custom periods, unused-limit carry-forward, and completed-month locking remain `UNRESOLVED`.
13. **Container scope (resolved):** Containers are global allocations of recorded funds. Per-wallet container allocation is not supported in the current model.
14. **Overdraft policy (resolved):** Negative wallet and container balances are blocked. Any change requires explicit approval.
15. **Allocation policy (resolved):** Monthly limits are planning values and may be set independently. Actual allocation cannot exceed available funds. Unallocated income must be allocated to a user container before it can be spent.
16. **Savings policy (resolved):** Exactly one permanent system Savings container. Users may contribute from Unallocated or ordinary budget containers and withdraw to Unallocated or active ordinary containers. Savings is excluded from rollover and cannot be renamed, archived, limited, deleted, or spent from directly. Separate long-term savings goals and targets are not in scope.
17. **Reversal policy:** Undo window, audit presentation, and whether reversal requires a reason.
18. **Encryption and authentication:** Whether to use SQLCipher, biometric/device authentication, or neither in the MVP.
19. **Backup/export:** Format, encryption, destination, import validation, and retention.
20. **Localization:** English-only versus English/Taglish/Filipino.
21. **State management:** `useLiveQuery`, Zustand, React Context, or a combination.
22. **Testing tools and CI:** Unit, component, end-to-end, and device-test frameworks.
23. **Charts and additional reports:** Whether charts or report types beyond the required monthly history/comparison belong in the MVP.
24. **Wallet management:** Whether users can create/archive wallets in the MVP.
25. **Data retention and privacy policy:** Required before public release.
26. **Monthly summaries:** Derived on demand versus materialized, their retention/versioning policy, and how correction history is exposed.
27. **Effective-date storage:** Exact date/time-zone representation, daylight-saving/time-zone transition handling, and how a device time-zone change is communicated. The established rule remains that the active month follows the device’s local date while historical effective dates stay fixed.
28. **Historical container metadata:** Snapshot-on-transaction versus effective-dated metadata history, and whether old reports show only the historical name or also the current name.
29. **Container deletion:** Hard delete versus tombstone, retention period, and whether deletion is ever offered after history exists.
30. **Container identity rules:** Name uniqueness, reserved names, sorting, icon/color sets, and validation limits.
31. **Monthly limits:** Recurring default versus per-month overrides, mid-month changes, limits for newly created or reactivated containers, and whether limits can be zero.
32. **Archived containers (resolved):** New income, expenses, and transfers involving archived containers are blocked. Archived balances remain part of recorded totals and remain visible in labeled archived/reporting views.
33. **Month comparison:** Which months, metrics, and visual/layout model are used.
34. **Monthly history empty states:** Whether months without activity appear in the history list and how they are presented.
35. **Whole-data deletion:** Exact warning, confirmation, export-before-delete, and irreversibility behavior for explicit local-data deletion.

## 15. Definition of Done for Any Phase

A phase is complete only when:

- The approved scope is implemented.
- Existing working code is preserved.
- Relevant lint, typecheck, and tests pass, with actual results reported.
- New financial logic has deterministic validation and tests.
- Monthly rollover is derived correctly, preserves all balances and history, and passes boundary/leap-year tests.
- Container create/rename/archive/reactivate/delete flows preserve audit records and never erase balances or historical meaning.
- Net savings excludes all transfers and is never confused with savings-container balances.
- AI-originated writes require explicit confirmation and never bypass domain rules or historical-period validation.
- Offline behavior is not regressed.
- Mock implementations are clearly identified and are not described as implemented features.
- Documentation reflects actual behavior and remaining gaps.
- The user has reviewed and approved the phase before work proceeds to the next phase.
