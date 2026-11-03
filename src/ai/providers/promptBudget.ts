export interface LocalPromptTokenEstimator {
  estimate(prompt: string): number;
}

export const DEFAULT_POLICY_MAX_CONTEXT_TOKENS = 2048;
export const DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE = 512;
export const DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS = 128;

export class ApproximateCharacterPromptTokenEstimator
  implements LocalPromptTokenEstimator
{
  estimate(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }
}

export class PromptBudgetExceededError extends Error {
  constructor(
    readonly estimatedPromptTokens: number,
    readonly maxPromptTokens: number,
    readonly maxContextTokens: number,
    readonly outputTokenAllowance: number,
    readonly safetyMarginTokens: number,
  ) {
    super(
      `Prompt exceeds the local token budget (${estimatedPromptTokens} estimated > ${maxPromptTokens} available after ${outputTokenAllowance} output and ${safetyMarginTokens} safety tokens from ${maxContextTokens}).`,
    );
    this.name = 'PromptBudgetExceededError';
  }
}
