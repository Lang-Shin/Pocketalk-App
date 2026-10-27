# Agent Instructions for Pocketa

These instructions apply to every future development session in this repository. They are persistent project instructions and take precedence over general habits or assumptions.

## 1. Start Every Session by Inspecting

Before changing anything:

1. Read `PROJECT_SPEC.md` in full.
2. Read this `AGENTS.md` and `README.md`.
3. Inspect the repository structure and the files relevant to the task.
4. Check `git status` and preserve uncommitted work.
5. Check existing scripts, conventions, package versions, and tests before adding new patterns or dependencies.
6. Identify the currently approved phase and confirm that the task belongs to it.

Do not assume the repository is empty or that files described in planning documents already exist.

## 2. Implement Only the Approved Phase

- Implement only the scope the user has explicitly approved for the current phase.
- Do not start the next phase, or add “helpful” future-phase features, without explicit approval.
- Stop after completing the approved phase and wait for the user’s review.
- If a request spans multiple phases, complete only the approved portion and ask before continuing.
- If the task conflicts with `PROJECT_SPEC.md`, stop and ask rather than silently changing requirements.
- Mark incomplete or deferred work clearly instead of pretending it is finished.

Current status when these instructions were updated:

- Phase 1 was research and planning only.
- Phase 2 (UI foundation) has **not** been approved or completed.
- An uncommitted, exploratory Expo UI scaffold exists in the working tree from earlier work. It is not accepted as Phase 2 and must not be treated as feature-complete or as approval to continue.
- Phase 3 (SQLite data layer and deterministic financial engine) is implemented and awaiting final review: migrations v1-v4, the finance engine, system Unallocated and Savings containers, automatic monthly rollover, reversals/corrections, and 69 passing SQLite-backed tests. The screens remain mock-backed.
- Phase 4 (UI integration) has not been started. There is no LLM integration, cloud sync, or GCash integration.

## 3. Preserve Existing Work

- Make small, incremental changes.
- Read a file before editing it.
- Preserve working code and existing user changes.
- Do not delete, rewrite, or reformat unrelated code.
- Do not perform broad refactors without explicit approval.
- Prefer editing existing files over creating parallel implementations.
- Never discard data migrations or financial history unnecessarily.

## 4. Verify APIs and Dependencies

- Verify unfamiliar APIs, package names, versions, and platform behavior using reliable primary documentation.
- Do not rely on memory for native modules, Expo SDK compatibility, Android permissions, or database behavior.
- Prefer official documentation for Expo, React Native, SQLite, and any LLM runtime.
- Use the project’s package manager consistently and keep the lockfile in sync.
- Avoid adding dependencies when the platform or existing stack already provides the capability.
- Check licenses and Android compatibility before adding native dependencies.
- Do not claim a library supports a model or feature without evidence.

## 5. Type Safety and Architecture

- Use TypeScript in strict mode.
- Avoid `any`; if unavoidable, isolate it and explain why.
- Model domain concepts with explicit types and validated boundaries.
- Keep dependencies flowing in the approved direction:
  - Screens/components -> application/domain use cases -> repositories -> database/native adapters.
  - UI must not issue ad hoc SQL or call native LLM APIs directly.
  - The AI layer must not write financial records.
- Keep mock data behind repository, selector, or provider boundaries so it can be replaced by SQLite-backed data without rewriting screens.
- Keep calendar-period, rollover, effective-date, reporting, and container-lifecycle logic in deterministic domain services. Screens must not compute their own month boundaries or rollover rules.
- Inject a clock and time-zone source into period logic so month-boundary behavior is testable.
- Handle loading, empty, error, and populated states explicitly.
- Use appropriate error handling and never swallow failures silently.

## 6. Financial Correctness Is Mandatory

- All money is stored and calculated as signed integers in PHP centavos. Never use floating-point arithmetic for money.
- Postings are the source of truth for balances.
- Maintain the invariant: sum of wallet balances equals sum of container balances.
- Use the approved posting rules from `PROJECT_SPEC.md`.
- Transfers between containers must not create income or expenses.
- Wallet transfers must not create income or expenses.
- Savings contributions are transfers, not expenses.
- Monthly budget limits and planned allocations are not balances and must not affect spendable funds or create postings.
- Do not add separate long-term savings goals, target amounts, or goal-progress tracking. Use the single permanent system Savings container.
- Actual container funding is a transfer, not a monthly budget limit, income, or expense.
- External income increases recorded funds; expenses decrease recorded funds.
- Void or reverse transactions rather than deleting financial history.
- Prevent duplicate writes with idempotency handling.
- Make financial writes atomic inside a database transaction.
- Validate all inputs and the resulting postings before committing.
- If a financial rule is unclear, stop and ask. Do not invent accounting behavior.

