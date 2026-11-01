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

test('candidate models are data-driven, unbundled, and not installable yet', () => {
  assert.equal(MODEL_CANDIDATES.length >= 2, true);

  for (const manifest of MODEL_CANDIDATES) {
    const evaluation = evaluateModelManifest(manifest);
    assert.equal(manifest.selectionStatus, 'candidate');
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
