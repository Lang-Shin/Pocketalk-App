import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppButton } from '@/components/ui/AppButton';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Screen } from '@/components/ui/Screen';
import { ExecuTorchLocalModelRuntime } from '@/ai/runtime/executorch';
import { EXECUTORCH_SMOKE_MANIFEST } from '@/features/dev/executorchSmokeManifest';
import { useAppTheme, radii, spacing } from '@/theme';

type BusyState = 'verify' | 'run' | 'cancel' | null;

interface ArtifactSpec {
  label: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

const ARTIFACTS: ArtifactSpec[] = [
  {
    label: 'model',
    fileName: EXECUTORCH_SMOKE_MANIFEST.model.fileName,
    bytes: EXECUTORCH_SMOKE_MANIFEST.model.bytes,
    sha256: EXECUTORCH_SMOKE_MANIFEST.model.sha256,
  },
  {
    label: 'tokenizer',
    fileName: EXECUTORCH_SMOKE_MANIFEST.tokenizer.fileName,
    bytes: EXECUTORCH_SMOKE_MANIFEST.tokenizer.bytes,
    sha256: EXECUTORCH_SMOKE_MANIFEST.tokenizer.sha256,
  },
  {
    label: 'tokenizer config',
    fileName: EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.fileName,
    bytes: EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.bytes,
    sha256: EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.sha256,
  },
];

export default function ExecutorchSmokeScreen() {
  const { theme } = useAppTheme();
  const runtimeRef = useRef<ExecuTorchLocalModelRuntime | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [directory, setDirectory] = useState('');
  const [modelPath, setModelPath] = useState('');
  const [tokenizerPath, setTokenizerPath] = useState('');
  const [tokenizerConfigPath, setTokenizerConfigPath] = useState('');

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'android') return;

