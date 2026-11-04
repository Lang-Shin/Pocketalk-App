import { PocketaLocalResponseParser } from '@/ai/providers/localResponseParser';
import type { LocalModelResponseParser } from '@/ai/runtime';
import { InstrumentedPromptBuilder } from '@/features/dev/localAiInstrumentation';
import {
  MinimalSchemaPromptBuilder,
  MinimalSchemaResponseParser,
} from '@/features/dev/minimalSchemaStrategy';

export type EvaluationStrategy = 'production' | 'minimal';

export const STRATEGY_LABELS: Record<EvaluationStrategy, string> = {
  production: 'Production prompt',
  minimal: 'Minimal schema A',
};

export interface EvaluationStrategyComponents {
  promptBuilder: InstrumentedPromptBuilder;
  responseParser: LocalModelResponseParser;
}

export function createEvaluationStrategy(
  strategy: EvaluationStrategy,
): EvaluationStrategyComponents {
  if (strategy === 'minimal') {
    return {
      promptBuilder: new InstrumentedPromptBuilder({
        delegate: new MinimalSchemaPromptBuilder(),
      }),
      responseParser: new MinimalSchemaResponseParser(),
    };
  }

  return {
    promptBuilder: new InstrumentedPromptBuilder(),
    responseParser: new PocketaLocalResponseParser(),
  };
}
