import { isDeepStrictEqual } from 'node:util';

import type { AssistantContext, AssistantIntent, AssistantQuestionTopic, AssistantResult } from '../../src/ai/localAssistant';
import type { SemanticAcceptedCandidate, SemanticEvaluationResult } from '../../src/ai/online/semanticEvaluation';
import { createOnlineRequest, validateOnlineResponse } from '../../src/ai/online/contract';
import { parsePesoToMinor } from '../../src/lib/money';
import { dateKeyToLocalDate, toLocalDateKey } from '../../src/lib/period';

/** Human-authored labels. Null means that the field is not applicable. */
export interface SemanticGroundTruth {
  id: string;
  message: string;
  outcome: 'proposal' | 'clarification' | 'answer' | 'refusal' | 'unsupported' | 'reject';
  intent: AssistantIntent | null;
  proposal: SemanticAcceptedCandidate | null;
  clarificationFields: string[] | null;
  clarificationReason: string | null;
  refusalClassification: string | null;
  answer: { topic: AssistantQuestionTopic; figures: { label: string; amountMinor: number }[] } | null;
  transactionOccurredOrRequested: boolean;
  financiallyEligible: boolean | null;
  safeToAccept: boolean;
}

export interface BenchmarkScore {
  classificationCorrect: boolean;
  financialFieldsCorrect: boolean | null;
  detailCorrect: boolean;
  unsafeAcceptance: boolean;
  safeAdditionalCoverage: boolean;
}

export interface LabeledEvaluation {
  truth: SemanticGroundTruth;
  result: SemanticEvaluationResult;
  score: BenchmarkScore;
}

export interface ComponentScores {
  classification: boolean;
  action: boolean | null;
  intent: boolean | null;
  amount: boolean | null;
  date: boolean | null;
  entities: boolean | null;
  roles: boolean | null;
  clarificationField: boolean | null;
  clarificationReason: boolean | null;
  answer: boolean | null;
  refusal: boolean | null;
  unsupported: boolean | null;
  exact: boolean;
}

interface Observation {
  kind: SemanticGroundTruth['outcome'] | 'unknown';
  intent?: string;
  proposal?: SemanticAcceptedCandidate;
  missingFields?: readonly string[];
  reason?: string;
  answer?: SemanticGroundTruth['answer'];
}

function offlineObservation(result: AssistantResult): Observation {
  if (result.kind === 'proposal') {
    const p = result.proposal;
    const proposal: SemanticAcceptedCandidate = { action: p.action, amountMinor: p.amountMinor, effectiveDate: p.effectiveDate };
    if (p.action === 'expense') { proposal.walletId = p.walletId; proposal.containerId = p.containerId; }
    else if (p.action === 'income') { proposal.destinationWalletId = p.walletId; proposal.destinationContainerId = p.destinationContainerId; }
    else if (p.action === 'wallet_transfer') { proposal.sourceWalletId = p.sourceWalletId; proposal.destinationWalletId = p.destinationWalletId; }
    else { proposal.sourceContainerId = p.containerId; proposal.destinationContainerId = p.destinationContainerId; }
    return { kind: 'proposal', intent: result.intent, proposal };
  }
  if (result.kind === 'clarification') return { kind: 'clarification', intent: result.intent, missingFields: result.interpretation.missingFields, reason: result.clarification.reason };
  if (result.kind === 'answer') return { kind: 'answer', intent: result.intent, answer: { topic: result.answer.topic, figures: result.answer.figures } };
  return { kind: 'refusal', intent: result.intent };
}

