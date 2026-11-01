import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExecuTorchRuntimeConfig } from '../src/ai/runtime/executorch/config';

const validConfig = {
  modelPath: 'file:///data/user/0/com.pocketa.app/files/model.pte',
  tokenizerPath: 'file:///data/user/0/com.pocketa.app/files/tokenizer.json',
  tokenizerConfigPath:
    'file:///data/user/0/com.pocketa.app/files/tokenizer_config.json',
  maxNewTokens: 256,
  temperature: 0.1,
};

test('ExecuTorch runtime config accepts local model paths', () => {
  assert.doesNotThrow(() => validateExecuTorchRuntimeConfig(validConfig));
});

test('ExecuTorch runtime config rejects remote model paths', () => {
  assert.throws(
    () =>
      validateExecuTorchRuntimeConfig({
        ...validConfig,
        modelPath: 'https://example.com/model.pte',
      }),
    /remote model downloads are not allowed/,
  );
  assert.throws(
    () =>
      validateExecuTorchRuntimeConfig({
        ...validConfig,
        tokenizerPath: 'http://example.com/tokenizer.json',
      }),
    /remote model downloads are not allowed/,
  );
});

test('ExecuTorch runtime config rejects missing and invalid options', () => {
  assert.throws(
    () =>
      validateExecuTorchRuntimeConfig({
        ...validConfig,
        modelPath: ' ',
      }),
    /model path is required/,
  );
  assert.throws(
    () =>
      validateExecuTorchRuntimeConfig({
        ...validConfig,
        maxNewTokens: 0,
      }),
    /maxNewTokens/,
  );
  assert.throws(
    () =>
      validateExecuTorchRuntimeConfig({
        ...validConfig,
        temperature: -1,
      }),
    /temperature/,
  );
});
