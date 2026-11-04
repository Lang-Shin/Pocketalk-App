import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODEL_CANDIDATES,
  MODEL_RUNTIME_FORMATS,
  evaluateModelManifest,
  type ModelManifest,
} from '../src/ai/models';

function candidate(): ModelManifest {
  const manifest = MODEL_CANDIDATES[0];
  assert.ok(manifest);
  return structuredClone(manifest);
}

test('candidate models remain data-driven, unbundled, and not installable yet', () => {
  const candidates = MODEL_CANDIDATES.filter(
    (manifest) => manifest.selectionStatus === 'candidate',
  );
  assert.equal(candidates.length >= 2, true);

  for (const manifest of candidates) {
    const evaluation = evaluateModelManifest(manifest);
    assert.equal(manifest.distribution.bundled, false);
    assert.equal(manifest.distribution.requiresUserConsent, true);
    assert.equal(manifest.distribution.requiresChecksum, true);
    assert.equal(manifest.distribution.removable, true);
    assert.equal(manifest.distribution.checksum, null);
    assert.equal(manifest.devicePerformanceStatus, 'unverified');
    assert.equal(evaluation.compatible, true);
    assert.equal(evaluation.installable, false);
    assert.equal(evaluation.productionReady, false);
  }
});

test('tested Qwen2.5-0.5B artifact is experimental and device-specific', () => {
  const manifest = MODEL_CANDIDATES.find(
    (candidate) => candidate.id === 'qwen2.5-0.5b-executorch-xnnpack-8da4w',
  );
  assert.ok(manifest);

  assert.equal(manifest.selectionStatus, 'experimental');
  assert.equal(manifest.runtime, 'executorch');
  assert.equal(manifest.format, 'pte');
  assert.equal(manifest.backend, 'xnnpack');
  assert.equal(manifest.artifactSizeBytes, 432_176_000);
  assert.equal(manifest.artifactSizeStatus, 'verified');
  assert.equal(
    manifest.distribution.checksum,
    '8dc973a97af3f8551b47790b743ade2cd18d1102e619f67105435646821bc4ea',
  );
  assert.equal(manifest.tokenizer?.fileName, 'tokenizer.json');
  assert.equal(manifest.tokenizer?.sizeBytes, 7_031_645);
  assert.equal(
    manifest.tokenizer?.sha256,
    'c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539',
  );
  assert.equal(
    manifest.tokenizerConfig?.fileName,
    'tokenizer_config.json',
  );
  assert.equal(manifest.tokenizerConfig?.sizeBytes, 7_305);
  assert.equal(
    manifest.tokenizerConfig?.sha256,
    '5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583',
  );
  assert.equal(
    manifest.sourceRevision,
    'ddc28846631f7ab1d3ffcae0e076cd7ef0061f39',
  );
  assert.equal(manifest.structuredOutputValidationStatus, 'unvalidated');
  assert.equal(manifest.verification?.device, 'OPPO CPH2359');
  assert.equal(manifest.verification?.androidVersion, '14');
  assert.equal(manifest.verification?.abi, 'arm64');
  assert.equal(manifest.verification?.physicalRamBytes, 8 * 1024 ** 3);
  assert.equal(
    manifest.verification?.generalDeviceCompatibility,
    'device-specific',
  );

  const evaluation = evaluateModelManifest(manifest);
  assert.equal(evaluation.installable, false);
  assert.equal(evaluation.productionReady, false);
  assert.equal(
    evaluation.issues.some((issue) =>
      issue.includes('Experimental model is not approved'),
    ),
    true,
  );
  assert.equal(
    evaluation.issues.some((issue) =>
      issue.includes('Structured-output intent quality is unvalidated'),
    ),
    true,
  );
  assert.equal(
    evaluation.issues.some((issue) =>
      issue.includes('only the recorded test device is evidenced'),
    ),
    true,
  );
});

test('unsupported runtime and format combinations are rejected', () => {
  const mismatched = candidate();
  mismatched.format = 'gguf';

  const result = evaluateModelManifest(mismatched);
  assert.equal(result.compatible, false);
  assert.equal(result.installable, false);
  assert.equal(
    result.issues.some((issue) => issue.includes('does not support format')),
    true,
  );

  const unsupportedRuntime = candidate();
  unsupportedRuntime.runtime = 'litert_lm';
  unsupportedRuntime.format = 'litertlm';

  const runtimeResult = evaluateModelManifest(unsupportedRuntime);
  assert.equal(runtimeResult.compatible, false);
  assert.equal(MODEL_RUNTIME_FORMATS.litert_lm.length, 0);
});

test('distribution safety requirements block installability', () => {
  const bundled = candidate();
  bundled.distribution.bundled = true;
  assert.equal(evaluateModelManifest(bundled).compatible, false);

  const noConsent = candidate();
  noConsent.distribution.requiresUserConsent = false;
  assert.equal(evaluateModelManifest(noConsent).compatible, false);

  const noChecksumPolicy = candidate();
  noChecksumPolicy.distribution.requiresChecksum = false;
  assert.equal(evaluateModelManifest(noChecksumPolicy).compatible, false);

  const notRemovable = candidate();
  notRemovable.distribution.removable = false;
  assert.equal(evaluateModelManifest(notRemovable).compatible, false);

  const noLicense = candidate();
  noLicense.license = '';
  assert.equal(evaluateModelManifest(noLicense).compatible, false);

  const insufficientStorage = candidate();
  insufficientStorage.minimumFreeStorageBytes =
    insufficientStorage.artifactSizeBytes - 1;
  assert.equal(evaluateModelManifest(insufficientStorage).compatible, false);
});

test('checksum presence controls installability and approval controls production readiness', () => {
  const checksummed = candidate();
  checksummed.distribution.checksum = 'a'.repeat(64);

  const candidateEvaluation = evaluateModelManifest(checksummed);
  assert.equal(candidateEvaluation.compatible, true);
  assert.equal(candidateEvaluation.installable, true);
  assert.equal(candidateEvaluation.productionReady, false);

  const invalidChecksum = candidate();
  invalidChecksum.distribution.checksum = 'not-a-sha256';
  assert.equal(evaluateModelManifest(invalidChecksum).compatible, false);

  const approvedUnmeasured = candidate();
  approvedUnmeasured.distribution.checksum = 'b'.repeat(64);
  approvedUnmeasured.selectionStatus = 'approved';
  const unmeasuredEvaluation = evaluateModelManifest(approvedUnmeasured);
  assert.equal(unmeasuredEvaluation.installable, true);
  assert.equal(unmeasuredEvaluation.productionReady, false);

  const approvedMeasured = candidate();
  approvedMeasured.distribution.checksum = 'b'.repeat(64);
  approvedMeasured.selectionStatus = 'approved';
  approvedMeasured.devicePerformanceStatus = 'measured';
  const measuredEvaluation = evaluateModelManifest(approvedMeasured);
  assert.equal(measuredEvaluation.installable, true);
  assert.equal(measuredEvaluation.productionReady, true);
});

test('invalid model metadata is rejected', () => {
  const invalidSize = candidate();
  invalidSize.artifactSizeBytes = 0;
  assert.equal(evaluateModelManifest(invalidSize).compatible, false);

  const invalidContext = candidate();
  invalidContext.recommendedContextLength =
    invalidContext.maxContextLength + 1;
  assert.equal(evaluateModelManifest(invalidContext).compatible, false);

  const invalidRam = candidate();
  invalidRam.minimumPhysicalRamBytes = 0;
  assert.equal(evaluateModelManifest(invalidRam).compatible, false);
});
