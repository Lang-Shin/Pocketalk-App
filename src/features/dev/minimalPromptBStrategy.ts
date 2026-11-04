import type {
  AssistantContext,
  AssistantPendingIntent,
} from '@/ai/localAssistant';
import type { LocalModelPromptBuilder } from '@/ai/runtime';

export const MINIMAL_PROMPT_B_VERSION = 'pocketa-minimal-b-v1';

const INSTRUCTIONS = `Task: interpret one Pocketa finance message into one JSON object.
Return only the JSON object. No Markdown, code fences, labels, prefix, or explanation.
Outcome types: proposal, clarification, answer, refusal.
Intents: income, expense, wallet_transfer, container_transfer, balance_inquiry, spending_summary, income_summary, budget_inquiry, clarification_request, unknown.
Actions: expense, income, wallet_transfer, container_transfer, savings_contribution, savings_withdrawal.
Missing fields: amount, effectiveDate, sourceWallet, destinationWallet, sourceContainer, destinationContainer, transferKind.
Answer topics: savings_balance, unallocated_balance, wallet_balance, container_balance, container_spending, budget_remaining, monthly_spending, monthly_income, monthly_net_savings, monthly_savings_activity, help.
Rules:
- Never invent an amount, wallet ID, container ID, or destination.
- If no date is stated, use todayDateKey; never invent another date.
- Income without a named destination uses system-unallocated.
- Use only wallet and container IDs from CONTEXT.
- Distinguish income, expense, wallet transfer, container transfer, and read-only questions.
- Missing or ambiguous required information: return clarification.
- Unsupported request: return refusal with intent unknown.
- Balance, spending, and budget questions: return answer, not a proposal.
- Never execute, confirm, or save anything.
Output object fields:
- If type is proposal: include type, intent, action, message, title, amountMinor, effectiveDate, confidence, and the applicable wallet/container IDs.
- If type is clarification: include type, intent, message, missingFields, clarificationReason, confidence, and optionally title and fromContainerId.
- If type is answer: include type, intent, message, topic, title, figures, confidence. Use figures: [] when balances are not supplied.
- If type is refusal: include type, intent, message, confidence.
Do not add any other fields.`;

export class MinimalPromptBPromptBuilder implements LocalModelPromptBuilder {
  interpretationPrompt(text: string, context: AssistantContext): string {
    return [
      `POCKETA MINIMAL PROMPT B (${MINIMAL_PROMPT_B_VERSION})`,
      INSTRUCTIONS,
      compactContext(context),
      `USER_MESSAGE_JSON: ${JSON.stringify(text)}`,
      'Return the JSON object now.',
    ].join('\n\n');
  }

  containerChoicePrompt(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return [
      `POCKETA MINIMAL PROMPT B (${MINIMAL_PROMPT_B_VERSION})`,
      INSTRUCTIONS,
      compactContext(context),
      `PENDING_TRANSACTION_JSON: ${JSON.stringify(pending)}`,
      `SELECTED_CONTAINER_ID_JSON: ${JSON.stringify(containerId)}`,
      'Return the completed JSON object now.',
    ].join('\n\n');
  }

  walletChoicePrompt(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return [
      `POCKETA MINIMAL PROMPT B (${MINIMAL_PROMPT_B_VERSION})`,
      INSTRUCTIONS,
      compactContext(context),
      `PENDING_TRANSACTION_JSON: ${JSON.stringify(pending)}`,
      `SELECTED_WALLET_ID_JSON: ${JSON.stringify(walletId)}`,
      'Return the completed JSON object now.',
    ].join('\n\n');
  }
}

function compactContext(context: AssistantContext): string {
  const wallets = context.wallets
    .map((wallet) => `- ${wallet.id} = ${wallet.name}`)
    .join('\n');
  const containers = context.containers
    .filter((container) => container.status === 'active')
    .map((container) => `- ${container.id} = ${container.name}`)
    .join('\n');

  return [
    'CONTEXT:',
    `todayDateKey=${context.todayDateKey}`,
    `activeMonthKey=${context.activeMonthKey}`,
    'wallets:',
    wallets,
    'containers:',
    containers,
  ].join('\n');
}