### 6.1 Calendar months and historical reporting

- Use calendar months as the default budget period: the first through the last local calendar day, including correct February/leap-year behavior.
- Derive the active month from the device’s current local date. Do not require a manual “start month” or reset action.
- Recompute the active period on launch, foreground/resume, local date change, and time-zone change. If the app was closed across month or year boundaries, reopening must show the correct current month.
- The first processed closed month establishes the rollover baseline; earlier months are not retrospectively swept.
- At each closed calendar month, sweep positive ordinary-container balances into Unallocated through an atomic, idempotent internal container transfer. Exclude Savings and Unallocated; include archived ordinary containers. Never change wallet balances or create income/expense. A new month creates no allowance.
- Late entries or corrections that change a closed month's ordinary-container balances must reverse and replay affected rollover sweeps in the same transaction under a new revision. Reject the correction atomically if replay would make any balance negative at any affected date.
- Reset only period-scoped budget usage and plan limits. Unused budget limits are not money; actual unused ordinary-container balances are swept, while Savings is never swept.
- Store each transaction’s effective local date explicitly, with recorded time zone/offset and audit timestamp. Never recompute historical months from a UTC timestamp after the fact.
- Report monthly income, expenses, budget performance, and savings by effective date, not by the date the transaction was entered.
- Allow late entries and audited corrections to update the appropriate prior month. A correction must reverse the original in its original effective period and post any replacement in the correct destination period.
- Preserve all transactions, postings, monthly summaries, and prior-month results permanently unless the user explicitly deletes all local data.
- Net savings = external income minus external expenses for the selected period. Never include wallet transfers, container transfers, actual container funding, or savings contributions.
- Keep monthly net savings separate from savings-container contributions and ending balances. Never count the same money twice.
- Monthly history must support selecting previous months and comparing results offline.

### 6.2 Dynamic containers and historical meaning

- Containers are user data, not hardcoded categories. Support create, rename, icon/color customization, optional monthly budget limits, archive, reactivate, and safe deletion.
- Container identity is immutable through rename, archive, and reactivation.
- Renaming, recoloring, re-iconing, archiving, or reactivating a container must never rewrite past transactions or delete audit records.
- Preserve effective-dated container display metadata or an equivalent immutable historical label so past reports retain their original meaning.
- Archiving must preserve balances and history. Archived containers remain visible in a labeled area and in reports for periods where they had activity or a budget.
- Exclude archived containers from new active spending/planning unless an explicit approved policy allows it. Reactivation must not backfill limits into archived months.
- Deleting a container with a balance or any financial history must be blocked. Explain the consequences and require a safe resolution, such as transferring remaining funds through a normal transfer and archiving the container.
- Never cascade-delete transactions, postings, budget limits, or summaries when a container is deleted. Hard deletion is allowed only for unused containers with no balance or history, if approved.
- Container transfers must preserve the accounting invariant and must not inflate income, expenses, savings, or net savings.
- Monthly budget limits are optional, non-negative planning values. Changing a limit must never move money or alter actual balances.
- Do not auto-sweep, erase, or silently discard a remaining balance.

## 7. AI Safety Boundary

- The AI model must never directly modify balances, write transactions, or execute arbitrary database operations.
- The AI may only produce a structured proposal or a read-only response.
- All AI-originated financial changes must pass schema validation and deterministic domain validation.
- The user must explicitly confirm a chatbot-proposed financial transaction before it is saved.
- Chat messages, model confidence, or inferred intent are not authorization to write.
- Treat model output as untrusted input.
- Protect against prompt injection and malformed output; unsupported or ambiguous requests must lead to clarification or refusal.
- AI drafts must not invent effective dates or historical months, and must not target archived, deleted, or invalid containers. Deterministic logic and explicit user confirmation must resolve those fields.
- The AI must not perform container lifecycle changes or modify monthly budget limits.
- The model must not receive GCash credentials or unnecessary sensitive data.
- Do not integrate a cloud LLM as a requirement for core functionality.

## 8. Prohibited Financial Integration

- Do not integrate with GCash, banks, or payment providers in the current scope.
- Do not request, collect, store, log, or transmit GCash PINs, passwords, OTPs, or similar credentials.
- Do not imitate the official GCash app, its branding, or its visual identity.
- The virtual GCash wallet is manually maintained and must be presented as such.

