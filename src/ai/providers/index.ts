import type {
  LocalModelPromptBuilder,
  LocalModelResponseParser,
  LocalModelRuntime,
} from '../runtime';
import { ExecuTorchLocalModelRuntime } from '../runtime/executorch';
import { OfflineAssistantProvider } from './offlineAssistantProvider';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';
import { LocalLlmProvider } from './localLlmProvider';
import { PocketaLocalPromptBuilder } from './localPromptBuilder';
import { PocketaLocalResponseParser } from './localResponseParser';
import type { LocalPromptTokenEstimator } from './promptBudget';
import { ValidatedAssistantProvider } from './validatedAssistantProvider';

export function createAssistantProvider(
  provider: AssistantProvider = new OfflineAssistantProvider(),
): AssistantProvider {
  return new ValidatedAssistantProvider(provider);
}

export interface LocalAssistantProviderOptions {
  info: AssistantProviderInfo;
  promptBuilder?: LocalModelPromptBuilder;
  responseParser?: LocalModelResponseParser;
  promptTokenEstimator?: LocalPromptTokenEstimator;
  maxContextTokens?: number;
  outputTokenAllowance?: number;
  promptSafetyMarginTokens?: number;
  maxPendingRequests?: number;
}

export function createLocalAssistantProvider(
  runtime: LocalModelRuntime,
  options: LocalAssistantProviderOptions,
): AssistantProvider {
  return createAssistantProvider(
    new LocalLlmProvider(runtime, {
      info: options.info,
      promptBuilder:
        options.promptBuilder ?? new PocketaLocalPromptBuilder(),
      responseParser:
        options.responseParser ?? new PocketaLocalResponseParser(),
      promptTokenEstimator: options.promptTokenEstimator,
      maxContextTokens: options.maxContextTokens,
      outputTokenAllowance: options.outputTokenAllowance,
      promptSafetyMarginTokens: options.promptSafetyMarginTokens,
      maxPendingRequests: options.maxPendingRequests,
    }),
  );
}

export const LOCAL_ASSISTANT_PROVIDER_ENV =
  'EXPO_PUBLIC_POCKETA_ASSISTANT_PROVIDER';
export const LOCAL_MODEL_PATH_ENV =
  'EXPO_PUBLIC_POCKETA_LOCAL_MODEL_PATH';
export const LOCAL_TOKENIZER_PATH_ENV =
  'EXPO_PUBLIC_POCKETA_LOCAL_TOKENIZER_PATH';
export const LOCAL_TOKENIZER_CONFIG_PATH_ENV =
  'EXPO_PUBLIC_POCKETA_LOCAL_TOKENIZER_CONFIG_PATH';

export interface ConfiguredAssistantProviderOptions {
  isDevelopment: boolean;
  requestedProvider?: string;
  createLocalProvider?: () => AssistantProvider;
}

export function createConfiguredAssistantProvider(
  options: ConfiguredAssistantProviderOptions,
): AssistantProvider {
  if (
    !options.isDevelopment ||
    options.requestedProvider !== 'local'
  ) {
    return createAssistantProvider();
  }
  if (!options.createLocalProvider) {
    throw new Error(
      'The local assistant provider requires an explicit development runtime configuration.',
    );
  }
  return createAssistantProvider(options.createLocalProvider());
}

export interface DevelopmentLocalAssistantConfig {
  modelPath: string;
  tokenizerPath: string;
  tokenizerConfigPath: string;
}

export function createDevelopmentLocalAssistantProvider(
  config: DevelopmentLocalAssistantConfig,
): AssistantProvider {
  const runtime = new ExecuTorchLocalModelRuntime({
    modelPath: requiredLocalPath(config.modelPath, LOCAL_MODEL_PATH_ENV),
    tokenizerPath: requiredLocalPath(
      config.tokenizerPath,
      LOCAL_TOKENIZER_PATH_ENV,
    ),
    tokenizerConfigPath: requiredLocalPath(
      config.tokenizerConfigPath,
      LOCAL_TOKENIZER_CONFIG_PATH_ENV,
    ),
  });
  return createLocalAssistantProvider(runtime, {
    info: {
      id: 'local-executorch-development',
      displayName: 'Local ExecuTorch (development)',
      kind: 'local_llm',
      isRealModel: true,
      modelName: 'Configured local ExecuTorch model',
      needsModelDownload: true,
      offline: true,
      description:
        'Development-only on-device interpretation using the explicitly configured local model. No cloud fallback is used.',
    },
  });
}

function createAppAssistantProvider(): AssistantProvider {
  const isDevelopment =
    typeof __DEV__ !== 'undefined' && __DEV__;
  return createConfiguredAssistantProvider({
    isDevelopment,
    requestedProvider:
      process.env.EXPO_PUBLIC_POCKETA_ASSISTANT_PROVIDER,
    createLocalProvider: () =>
      createDevelopmentLocalAssistantProvider({
        modelPath:
          process.env.EXPO_PUBLIC_POCKETA_LOCAL_MODEL_PATH ?? '',
        tokenizerPath:
          process.env.EXPO_PUBLIC_POCKETA_LOCAL_TOKENIZER_PATH ?? '',
        tokenizerConfigPath:
          process.env.EXPO_PUBLIC_POCKETA_LOCAL_TOKENIZER_CONFIG_PATH ??
          '',
      }),
  });
}

function requiredLocalPath(path: string, environmentName: string): string {
  if (!path.trim()) {
    throw new Error(
      `The local assistant provider is enabled but ${environmentName} is empty.`,
    );
  }
  return path;
}

export const assistantProvider: AssistantProvider =
  createAppAssistantProvider();

export type {
  AssistantProvider,
  AssistantProviderInfo,
  AssistantProviderKind,
} from './assistantProvider';
export { OfflineAssistantProvider } from './offlineAssistantProvider';
export {
  DEFAULT_MAX_PENDING_REQUESTS,
  LocalLlmProvider,
  LocalModelQueueFullError,
  LocalModelUnloadingError,
} from './localLlmProvider';
export type { LocalLlmProviderOptions } from './localLlmProvider';
export {
  LOCAL_PROMPT_VERSION,
  PocketaLocalPromptBuilder,
} from './localPromptBuilder';
export { PocketaLocalResponseParser } from './localResponseParser';
export {
  ApproximateCharacterPromptTokenEstimator,
  DEFAULT_POLICY_MAX_CONTEXT_TOKENS,
  DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE,
  DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS,
  PromptBudgetExceededError,
} from './promptBudget';
export type { LocalPromptTokenEstimator } from './promptBudget';
export { ValidatedAssistantProvider } from './validatedAssistantProvider';
