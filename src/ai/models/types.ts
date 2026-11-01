export type ModelRuntimeId = 'executorch' | 'llama_rn' | 'litert_lm';

export type ModelFormat = 'pte' | 'gguf' | 'litertlm';

export type ModelSelectionStatus = 'candidate' | 'approved' | 'rejected';

export type ArtifactSizeStatus = 'documented-approximate' | 'verified';

export type DevicePerformanceStatus = 'unverified' | 'measured';

export type StructuredOutputSupport =
  | 'prompt-and-parse'
  | 'runtime-grammar';

export interface ModelDistributionPolicy {
  bundled: boolean;
  requiresUserConsent: boolean;
  requiresChecksum: boolean;
  checksum: string | null;
  removable: boolean;
}

export interface ModelManifest {
  id: string;
  displayName: string;
  family: string;
  parametersBillions: number;
  runtime: ModelRuntimeId;
  format: ModelFormat;
  quantization: string;
  structuredOutputSupport: StructuredOutputSupport;
  artifactSizeBytes: number;
  artifactSizeStatus: ArtifactSizeStatus;
  devicePerformanceStatus: DevicePerformanceStatus;
  recommendedContextLength: number;
  maxContextLength: number;
  minimumPhysicalRamBytes: number;
  minimumFreeStorageBytes: number;
  license: string;
  source: string;
  selectionStatus: ModelSelectionStatus;
  distribution: ModelDistributionPolicy;
}

export interface ModelManifestEvaluation {
  compatible: boolean;
  installable: boolean;
  productionReady: boolean;
  issues: string[];
}