function candidateObservation(candidate: unknown, truth: SemanticGroundTruth, context: AssistantContext): Observation {
  try {
    const parsed = validateOnlineResponse(candidate);
    if (parsed.kind === 'clarification') return { kind: 'clarification', intent: parsed.intent, missingFields: parsed.missingFields, reason: parsed.reason };
    if (parsed.kind === 'answer') return { kind: 'answer', intent: parsed.intent, answer: { topic: parsed.answerTopic, figures: [] } };
    if (parsed.kind === 'refusal') return { kind: 'refusal', intent: parsed.intent, reason: parsed.reason };
    const amount = parsed.amountText === undefined ? null : parsePesoToMinor(parsed.amountText);
    let date: string | undefined;
    const token = parsed.dateText?.toLowerCase();
    if (token === undefined || ['today', 'ngayon', 'kanina'].includes(token)) date = context.todayDateKey;
    else if (['yesterday', 'kahapon'].includes(token)) { const d = dateKeyToLocalDate(context.todayDateKey); d.setDate(d.getDate() - 1); date = toLocalDateKey(d); }
    else date = parsed.dateText;
    if (amount === null || date === undefined) return { kind: 'proposal', intent: parsed.intent };
    const envelope = createOnlineRequest(truth.message, context);
    const refs = parsed.refs ?? {};
    const w = (key: string | undefined) => key ? envelope.walletIdsByAlias.get(key) : undefined;
    const c = (key: string | undefined) => key ? envelope.containerIdsByAlias.get(key) : undefined;
    const proposal: SemanticAcceptedCandidate = { action: parsed.action, amountMinor: amount, effectiveDate: date };
    if (parsed.action === 'expense') { proposal.walletId = w(refs.wallet ?? refs.sourceWallet); proposal.containerId = c(refs.container ?? refs.sourceContainer); }
    else if (parsed.action === 'income') { proposal.destinationWalletId = w(refs.wallet ?? refs.destinationWallet); proposal.destinationContainerId = c(refs.container ?? refs.destinationContainer); }
    else if (parsed.action === 'wallet_transfer') { proposal.sourceWalletId = w(refs.sourceWallet); proposal.destinationWalletId = w(refs.destinationWallet); }
    else { proposal.sourceContainerId = c(refs.sourceContainer ?? refs.container); proposal.destinationContainerId = c(refs.destinationContainer); }
    return { kind: 'proposal', intent: parsed.intent, proposal };
  } catch { return { kind: 'unknown' }; }
}

function scoreObservation(truth: SemanticGroundTruth, observed: Observation): ComponentScores {
  const p = truth.proposal;
  const o = observed.proposal;
  const proposalApplicable = truth.outcome === 'proposal';
  const compareRoles = () => p !== null && o !== undefined && ['walletId', 'containerId', 'sourceWalletId', 'destinationWalletId', 'sourceContainerId', 'destinationContainerId'].every((key) => p[key as keyof SemanticAcceptedCandidate] === o[key as keyof SemanticAcceptedCandidate]);
  const classification = observed.kind === truth.outcome;
  const action = proposalApplicable && o ? o.action === p?.action : null;
  const intent = truth.intent === null || observed.intent === undefined ? null : observed.intent === truth.intent;
  const amount = proposalApplicable && o ? o.amountMinor === p?.amountMinor : null;
  const date = proposalApplicable && o ? o.effectiveDate === p?.effectiveDate : null;
  const entities = proposalApplicable && o ? compareRoles() : null;
  const roles = proposalApplicable && o ? compareRoles() : null;
  const clarificationField = truth.outcome === 'clarification' && observed.kind === 'clarification' ? isDeepStrictEqual(observed.missingFields ?? null, truth.clarificationFields) : null;
  const clarificationReason = truth.outcome === 'clarification' && truth.clarificationReason !== null && observed.kind === 'clarification' ? observed.reason === truth.clarificationReason : null;
  const answer = truth.outcome === 'answer' && observed.kind === 'answer' ? isDeepStrictEqual(observed.answer, truth.answer) : null;
  const refusal = truth.outcome === 'refusal' && truth.refusalClassification !== null && observed.kind === 'refusal' ? observed.reason === truth.refusalClassification : null;
  const unsupported = truth.outcome === 'unsupported' ? observed.kind === 'unsupported' : null;
  const fields = [action, intent, amount, date, entities, roles, clarificationField, clarificationReason, answer, refusal, unsupported];
  return { classification, action, intent, amount, date, entities, roles, clarificationField, clarificationReason, answer, refusal, unsupported,
    exact: classification && fields.every((field) => field !== false) && (truth.intent === null || observed.intent !== undefined) && (!proposalApplicable || (!!o && truth.safeToAccept && truth.financiallyEligible === true)) };
}