## 9. Offline-First Requirement

- The core budgeting experience must remain usable without a network connection.
- SQLite is the local source of truth.
- Do not make core screens depend on a backend, cloud account, or cloud LLM.
- Month rollover, historical month selection, monthly summaries, and comparison must work offline.
- Model download/update may be optional, but failure must not block budgeting.
- Preserve existing data across schema migrations.
- Test offline behavior when the relevant feature exists.

## 10. UI and Accessibility Standards

For UI phases:

- Follow the modern, student-friendly fintech aesthetic in `PROJECT_SPEC.md`.
- Use Philippine peso formatting from integer minor units.
- Maintain consistent design tokens for color, typography, spacing, radii, elevation, and motion.
- Support light and dark themes and respect system settings where specified.
- Ensure accessible contrast, readable text, meaningful labels, adequate touch targets, and screen-reader semantics.
- Do not communicate status with color alone.
- Keep animations smooth and restrained; respect reduced-motion settings where supported.
- Make layouts responsive to Android phone sizes, safe areas, keyboard insets, and long text.
- Build reusable components instead of duplicating screen-specific implementations.
- Clearly identify screens backed by mock data.
- Show the active month clearly and distinguish actual balances from monthly limits, budget spending, Savings contributions/withdrawals, the Savings balance, carryover, available budget, and net savings.
- Provide accessible month selection, historical-period labeling, container customization, archive/reactivate, and safe-delete flows when those features are in the approved phase.
- Do not add production financial logic or LLM integration during a UI-foundation phase.

## 11. Testing and Verification

- Add tests for important logic, especially accounting, validation, idempotency, reversals, effective dates, monthly rollover, and AI draft handling.
- Test calendar-month boundaries, 28/29/30/31-day months, leap years, year transitions, historical reports, late entries, late corrections, time-zone changes, duplicate transactions, and rollover.
- Test that rollover sweeps only ordinary/archived container balances into Unallocated, excludes Savings and Unallocated, preserves wallet balances and prior summaries, and is idempotent across restarts and missed months.
- Test net savings excludes all internal transfers and savings contributions, and never double-counts savings-container money.
- Test container create, rename, recolor/re-icon, archive, reactivate, safe delete, historical metadata, and transfer invariants.
- Test database migrations and constraints when a database exists, including preservation of historical periods and label metadata.
- Test failure paths, not only happy paths.
- Run the repository’s actual lint, typecheck, and test commands after changes.
- If a command cannot be run, report why and what remains unverified.
- Report exact commands and actual results.
- Never claim tests, builds, benchmarks, or device checks passed unless they were actually run.
- Never claim on-device LLM performance without measurement on relevant hardware.
- Distinguish “implemented,” “mock-backed,” “unverified,” and “tested” in all reports.

## 12. Security and Privacy

- Never commit secrets, credentials, or sensitive personal data.
- Do not log sensitive financial information or raw model prompts by default.
- Validate and sanitize external and AI-generated data.
- Keep financial writes behind deterministic application logic.
- Treat backups and exports as sensitive.
- Review dependencies for security and licensing concerns.
- Do not claim encryption or authentication exists unless it is implemented and verified.

## 13. Documentation and Change Reporting

After each approved task, report:

- Files changed.
- Setup or migration commands.
- Checks run and their actual outcomes.
- Features that are implemented versus mock-backed or deferred.
- Known limitations and unresolved decisions.
- The recommended next step, without starting it.

Update `PROJECT_SPEC.md` only when requirements or approved architecture change. Do not silently weaken requirements to match the implementation.

## 14. Phase Gate

A phase is complete only when:

1. The approved scope is implemented.
2. Existing working code is preserved.
3. Relevant checks and tests have actually been run and reported.
4. Financial logic has deterministic validation and appropriate tests.
5. Monthly rollover, effective dates, net-savings reporting, and historical periods are verified against boundary/leap-year tests.
6. Container lifecycle changes preserve balances, ledger history, and effective-dated historical meaning.
7. AI cannot bypass user confirmation or domain rules.
8. Mock implementations are clearly identified.
9. Remaining gaps are documented.
10. The user has reviewed the result and approved the next phase.

Stop and wait for approval before beginning the next phase.

## 15. Missing Master Specification

The original master specification was unavailable when `PROJECT_SPEC.md` was reconstructed. If it becomes available:

- Compare it with `PROJECT_SPEC.md`.
- Report conflicts and gaps to the user.
- Do not silently remove or weaken existing requirements.
- Wait for direction before making major scope changes.
