export interface ExecuTorchRuntimeConfig {
  modelPath: string;
  tokenizerPath: string;
  tokenizerConfigPath: string;
  maxNewTokens?: number;
  temperature?: number;
}

export function validateExecuTorchRuntimeConfig(
  config: ExecuTorchRuntimeConfig,
): void {
  assertLocalPath(config.modelPath, 'model');
  assertLocalPath(config.tokenizerPath, 'tokenizer');
  assertLocalPath(config.tokenizerConfigPath, 'tokenizer config');

  if (
    config.maxNewTokens !== undefined &&
    (!Number.isSafeInteger(config.maxNewTokens) || config.maxNewTokens <= 0)
  ) {
    throw new Error('maxNewTokens must be a positive safe integer.');
  }
  if (
    config.temperature !== undefined &&
    (!Number.isFinite(config.temperature) || config.temperature < 0)
  ) {
    throw new Error('temperature must be a non-negative finite number.');
  }
}

function assertLocalPath(path: string, label: string): void {
  if (!path.trim()) {
    throw new Error(`${label} path is required.`);
  }
  if (/^https?:\/\//i.test(path)) {
    throw new Error(
      `${label} must be a local file path; remote model downloads are not allowed.`,
    );
  }
}
