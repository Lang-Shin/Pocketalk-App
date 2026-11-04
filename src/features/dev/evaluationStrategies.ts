import { PocketaLocalResponseParser } from '@/ai/providers/localResponseParser';
import type { LocalModelResponseParser } from '@/ai/runtime';
import { InstrumentedPromptBuilder } from '@/features/dev/localAiInstrumentation';
import { MinimalPromptBPromptBuilder } from '@/features/dev/minimalPromptBStrategy';
import {
  MinimalSchemaPromptBuilder,
  MinimalSchemaResponseParser,
} from '@/features/dev/minimalSchemaStrategy';

export type EvaluationStrategy = 'production' | 'minimal' | 'minimal-b';

export const STRATEGY_LABELS: Record<EvaluationStrategy, string> = {
  production: 'Production prompt',
  minimal: 'Minimal Schema A',
  'minimal-b': 'Minimal Prompt B',
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

  if (strategy === 'minimal-b') {
    return {
      promptBuilder: new InstrumentedPromptBuilder({
        delegate: new MinimalPromptBPromptBuilder(),
      }),
      responseParser: new MinimalSchemaResponseParser(),
    };
  }

  return {
    promptBuilder: new InstrumentedPromptBuilder(),
    responseParser: new PocketaLocalResponseParser(),
  };
}
