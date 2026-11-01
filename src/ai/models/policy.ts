import type {
  ModelFormat,
  ModelManifest,
  ModelManifestEvaluation,
  ModelRuntimeId,
} from './types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export const MODEL_RUNTIME_FORMATS: Record<
  ModelRuntimeId,
  readonly ModelFormat[]
> = {
  executorch: ['pte'],
  llama_rn: ['gguf'],
  litert_lm: [],
};

export function evaluateModelManifest(
  manifest: ModelManifest,
): ModelManifestEvaluation {
  const issues: string[] = [];
  const runtimeFormats = MODEL_RUNTIME_FORMATS[manifest.runtime];

  if (!manifest.id.trim()) issues.push('Model id is required.');
  if (!manifest.displayName.trim()) issues.push('Display name is required.');
  if (!manifest.family.trim()) issues.push('Model family is required.');
  if (
    !Number.isFinite(manifest.parametersBillions) ||
    manifest.parametersBillions <= 0
  ) {
    issues.push('Parameter count must be positive.');
  }
  if (!runtimeFormats || !runtimeFormats.includes(manifest.format)) {
    issues.push(
      `Runtime ${manifest.runtime} does not support format ${manifest.format}.`,
    );
  }
  if (
    !Number.isSafeInteger(manifest.artifactSizeBytes) ||
    manifest.artifactSizeBytes <= 0
  ) {
    issues.push('Artifact size must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(manifest.minimumFreeStorageBytes) ||
    manifest.minimumFreeStorageBytes < manifest.artifactSizeBytes
  ) {
    issues.push('Free storage must cover the artifact size.');
  }
  if (
    !Number.isSafeInteger(manifest.minimumPhysicalRamBytes) ||
    manifest.minimumPhysicalRamBytes <= 0
  ) {
    issues.push('Minimum physical RAM must be positive.');
  }
  if (
    !Number.isSafeInteger(manifest.recommendedContextLength) ||
    manifest.recommendedContextLength <= 0 ||
    !Number.isSafeInteger(manifest.maxContextLength) ||
    manifest.recommendedContextLength > manifest.maxContextLength
  ) {
    issues.push('Context length configuration is invalid.');
  }
  if (!manifest.license.trim()) issues.push('License is required.');
  if (!manifest.source.trim()) issues.push('Model source is required.');
  if (manifest.distribution.bundled) {
    issues.push('Models must not be bundled in the app binary.');
  }
  if (!manifest.distribution.requiresUserConsent) {
    issues.push('Explicit user consent is required before download.');
  }
  if (!manifest.distribution.requiresChecksum) {
    issues.push('Checksum verification is required.');
  }
  if (!manifest.distribution.removable) {
    issues.push('The model must be removable by the user.');
  }
  if (
    manifest.distribution.checksum !== null &&
    !SHA256_PATTERN.test(manifest.distribution.checksum)
  ) {
    issues.push('Checksum must be a SHA-256 hex digest.');
  }

  const compatible =
    issues.length === 0 &&
    manifest.runtime !== 'litert_lm' &&
    manifest.selectionStatus !== 'rejected';

  if (manifest.distribution.checksum === null) {
    issues.push('Checksum is not verified; the model is evaluation-only.');
  }
  if (manifest.selectionStatus === 'candidate') {
    issues.push('Candidate model is not approved for production.');
  }
  if (manifest.selectionStatus === 'rejected') {
    issues.push('Rejected model cannot be installed.');
  }
  if (manifest.devicePerformanceStatus !== 'measured') {
    issues.push('Device performance is unverified; the model is not production-ready.');
  }

  const installable =
    compatible &&
    manifest.selectionStatus !== 'rejected' &&
    manifest.distribution.checksum !== null;

  return {
    compatible,
    installable,
    productionReady:
      installable &&
      manifest.selectionStatus === 'approved' &&
      manifest.devicePerformanceStatus === 'measured',
    issues,
  };
}
