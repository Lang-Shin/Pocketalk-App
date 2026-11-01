import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  LLMChatSession,
  LLMChatTurnResult,
} from 'react-native-executorch';

import { LocalModelCancelledError } from '../src/ai/runtime';
import {
  ExecuTorchLocalModelRuntime,
  type ExecuTorchRuntimeConfig,
} from '../src/ai/runtime/executorch';

const config: ExecuTorchRuntimeConfig = {
  modelPath: 'file:///data/user/0/com.pocketa.app/files/model.pte',
  tokenizerPath: 'file:///data/user/0/com.pocketa.app/files/tokenizer.json',
  tokenizerConfigPath:
    'file:///data/user/0/com.pocketa.app/files/tokenizer_config.json',
  maxNewTokens: 128,
  temperature: 0.1,
};

function turn(text = 'ok'): LLMChatTurnResult {
  return {
    messages: [{ role: 'assistant', content: text }],
    stats: [
      {
        numPromptTokens: 10,
        numGeneratedTokens: 2,
        firstTokenMs: 120,
        inferenceStartMs: 100,
        inferenceEndMs: 200,
        modelLoadStartMs: 0,
        modelLoadEndMs: 10,
      },
    ],
    finishReason: 'stop',
  };
}

interface FakeSessionRecord {
  session: LLMChatSession;
  events: string[];
  lastConfig?: unknown;
}

function fakeSession(
  onSend: (
    message: string,
    onToken: ((token: string) => void) | undefined,
    genConfig: unknown,
  ) => Promise<LLMChatTurnResult>,
): FakeSessionRecord {
  const events: string[] = [];
  const record: FakeSessionRecord = {
    events,
    session: {} as LLMChatSession,
  };
  record.session = {
    sendMessage: async (
      message: Parameters<LLMChatSession['sendMessage']>[0],
      onToken?: Parameters<LLMChatSession['sendMessage']>[1],
      genConfig?: Parameters<LLMChatSession['sendMessage']>[2],
    ) => {
      record.lastConfig = genConfig;
      return onSend(String(message), onToken, genConfig);
    },
    stop: () => {
      events.push('stop');
    },
    dispose: () => {
      events.push('dispose');
    },
    getHistory: () => [],
    getKVCacheState: () => ({
      pos: 0,
      maxSeqLen: 4096,
      remainingTokens: 4096,
      usageRatio: 0,
    }),
  } as LLMChatSession;
  return record;
}

test('each interpretation uses a fresh session and disposes it', async () => {
  const records: FakeSessionRecord[] = [];
  const runtime = new ExecuTorchLocalModelRuntime(config, {
    now: () => 1000,
    createSession: async () => {
      const record = fakeSession(async () => turn());
      records.push(record);
      return record.session;
    },
  });

  await runtime.load();
  const first = await runtime.generate({ prompt: 'first' });
  assert.equal(first.text, 'ok');
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.events, ['dispose']);

  await runtime.load();
  const second = await runtime.generate({ prompt: 'second' });
  assert.equal(second.text, 'ok');
  assert.equal(records.length, 2);
  assert.deepEqual(records[1]?.events, ['dispose']);
});

test('cancellation rejects even when native generation resolves partial output', async () => {
  let resolveTurn: ((value: LLMChatTurnResult) => void) | undefined;
  const record = fakeSession(
    () =>
      new Promise<LLMChatTurnResult>((resolve) => {
        resolveTurn = resolve;
      }),
  );
  const runtime = new ExecuTorchLocalModelRuntime(config, {
    createSession: async () => record.session,
  });

  await runtime.load();
  const generation = runtime.generate({ prompt: 'cancel me' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runtime.cancel();
  resolveTurn?.(turn('partial'));

  await assert.rejects(generation, LocalModelCancelledError);
  assert.equal(runtime.status(), 'unloaded');
  assert.deepEqual(record.events, ['stop', 'dispose']);
});

test('unload waits for active generation before disposing', async () => {
  let resolveTurn: ((value: LLMChatTurnResult) => void) | undefined;
  const record = fakeSession(
    () =>
      new Promise<LLMChatTurnResult>((resolve) => {
        resolveTurn = resolve;
      }),
  );
  const runtime = new ExecuTorchLocalModelRuntime(config, {
    createSession: async () => record.session,
  });

  await runtime.load();
  const generation = runtime.generate({ prompt: 'unload me' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const unloading = runtime.unload();
  resolveTurn?.(turn('partial'));

  await unloading;
  await assert.rejects(generation, LocalModelCancelledError);
  assert.deepEqual(record.events, ['stop', 'dispose']);
  assert.equal(runtime.status(), 'unloaded');
});

test('generation failure disposes the session and can recover after reload', async () => {
  const records: FakeSessionRecord[] = [];
  let shouldFail = true;
  const runtime = new ExecuTorchLocalModelRuntime(config, {
    createSession: async () => {
      const record = fakeSession(async () => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('native generation failed');
        }
        return turn('recovered');
      });
      records.push(record);
      return record.session;
    },
  });

  await runtime.load();
  await assert.rejects(
    () => runtime.generate({ prompt: 'fail' }),
    /native generation failed/,
  );
  assert.equal(runtime.status(), 'error');
  assert.deepEqual(records[0]?.events, ['dispose']);

  await runtime.load();
  const recovered = await runtime.generate({ prompt: 'retry' });
  assert.equal(recovered.text, 'recovered');
  assert.equal(records.length, 2);
  assert.deepEqual(records[1]?.events, ['dispose']);
});

test('generation options are explicit and omit undefined defaults', async () => {
  const withDefaults = fakeSession(async () => turn());
  const runtime = new ExecuTorchLocalModelRuntime(config, {
    createSession: async () => withDefaults.session,
  });
  await runtime.load();
  await runtime.generate({ prompt: 'defaults' });
  assert.deepEqual(withDefaults.lastConfig, {
    maxNewTokens: 128,
    temperature: 0.1,
  });

  const noDefaults = fakeSession(async () => turn());
  const bareRuntime = new ExecuTorchLocalModelRuntime(
    {
      modelPath: config.modelPath,
      tokenizerPath: config.tokenizerPath,
      tokenizerConfigPath: config.tokenizerConfigPath,
    },
    { createSession: async () => noDefaults.session },
  );
  await bareRuntime.load();
  await bareRuntime.generate({ prompt: 'bare' });
  assert.deepEqual(noDefaults.lastConfig, {});
});