/** One ground truth and one component scorer for all three observed paths. */
export function scoreBenchmarkTriplet(truth: SemanticGroundTruth, offline: AssistantResult, candidate: unknown, experimental: SemanticEvaluationResult, context: AssistantContext) {
  const candidateObs = candidateObservation(candidate, truth, context);
  let experimentalObs: Observation;
  if (experimental.status === 'accepted') experimentalObs = { kind: 'proposal', intent: candidateObs.intent, proposal: experimental.candidate };
  else if (experimental.status === 'clarification_required') experimentalObs = { kind: 'clarification', intent: offline.intent, missingFields: experimental.missingFields, reason: experimental.reasons[0] };
  else if (experimental.status === 'rejected') experimentalObs = { kind: 'reject', reason: experimental.reasons[0] };
  else if (experimental.offline.kind === 'answer') experimentalObs = offlineObservation(experimental.offline);
  else experimentalObs = { kind: 'unsupported' };
  return { offline: scoreObservation(truth, offlineObservation(offline)), candidate: scoreObservation(truth, candidateObs), experimental: scoreObservation(truth, experimentalObs) };
}

export function summarizeTriplets(rows: readonly { truth: SemanticGroundTruth; result: SemanticEvaluationResult; scores: ReturnType<typeof scoreBenchmarkTriplet> }[]) {
  const categories: Record<string, number> = {};
  for (const row of rows) categories[row.truth.outcome] = (categories[row.truth.outcome] ?? 0) + 1;
  const proposals = rows.filter(({ truth }) => truth.outcome === 'proposal');
  const accepted = rows.filter(({ result }) => result.status === 'accepted');
  const rate = (count: number, denominator: number) => ({ count, denominator });
  const scoreFields = ['action', 'intent', 'amount', 'date', 'entities', 'roles', 'clarificationField', 'clarificationReason', 'answer', 'refusal', 'unsupported'] as const;
  const mismatches = Object.fromEntries(scoreFields.map((field) => [field, rate(rows.filter(({ scores }) => scores.experimental[field] === false).length, rows.filter(({ scores }) => scores.experimental[field] !== null).length)]));
  return {
    total: rows.length, categories,
    offlineClassification: rate(rows.filter(({ scores }) => scores.offline.classification).length, rows.length),
    offlineExact: rate(rows.filter(({ scores }) => scores.offline.exact).length, rows.length),
    candidateClassification: rate(rows.filter(({ scores }) => scores.candidate.classification).length, rows.length),
    candidateExact: rate(rows.filter(({ scores }) => scores.candidate.exact).length, rows.length),
    experimentalClassification: rate(rows.filter(({ scores }) => scores.experimental.classification).length, rows.length),
    experimentalExact: rate(rows.filter(({ scores }) => scores.experimental.exact).length, rows.length),
    safeAdditional: rate(proposals.filter(({ truth, scores }) => truth.safeToAccept && truth.financiallyEligible === true && scores.experimental.exact && !scores.offline.exact).length, proposals.length),
    unsafeAccepted: rate(accepted.filter(({ truth, scores }) => !truth.safeToAccept || truth.financiallyEligible !== true || !scores.experimental.exact).length, accepted.length),
    incorrectAccepted: rate(accepted.filter(({ scores }) => !scores.experimental.exact).length, accepted.length),
    falseClarification: rate(proposals.filter(({ result }) => result.status === 'clarification_required').length, proposals.length),
    falseRejection: rate(proposals.filter(({ result }) => result.status === 'rejected').length, proposals.length),
    unsupportedErrors: rate(proposals.filter(({ result }) => result.status === 'unsupported').length, proposals.length),
    mismatches,
  };
}

