import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import type { AssistantResult } from '@/ai/localAssistant';
import {
  createLocalAssistantProvider,
  type AssistantProvider,
} from '@/ai/providers';
import { PocketaLocalResponseParser } from '@/ai/providers/localResponseParser';
import { ExecuTorchLocalModelRuntime } from '@/ai/runtime/executorch';
import { AppText } from '@/components/AppText';
import { AppButton } from '@/components/ui/AppButton';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Screen } from '@/components/ui/Screen';
import { EXECUTORCH_SMOKE_MANIFEST } from '@/features/dev/executorchSmokeManifest';
import {
  LOCAL_AI_EVALUATION_CASES,
  LOCAL_AI_EVALUATION_CONTEXT,
  evaluateParserRejection,
  evaluateParsedResult,
  type EvaluationCase,
  type EvaluationOutcome,
} from '@/features/dev/localAiEvaluation';
import {
  InstrumentedLocalModelRuntime,
  InstrumentedPromptBuilder,
  instrumentedCaseMetrics,
  type InstrumentedCaseMetrics,
} from '@/features/dev/localAiInstrumentation';
import {
  MinimalSchemaPromptBuilder,
  MinimalSchemaResponseParser,
} from '@/features/dev/minimalSchemaStrategy';
import { useAppTheme, radii, spacing } from '@/theme';

type EvaluationStrategy = 'production' | 'minimal';

interface EvaluationRun {
  strategy: EvaluationStrategy;
  rawOutput: string;
  parsed: AssistantResult | null;
  parseError: string | null;
  outcome: EvaluationOutcome;
  metrics: InstrumentedCaseMetrics & { totalMs: number };
}

const STRATEGY_LABELS: Record<EvaluationStrategy, string> = {
  production: 'Production prompt',
  minimal: 'Minimal schema A',
};

const LOCAL_EVALUATION_INFO = {
  id: 'local-executorch-evaluation',
  displayName: 'Local ExecuTorch evaluation',
  kind: 'local_llm' as const,
  isRealModel: true,
  modelName: 'Qwen2.5-0.5B-Instruct',
  needsModelDownload: true,
  offline: true,
  description: 'Development-only local structured-output evaluation.',
};

interface EvaluationPaths {
  model: string;
  tokenizer: string;
  tokenizerConfig: string;
}

