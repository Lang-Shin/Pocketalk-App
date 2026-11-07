# Semantic action evidence experiment

This isolated experiment examines synthetic responses; it does not execute transactions or activate an online provider. An accepted result means only that the experimental checks passed, not that a transaction is safe or authorized.

The module is not imported by production assistant selection. Its candidate data is not an `AssistantResult` and cannot itself pass assistant-result validation as a proposal. Before reporting experimental acceptance, the evaluator constructs a temporary validation-only result and checks it with the existing assistant validator, including current source balances and routing. This is not a ledger transaction or an execution authorization. It has no provider, network, database, finance execution, confirmation, or credential access. Any future integration must revalidate current state and require confirmation; the experimental outcome alone is insufficient.

Experimental acceptance additionally requires an injected trusted eligibility snapshot dated to the reference local date and wallet lifecycle statuses for referenced wallets. Missing, stale, malformed, or incomplete evidence requests clarification; an explicitly archived wallet is rejected. The production wallet type currently has no lifecycle status, so this synthetic status is an experimental input, not a claim that production supplies it. Balances are taken solely from local context, not candidate fields. A date marker alone cannot prove a same-day snapshot is fresh; a future integration would need authoritative revision-based freshness and execution-time validation.

Explicitly negated action statements are rejected; ambiguous occurrence, questions, hypotheses and unsupported evidence request clarification. Financial ineligibility and malformed fields are rejected; a well-formed unsupported action is marked unsupported. These outcomes describe the experiment and do not authorize transactions.

The response intent must match its action. Action evidence comes from explicit phrases listed in `ACTION_EVIDENCE` in `src/ai/online/semanticEvaluation.ts`, including expense, income, transfer and Savings terms. The bounded implicit examples include “set me back” for expense and “set aside” for a Savings contribution, which additionally requires a Savings mention. Unsupported action wording and detected negation or hypothetical wording require clarification. Income wording combined with transfer-like wording, including “padala”, requires clarification. Detected independent action categories or repeated action phrases are rejected rather than collapsed into one transaction. The offline baseline is recorded separately; an existing offline proposal is returned as unsupported by this experiment rather than replaced.

These rules are deliberately conservative and can reject harmless wording. Keyword matching alone cannot resolve intent, negation, quoted instructions, endpoint direction, all multi-action statements, or other semantic ambiguity. The experiment does not establish model accuracy, validate all financial eligibility, or replace deterministic validation and explicit confirmation. Further adversarial evaluation is required before considering integration.

The non-transaction screen requests clarification for bounded negation directly attached to an action, questions, hypothetical wording, cancellation instructions, and quoted text. Negation of an unrelated phrase alone does not trigger that screen. It intentionally errs on the side of clarification and is not a general-purpose negation or quotation parser.

## Amount evidence

The candidate amount is parsed using the existing peso parser and must be a positive safe integer number of centavos. The experiment requires exactly one numeric token outside ISO dates, directly after a supported action phrase. It rejects detected arithmetic, signs, times, malformed formatting, and additional numeric tokens. A restricted set of words can follow the amount, preventing common counts from being treated as pesos. These restrictions intentionally reject some legitimate expressions and are not a complete natural-language quantity classifier; ambiguous or unsupported forms need further evaluation.

## Date evidence

The reference date is injected as `context.todayDateKey`; the evaluator does not read the device clock. A single explicit ISO date or supported today/yesterday expression is resolved against that reference, and must be valid, not future-dated, and in the active month. With no detected date, the experiment uses the existing current-local-date default. Conflicting detected expressions, written months, unsupported relative periods, and slash-form dates are rejected. This restricted recognition does not cover all natural-language date expressions; it is not evidence that unrecognized phrases are safe.

## Entity evidence

References are resolved through the request's local wallet and active-container aliases, never from model-provided persistent IDs. The experiment requires explicit unique entity names, rejects conflicting or irrelevant alias fields, and asks for clarification when additional entities are mentioned. Transfers additionally require a recognized `from <source> to/for <destination>` route. This is intentionally narrower than the application's defaults and natural-language coverage; ambiguous or unsupported wording is not used to select an entity.

## Read-only and unsupported results

The result retains the offline interpretation, including locally calculated answers. A local read-only answer makes the synthetic candidate unsupported; no candidate-generated totals or balances are returned. A contract-valid synthetic clarification remains a clarification, and a refusal or a synthetic answer unsupported by local interpretation remains unsupported. The experiment does not create a financial answer from model output.

## Synthetic benchmark scoring

The benchmark retains the original 24 fixtures and adds adversarial cases. Independent expected proposal labels specify action, integer amount, date, and applicable wallet/container roles; expected decisions also specify an outcome and reason. It separately counts fully matching offline proposals, correctly formed synthetic proposals, matching experimental decisions, unsafe acceptances, and accepted full-field matches beyond an offline proposal. Proposal counts are not overall assistant accuracy scores: clarification, refusal, and answer correctness are not included in those proposal counts. The candidates are manually constructed and do not measure model accuracy. An archived-container fixture observes that aliases are rebuilt after filtering, so its rejected `c1` resolves to Savings rather than representing a persistent stale alias.
