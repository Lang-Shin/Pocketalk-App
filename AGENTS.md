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

Current status when these instructions were created:

- Phase 1 was research and planning only.
- Phase 2 (UI foundation) has **not** been approved to start and has **not** been implemented.
- No application code, database, LLM integration, or automated tests exist at this point.
- Only documentation files have been added.

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
- Planned allocations and goal targets are not balances and must not affect spendable funds.
- External income increases recorded funds; expenses decrease recorded funds.
- Void or reverse transactions rather than deleting financial history.
- Prevent duplicate writes with idempotency handling.
- Make financial writes atomic inside a database transaction.
- Validate all inputs and the resulting postings before committing.
- If a financial rule is unclear, stop and ask. Do not invent accounting behavior.

## 7. AI Safety Boundary

- The AI model must never directly modify balances, write transactions, or execute arbitrary database operations.
- The AI may only produce a structured proposal or a read-only response.
- All AI-originated financial changes must pass schema validation and deterministic domain validation.
- The user must explicitly confirm a chatbot-proposed financial transaction before it is saved.
- Chat messages, model confidence, or inferred intent are not authorization to write.
- Treat model output as untrusted input.
- Protect against prompt injection and malformed output; unsupported or ambiguous requests must lead to clarification or refusal.
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
- Do not add production financial logic or LLM integration during a UI-foundation phase.

## 11. Testing and Verification

- Add tests for important logic, especially accounting, validation, idempotency, reversals, and AI draft handling.
- Test database migrations and constraints when a database exists.
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
5. AI cannot bypass user confirmation or domain rules.
6. Mock implementations are clearly identified.
7. Remaining gaps are documented.
8. The user has reviewed the result and approved the next phase.

Stop and wait for approval before beginning the next phase.

## 15. Missing Master Specification

The original master specification was unavailable when `PROJECT_SPEC.md` was reconstructed. If it becomes available:

- Compare it with `PROJECT_SPEC.md`.
- Report conflicts and gaps to the user.
- Do not silently remove or weaken existing requirements.
- Wait for direction before making major scope changes.