    let active = true;
    void (async () => {
      const { default: RNBlobUtil } = await import('react-native-blob-util');
      if (!active) return;
      const base = `${
        RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir
      }/${EXECUTORCH_SMOKE_MANIFEST.directory}`;
      setDirectory(base);
      setModelPath(`${base}/${EXECUTORCH_SMOKE_MANIFEST.model.fileName}`);
      setTokenizerPath(
        `${base}/${EXECUTORCH_SMOKE_MANIFEST.tokenizer.fileName}`,
      );
      setTokenizerConfigPath(
        `${base}/${EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.fileName}`,
      );
    })().catch((error: unknown) => {
      appendLog(`Could not resolve app file paths: ${errorMessage(error)}`);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) {
        void runtime.unload().catch(() => {});
      }
    },
    [],
  );

  if (!__DEV__) {
    return (
      <Screen>
        <PageHeader title="Development only" preview={false} />
        <NoticeBanner
          tone="warning"
          title="Smoke test unavailable"
          message="This route is available only in development builds."
        />
      </Screen>
    );
  }

  if (Platform.OS !== 'android') {
    return (
      <Screen>
        <PageHeader title="ExecuTorch smoke" preview={false} />
        <NoticeBanner
          tone="warning"
          title="Android only"
          message="The ExecuTorch smoke test requires an Android development build."
        />
      </Screen>
    );
  }

  function appendLog(line: string) {
    setLogs((current) => [...current, line]);
  }

  async function verifyArtifacts(): Promise<void> {
    if (!modelPath || !tokenizerPath || !tokenizerConfigPath) {
      throw new Error('Provision the model files and set all three paths.');
    }

    const { default: RNBlobUtil } = await import('react-native-blob-util');
    const paths: Record<string, string> = {
      model: modelPath,
      tokenizer: tokenizerPath,
      'tokenizer config': tokenizerConfigPath,
    };

    for (const artifact of ARTIFACTS) {
      const path = paths[artifact.label];
      if (!path) {
        throw new Error(`No path configured for ${artifact.label}.`);
      }
      if (!(await RNBlobUtil.fs.exists(path))) {
        throw new Error(`${artifact.label} file is missing: ${path}`);
      }
      const stat = await RNBlobUtil.fs.stat(path);
      if (stat.size !== artifact.bytes) {
        throw new Error(
          `${artifact.label} size mismatch: expected ${artifact.bytes}, got ${stat.size}`,
        );
      }
      const actualHash = (
        await RNBlobUtil.fs.hash(path, 'sha256')
      ).toLowerCase();
      if (actualHash !== artifact.sha256) {
        throw new Error(
          `${artifact.label} SHA-256 mismatch: expected ${artifact.sha256}, got ${actualHash}`,
        );
      }
      appendLog(`✓ ${artifact.label} ${stat.size} bytes ${actualHash}`);
    }
  }

  async function handleVerify() {
    setBusy('verify');
    appendLog('Verifying pinned model artifacts…');
    try {
      await verifyArtifacts();
      appendLog('Artifact verification passed.');
    } catch (error) {
      appendLog(`Verification failed: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleRun() {
    setBusy('run');
    appendLog('Starting isolated ExecuTorch smoke test…');
    let runtime: ExecuTorchLocalModelRuntime | null = null;

    try {
      await verifyArtifacts();
      runtime = new ExecuTorchLocalModelRuntime({
        modelPath,
        tokenizerPath,
        tokenizerConfigPath,
        maxNewTokens: 64,
        temperature: 0.2,
      });
      runtimeRef.current = runtime;
      const loadStart = Date.now();
      await runtime.load();
      appendLog(`Load completed in ${Date.now() - loadStart} ms.`);
      appendLog(`Runtime status after load: ${runtime.status()}`);

      const generationStart = Date.now();
      const response = await runtime.generate({
        prompt: EXECUTORCH_SMOKE_MANIFEST.prompt,
        maxTokens: 64,
      });
      const elapsed = Date.now() - generationStart;
      const metrics = runtime.metrics();
      appendLog(`Generation completed in ${elapsed} ms.`);
      appendLog(`Generated text: ${JSON.stringify(response.text)}`);
      appendLog(`Metrics: ${JSON.stringify(metrics)}`);
      appendLog(`Runtime status after generation: ${runtime.status()}`);
    } catch (error) {
      appendLog(`Smoke test failed: ${errorMessage(error)}`);
    } finally {
      if (runtime) {
        try {
          await runtime.unload();
          appendLog('Unload completed.');
        } catch (error) {
          appendLog(`Unload failed: ${errorMessage(error)}`);
        }
      }
      runtimeRef.current = null;
      setBusy(null);
    }
  }

  async function handleCancelTest() {
    setBusy('cancel');
    appendLog('Starting cancellation smoke test…');
    let runtime: ExecuTorchLocalModelRuntime | null = null;

    try {
      await verifyArtifacts();
      runtime = new ExecuTorchLocalModelRuntime({
        modelPath,
        tokenizerPath,
        tokenizerConfigPath,
        maxNewTokens: 256,
        temperature: 0.2,
      });
      runtimeRef.current = runtime;
      await runtime.load();
      const generation = runtime.generate({
        prompt: EXECUTORCH_SMOKE_MANIFEST.prompt,
        maxTokens: 256,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (runtime.status() === 'generating') {
        await runtime.cancel();
        appendLog('Cancel requested while generation was active.');
      } else {
        appendLog('Generation completed before cancellation was requested.');
      }
      try {
        const response = await generation;
        appendLog(`Generation settled: ${JSON.stringify(response.text)}`);
      } catch (error) {
        appendLog(`Generation settled with: ${errorMessage(error)}`);
      }
      appendLog(`Runtime status after cancellation test: ${runtime.status()}`);
    } catch (error) {
      appendLog(`Cancellation test failed: ${errorMessage(error)}`);
    } finally {
      if (runtime) {
        try {
          await runtime.unload();
          appendLog('Unload completed after cancellation test.');
        } catch (error) {
          appendLog(`Unload failed: ${errorMessage(error)}`);
        }
      }
      runtimeRef.current = null;
      setBusy(null);
    }
  }

  return (
    <Screen>
      <PageHeader
        title="ExecuTorch smoke"
        subtitle="Development-only real-model connectivity check. No finance access."
        preview={false}
      />
      <NoticeBanner
        tone="warning"
        title="Isolated development test"
        message="This route is not linked from the app. Provision the pinned 0.5B model manually; do not bundle it in the APK."
      />

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <AppText variant="label">Pinned artifact set</AppText>
        <AppText variant="caption" color={theme.colors.textSecondary}>
          {EXECUTORCH_SMOKE_MANIFEST.source}
        </AppText>
        <AppText variant="caption" color={theme.colors.textSecondary}>
          Revision: {EXECUTORCH_SMOKE_MANIFEST.revision}
        </AppText>
        <AppText variant="caption" color={theme.colors.textSecondary}>
          Expected directory: {directory || 'resolving…'}
        </AppText>

        {[
          ['Model path', modelPath, setModelPath],
          ['Tokenizer path', tokenizerPath, setTokenizerPath],
          ['Tokenizer config path', tokenizerConfigPath, setTokenizerConfigPath],
        ].map(([label, value, setter]) => (
          <View key={label as string} style={styles.field}>
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {label as string}
            </AppText>
            <TextInput
              value={value as string}
              onChangeText={setter as (value: string) => void}
              editable={busy === null}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceMuted,
                },
              ]}
            />
          </View>
        ))}

        <View style={styles.actions}>
          <AppButton
            label="Verify artifacts"
            variant="outline"
            onPress={() => void handleVerify()}
            disabled={busy !== null}
            icon="shield-checkmark-outline"
          />
          <AppButton
            label="Run smoke test"
            onPress={() => void handleRun()}
            disabled={busy !== null}
            icon="play"
          />
          <AppButton
            label="Test cancellation"
            variant="outline"
            onPress={() => void handleCancelTest()}
            disabled={busy !== null}
            icon="stop"
          />
        </View>

        {busy ? (
          <View style={styles.progress}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {busy === 'verify'
                ? 'Verifying…'
                : busy === 'run'
                  ? 'Loading and generating…'
                  : 'Testing cancellation…'}
            </AppText>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.logCard,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.logHeader}>
          <AppText variant="label">Run log</AppText>
          <AppButton
            label="Clear"
            size="small"
            variant="ghost"
            onPress={() => setLogs([])}
            disabled={busy !== null}
          />
        </View>
        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          <AppText
            variant="caption"
            color={theme.colors.textSecondary}
            selectable
          >
            {logs.length > 0 ? logs.join('\n') : 'No smoke-test run yet.'}
          </AppText>
        </ScrollView>
      </View>
    </Screen>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  field: {
    gap: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 180,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logScroll: {
    maxHeight: 320,
  },
});