export default function LocalAiEvaluationScreen() {
  const { theme } = useAppTheme();
  const runtimeRef = useRef<InstrumentedLocalModelRuntime | null>(null);
  const promptBuildersRef = useRef<
    Partial<Record<EvaluationStrategy, InstrumentedPromptBuilder>>
  >({});
  const providersRef = useRef<
    Partial<Record<EvaluationStrategy, AssistantProvider>>
  >({});
  const parserRef = useRef(new PocketaLocalResponseParser());
  const minimalParserRef = useRef(new MinimalSchemaResponseParser());
  const [strategy, setStrategy] =
    useState<EvaluationStrategy>('production');
  const [paths, setPaths] = useState<EvaluationPaths | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, EvaluationRun>>({});
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'android') return;
    let active = true;

    void (async () => {
      const { default: RNBlobUtil } = await import('react-native-blob-util');
      if (!active) return;
      const base = `${
        RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir
      }/${EXECUTORCH_SMOKE_MANIFEST.directory}`;
      setPaths({
        model: `${base}/${EXECUTORCH_SMOKE_MANIFEST.model.fileName}`,
        tokenizer: `${base}/${EXECUTORCH_SMOKE_MANIFEST.tokenizer.fileName}`,
        tokenizerConfig: `${base}/${EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.fileName}`,
      });
    })().catch((error: unknown) => {
      setPathError(errorMessage(error));
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      promptBuildersRef.current = {};
      providersRef.current = {};
      if (runtime) void runtime.unload().catch(() => undefined);
    },
    [],
  );

  if (!__DEV__) {
    return (
      <Screen>
        <PageHeader title="Development only" preview={false} />
        <NoticeBanner
          tone="warning"
          title="Evaluation unavailable"
          message="This route is available only in development builds."
        />
      </Screen>
    );
  }

  if (Platform.OS !== 'android') {
    return (
      <Screen>
        <PageHeader title="Local AI evaluation" preview={false} />
        <NoticeBanner
          tone="warning"
          title="Android only"
          message="This evaluation requires an Android development build."
        />
      </Screen>
    );
  }

  async function verifyArtifacts(currentPaths: EvaluationPaths): Promise<void> {
    const { default: RNBlobUtil } = await import('react-native-blob-util');
    const artifacts = [
      {
        label: 'model',
        path: currentPaths.model,
        bytes: EXECUTORCH_SMOKE_MANIFEST.model.bytes,
        sha256: EXECUTORCH_SMOKE_MANIFEST.model.sha256,
      },
      {
        label: 'tokenizer',
        path: currentPaths.tokenizer,
        bytes: EXECUTORCH_SMOKE_MANIFEST.tokenizer.bytes,
        sha256: EXECUTORCH_SMOKE_MANIFEST.tokenizer.sha256,
      },
      {
        label: 'tokenizer config',
        path: currentPaths.tokenizerConfig,
        bytes: EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.bytes,
        sha256: EXECUTORCH_SMOKE_MANIFEST.tokenizerConfig.sha256,
      },
    ];

    for (const artifact of artifacts) {
      if (!(await RNBlobUtil.fs.exists(artifact.path))) {
        throw new Error(`${artifact.label} file is missing: ${artifact.path}`);
      }
      const stat = await RNBlobUtil.fs.stat(artifact.path);
      if (stat.size !== artifact.bytes) {
        throw new Error(
          `${artifact.label} size mismatch: expected ${artifact.bytes}, got ${stat.size}`,
        );
      }
      const actualHash = (
        await RNBlobUtil.fs.hash(artifact.path, 'sha256')
      ).toLowerCase();
      if (actualHash !== artifact.sha256) {
        throw new Error(
          `${artifact.label} SHA-256 mismatch: expected ${artifact.sha256}, got ${actualHash}`,
        );
      }
    }
  }

  function ensureProvider(
    currentPaths: EvaluationPaths,
    selectedStrategy: EvaluationStrategy,
  ): {
    runtime: InstrumentedLocalModelRuntime;
    promptBuilder: InstrumentedPromptBuilder;
    provider: AssistantProvider;
  } {
    const runtime =
      runtimeRef.current ??
      new InstrumentedLocalModelRuntime(
        new ExecuTorchLocalModelRuntime({
          modelPath: currentPaths.model,
          tokenizerPath: currentPaths.tokenizer,
          tokenizerConfigPath: currentPaths.tokenizerConfig,
          maxNewTokens: 512,
          temperature: 0.1,
        }),
      );
    runtimeRef.current = runtime;

    const existingProvider = providersRef.current[selectedStrategy];
    const existingBuilder = promptBuildersRef.current[selectedStrategy];
    if (existingProvider && existingBuilder) {
      return {
        runtime,
        promptBuilder: existingBuilder,
        provider: existingProvider,
      };
    }

    const promptBuilder = new InstrumentedPromptBuilder(
      selectedStrategy === 'minimal'
        ? { delegate: new MinimalSchemaPromptBuilder() }
        : {},
    );
    const provider = createLocalAssistantProvider(runtime, {
      info: LOCAL_EVALUATION_INFO,
      promptBuilder,
      responseParser:
        selectedStrategy === 'minimal'
          ? new MinimalSchemaResponseParser()
          : undefined,
    });
    promptBuildersRef.current[selectedStrategy] = promptBuilder;
    providersRef.current[selectedStrategy] = provider;
    return { runtime, promptBuilder, provider };
  }

  async function executeCase(
    testCase: EvaluationCase,
    currentPaths: EvaluationPaths,
    selectedStrategy: EvaluationStrategy,
  ): Promise<EvaluationRun> {
    const caseStartedAt = currentTimeMs();

    if (testCase.syntheticRaw !== undefined) {
      const parser =
        selectedStrategy === 'minimal'
          ? minimalParserRef.current
          : parserRef.current;
      try {
        const parsed = parser.parse(
          { text: testCase.syntheticRaw },
          LOCAL_AI_EVALUATION_CONTEXT,
        );
        const outcome = evaluateParsedResult(testCase, parsed);
        return {
          strategy: selectedStrategy,
          rawOutput: testCase.syntheticRaw,
          parsed,
          parseError: null,
          outcome: {
            ...outcome,
            passed: false,
            summary:
              'Expected parser rejection, but the parser accepted the output.',
          },
          metrics: emptyCaseMetrics(currentTimeMs() - caseStartedAt),
        };
      } catch (error) {
        return {
          strategy: selectedStrategy,
          rawOutput: testCase.syntheticRaw,
          parsed: null,
          parseError: errorMessage(error),
          outcome: evaluateParserRejection(error),
          metrics: emptyCaseMetrics(currentTimeMs() - caseStartedAt),
        };
      }
    }

    const { runtime, promptBuilder, provider } = ensureProvider(
      currentPaths,
      selectedStrategy,
    );
    runtime.resetCase();
    promptBuilder.resetCase();

    let parsed: AssistantResult | null = null;
    let parseError: string | null = null;
    let outcome: EvaluationOutcome;
    let rawOutput = '';

    try {
      const result = await provider.interpret(
        testCase.message,
        LOCAL_AI_EVALUATION_CONTEXT,
      );
      rawOutput = runtime.lastResponse?.text ?? '';
      parsed = result;
      outcome = evaluateParsedResult(testCase, result);
    } catch (error) {
      rawOutput = runtime.lastResponse?.text ?? '';
      parseError = errorMessage(error);
      outcome = {
        passed: false,
        checks: {
          schemaValid: false,
          kindCorrect: false,
          intentCorrect: null,
          amountCorrect: null,
          entitiesCorrect: null,
          dateCorrect: null,
          missingFieldsCorrect: null,
          unsupportedHandled: false,
          semanticFaithful: false,
        },
        summary: `Provider or parser rejected model output: ${parseError}`,
      };
    }

    try {
      await provider.unload();
    } catch (error) {
      if (!parseError) {
        parseError = `Unload failed after generation: ${errorMessage(error)}`;
      }
    }

    return {
      strategy: selectedStrategy,
      rawOutput,
      parsed,
      parseError,
      outcome,
      metrics: {
        ...instrumentedCaseMetrics(runtime, promptBuilder),
        totalMs: currentTimeMs() - caseStartedAt,
      },
    };
  }

  async function runOne(testCase: EvaluationCase): Promise<void> {
    if (running) return;
    if (!paths) {
      setPathError('Model paths are still resolving.');
      return;
    }
    setRunning(testCase.id);
    setPathError(null);
    try {
      await verifyArtifacts(paths);
      const run = await executeCase(testCase, paths, strategy);
      setRuns((current) => ({
        ...current,
        [`${strategy}:${testCase.id}`]: run,
      }));
    } catch (error) {
      setPathError(errorMessage(error));
    } finally {
      setRunning(null);
    }
  }

  async function runAll(
    selectedStrategies: readonly EvaluationStrategy[] = [strategy],
  ): Promise<void> {
    if (running || !paths) return;
    setRunning('all');
    setPathError(null);
    try {
      await verifyArtifacts(paths);
      for (const selected of selectedStrategies) {
        for (const testCase of LOCAL_AI_EVALUATION_CASES) {
          const run = await executeCase(testCase, paths, selected);
          setRuns((current) => ({
            ...current,
            [`${selected}:${testCase.id}`]: run,
          }));
        }
      }
    } catch (error) {
      setPathError(errorMessage(error));
    } finally {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      promptBuildersRef.current = {};
      providersRef.current = {};
      if (runtime) await runtime.unload().catch(() => undefined);
      setRunning(null);
    }
  }

  async function exportResults(): Promise<void> {
    if (running || Object.keys(runs).length === 0) return;
    try {
      const { default: RNBlobUtil } = await import('react-native-blob-util');
      const base =
        RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir;
      const path = `${base}/pocketa-local-ai-eval-${currentTimeMs()}.json`;
      await RNBlobUtil.fs.writeFile(
        path,
        JSON.stringify(
          {
            exportedAt: currentIsoTime(),
            model: EXECUTORCH_SMOKE_MANIFEST,
            context: LOCAL_AI_EVALUATION_CONTEXT,
            cases: LOCAL_AI_EVALUATION_CASES,
            runs,
          },
          null,
          2,
        ),
        'utf8',
      );
      setExportPath(path);
    } catch (error) {
      setPathError(errorMessage(error));
    }
  }

  const completed = Object.values(runs).filter(
    (run) => run.strategy === strategy,
  );
  const passed = completed.filter((run) => run.outcome.passed).length;

  return (
    <Screen scroll={false}>
      <PageHeader
        title="Local AI evaluation"
        subtitle="Experimental Qwen2.5-0.5B structured-output evaluation. No finance access."
        preview={false}
      />
      <NoticeBanner
        tone="warning"
        title="Experimental model"
        message="This development-only harness evaluates raw model output and semantic faithfulness. It never creates, confirms, or executes a transaction. The model remains non-production."
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <AppText variant="label">Pinned artifacts</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {paths?.model ?? 'Resolving model path.'}
          </AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {paths?.tokenizer ?? 'Resolving tokenizer path.'}
          </AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {paths?.tokenizerConfig ?? 'Resolving tokenizer config path.'}
          </AppText>
          {pathError ? (
            <AppText variant="caption" color={theme.colors.warning}>
              {pathError}
            </AppText>
          ) : null}
          <AppText variant="micro" color={theme.colors.textTertiary}>
            STRATEGY
          </AppText>
          <View style={styles.actions}>
            <AppButton
              label={STRATEGY_LABELS.production}
              size="small"
              variant={strategy === 'production' ? 'primary' : 'outline'}
              onPress={() => setStrategy('production')}
              disabled={running !== null}
            />
            <AppButton
              label={STRATEGY_LABELS.minimal}
              size="small"
              variant={strategy === 'minimal' ? 'primary' : 'outline'}
              onPress={() => setStrategy('minimal')}
              disabled={running !== null}
            />
          </View>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            Completed: {completed.length} / {LOCAL_AI_EVALUATION_CASES.length};
            passed: {passed}
          </AppText>
          <View style={styles.actions}>
            <AppButton
              label={
                running === 'all'
                  ? 'Running'
                  : `Run ${STRATEGY_LABELS[strategy]}`
              }
              onPress={() => void runAll([strategy])}
              disabled={running !== null || !paths}
              icon="play"
            />
            <AppButton
              label="Run comparison"
              variant="outline"
              onPress={() => void runAll(['production', 'minimal'])}
              disabled={running !== null || !paths}
              icon="analytics"
            />
            <AppButton
              label="Export results"
              variant="outline"
              onPress={() => void exportResults()}
              disabled={running !== null || Object.keys(runs).length === 0}
              icon="download"
            />
            <AppButton
              label="Clear results"
              variant="outline"
              onPress={() => setRuns({})}
              disabled={running !== null || Object.keys(runs).length === 0}
              icon="trash"
            />
          </View>
          {exportPath ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              Exported: {exportPath}
            </AppText>
          ) : null}
        </View>

        {LOCAL_AI_EVALUATION_CASES.map((testCase) => {
          const run = runs[`${strategy}:${testCase.id}`];
          return (
            <View
              key={testCase.id}
              style={[
                styles.case,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.caseHeader}>
                <AppText variant="h3">{testCase.title}</AppText>
                <AppText
                  variant="caption"
                  weight="semibold"
                  color={
                    run
                      ? run.outcome.passed
                        ? theme.colors.success
                        : theme.colors.warning
                      : theme.colors.textTertiary
                  }
                >
                  {run ? (run.outcome.passed ? 'PASS' : 'FAIL') : 'NOT RUN'}
                </AppText>
              </View>
              <AppText variant="caption" color={theme.colors.textSecondary}>
                Input: {testCase.message}
              </AppText>
              <AppText variant="caption" color={theme.colors.textSecondary}>
                Expected: {testCase.expectation.description}
              </AppText>
              <AppButton
                label={running === testCase.id ? 'Running' : 'Run case'}
                size="small"
                variant="outline"
                onPress={() => void runOne(testCase)}
                disabled={running !== null || !paths}
              />
              {run ? (
                <View style={styles.result}>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    TIMING
                  </AppText>
                  <AppText variant="caption">
                    load={formatMs(run.metrics.loadMs)} ·
                    prompt={formatMs(run.metrics.promptPreparationMs)} ·
                    generate={formatMs(run.metrics.generationMs)} ·
                    ttft={formatMs(run.metrics.timeToFirstTokenMs)} ·
                    unload={formatMs(run.metrics.unloadMs)} ·
                    total={formatMs(run.metrics.totalMs)}
                  </AppText>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    RUNTIME METRICS
                  </AppText>
                  <AppText variant="caption">
                    promptTokens={String(run.metrics.promptTokens)} ·
                    outputTokens={String(run.metrics.outputTokens)} ·
                    maxTokens={String(run.metrics.maxTokens)} ·
                    outputLimit={run.metrics.outputLimitStatus} ·
                    status={String(run.metrics.runtimeStatusAfterGeneration)}
                  </AppText>
                  <AppText variant="caption" selectable>
                    {run.metrics.generationStats
                      ? JSON.stringify(run.metrics.generationStats)
                      : 'Runtime metrics unavailable.'}
                  </AppText>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    RAW MODEL OUTPUT
                  </AppText>
                  <AppText variant="caption" selectable>
                    {run.rawOutput || '<empty>'}
                  </AppText>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    PARSED RESULT
                  </AppText>
                  <AppText variant="caption" selectable>
                    {run.parsed
                      ? JSON.stringify(run.parsed, null, 2)
                      : run.parseError ?? 'No parsed result.'}
                  </AppText>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    VALIDATION / SEMANTICS
                  </AppText>
                  <AppText variant="caption">
                    schema={String(run.outcome.checks.schemaValid)} ·
                    semantics={String(run.outcome.checks.semanticFaithful)} ·
                    intent={String(run.outcome.checks.intentCorrect)} ·
                    amount={String(run.outcome.checks.amountCorrect)} ·
                    entities={String(run.outcome.checks.entitiesCorrect)} ·
                    date={String(run.outcome.checks.dateCorrect)} ·
                    missing={String(run.outcome.checks.missingFieldsCorrect)} ·
                    unsupported={String(run.outcome.checks.unsupportedHandled)}
                  </AppText>
                  <AppText variant="caption" color={theme.colors.textSecondary}>
                    {run.outcome.summary}
                  </AppText>
                </View>
              ) : null}
            </View>
          );
        })}

        {running === 'all' ? (
          <View style={styles.running}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <AppText variant="caption" color={theme.colors.textSecondary}>
              Running the evaluation suite on the physical device.
            </AppText>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function currentTimeMs(): number {
  return Date.now();
}

function currentIsoTime(): string {
  return new Date(currentTimeMs()).toISOString();
}

function emptyCaseMetrics(
  totalMs: number,
): InstrumentedCaseMetrics & { totalMs: number } {
  return {
    loadMs: null,
    promptPreparationMs: null,
    generationMs: null,
    timeToFirstTokenMs: null,
    unloadMs: null,
    promptTokens: null,
    outputTokens: null,
    runtimeStatusAfterGeneration: null,
    maxTokens: null,
    outputLimitStatus: 'unknown',
    generationStats: null,
    totalMs,
  };
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value} ms`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  case: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  caseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  result: {
    gap: 4,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  running: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
});