/** Counts have explicit denominators; no aggregate accuracy percentage. */
export function summarizeSemanticCases(cases: readonly LabeledEvaluation[]) {
  const proposalCases = cases.filter(({ truth }) => truth.outcome === 'proposal');
  const accepted = cases.filter(({ result }) => result.status === 'accepted');
  const categoryCounts: Record<string, number> = {};
  for (const { truth } of cases) categoryCounts[truth.outcome] = (categoryCounts[truth.outcome] ?? 0) + 1;
  const fieldMismatches: Record<string, number> = {};
  for (const { truth, result } of proposalCases) {
    if (!result.candidate || !truth.proposal) continue;
    for (const key of ['action', 'amountMinor', 'effectiveDate', 'walletId', 'containerId', 'sourceWalletId', 'destinationWalletId', 'sourceContainerId', 'destinationContainerId'] as const) {
      if (result.candidate[key] !== truth.proposal[key]) fieldMismatches[key] = (fieldMismatches[key] ?? 0) + 1;
    }
  }
  return {
    total: cases.length,
    categoryCounts,
    classification: { correct: cases.filter(({ score }) => score.classificationCorrect).length, denominator: cases.length },
    proposalFields: { correct: proposalCases.filter(({ score }) => score.financialFieldsCorrect).length, denominator: proposalCases.length },
    falseClarifications: { count: proposalCases.filter(({ result }) => result.status === 'clarification_required').length, denominator: proposalCases.length },
    falseRejections: { count: proposalCases.filter(({ result }) => result.status === 'rejected').length, denominator: proposalCases.length },
    unsupportedClassificationErrors: { count: proposalCases.filter(({ result }) => result.status === 'unsupported').length, denominator: proposalCases.length },
    safeAdditionalCoverage: { count: cases.filter(({ score }) => score.safeAdditionalCoverage).length, denominator: proposalCases.length },
    unsafeAcceptance: { count: cases.filter(({ score }) => score.unsafeAcceptance).length, denominator: accepted.length },
    incorrectAcceptedProposals: { count: accepted.filter(({ score }) => score.financialFieldsCorrect !== true).length, denominator: accepted.length },
    fieldMismatches: { counts: fieldMismatches, denominator: proposalCases.filter(({ result }) => result.candidate !== undefined).length },
  };
}

/** Compare against labels only; never infer ground truth from a candidate. */
export function scoreSemanticCase(
  truth: SemanticGroundTruth,
  result: SemanticEvaluationResult,
  candidate: unknown,
): BenchmarkScore {
  const record = typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : {};
  let contractValid = false;
  try { validateOnlineResponse(candidate); contractValid = true; } catch { /* malformed candidate */ }
  const hasCandidate = result.candidate !== undefined;
  const financialFieldsCorrect = truth.outcome === 'proposal'
    ? contractValid && isDeepStrictEqual(result.candidate, truth.proposal) && record.intent === truth.intent
    : null;
  let classificationCorrect = false;
  let detailCorrect = false;
  if (truth.outcome === 'proposal') {
    classificationCorrect = result.status === 'accepted';
    detailCorrect = classificationCorrect && financialFieldsCorrect === true;
  } else if (truth.outcome === 'clarification') {
    classificationCorrect = result.status === 'clarification_required' && !hasCandidate;
    detailCorrect = classificationCorrect && contractValid && record.kind === 'clarification' && record.intent === truth.intent && isDeepStrictEqual(result.missingFields ?? null, truth.clarificationFields) &&
      (truth.clarificationReason === null || result.reasons.includes(truth.clarificationReason as typeof result.reasons[number]));
  } else if (truth.outcome === 'answer') {
    classificationCorrect = result.status === 'unsupported' && result.offline.kind === 'answer' && !hasCandidate;
    detailCorrect = classificationCorrect && contractValid && record.kind === 'answer' && record.intent === truth.intent && record.answerTopic === truth.answer?.topic && result.offline.kind === 'answer' && result.offline.intent === truth.intent &&
      result.offline.answer.topic === truth.answer?.topic && isDeepStrictEqual(result.offline.answer.figures, truth.answer?.figures);
  } else if (truth.outcome === 'refusal' || truth.outcome === 'unsupported') {
    classificationCorrect = result.status === 'unsupported' && !hasCandidate && contractValid && record.kind === 'refusal';
    detailCorrect = classificationCorrect && record.intent === truth.intent && record.reason === truth.refusalClassification;
  } else {
    classificationCorrect = result.status === 'rejected' && !hasCandidate;
    detailCorrect = classificationCorrect && (truth.refusalClassification === null || result.reasons.includes(truth.refusalClassification as typeof result.reasons[number]));
  }
  const unsafeAcceptance = result.status === 'accepted' && (!truth.safeToAccept || !truth.transactionOccurredOrRequested || truth.financiallyEligible !== true || financialFieldsCorrect !== true);
  return {
    classificationCorrect,
    financialFieldsCorrect,
    detailCorrect,
    unsafeAcceptance,
    safeAdditionalCoverage: truth.outcome === 'proposal' && detailCorrect && !unsafeAcceptance && result.offline.kind !== 'proposal',
  };
}
