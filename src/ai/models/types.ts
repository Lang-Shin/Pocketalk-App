export type ModelRuntimeId = 'executorch' | 'llama_rn' | 'litert_lm';

export type ModelFormat = 'pte' | 'gguf' | 'litertlm';

export type ModelSelectionStatus =
  | 'candidate'
  | 'experimental'
  | 'approved'
  | 'rejected';

export type ArtifactSizeStatus = 'documented-approximate' | 'verified';

export type DevicePerformanceStatus = 'unverified' | 'measured';

export type StructuredOutputSupport =
  | 'prompt-and-parse'
  | 'runtime-grammar';

export type StructuredOutputValidationStatus =
  | 'unvalidated'
  | 'validated';

export type GeneralDeviceCompatibility =
  | 'unverified'
  | 'device-specific'
  | 'verified';

export interface ModelArtifact {
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface ModelVerification {
  status: 'smoke-tested';
  device: string;
  androidVersion: string;
  abi: string;
  physicalRamBytes: number;
  generalDeviceCompatibility: GeneralDeviceCompatibility;
  scope: readonly string[];
}

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
  backend?: string;
  quantization: string;
  structuredOutputSupport: StructuredOutputSupport;
  structuredOutputValidationStatus?: StructuredOutputValidationStatus;
  artifactSizeBytes: number;
  artifactSizeStatus: ArtifactSizeStatus;
  devicePerformanceStatus: DevicePerformanceStatus;
  recommendedContextLength: number;
  maxContextLength: number;
  minimumPhysicalRamBytes: number;
  minimumFreeStorageBytes: number;
  license: string;
  source: string;
  sourceRevision?: string;
  tokenizer?: ModelArtifact;
  tokenizerConfig?: ModelArtifact;
  verification?: ModelVerification;
  selectionStatus: ModelSelectionStatus;
  distribution: ModelDistributionPolicy;
}

export interface ModelManifestEvaluation {
  compatible: boolean;
  installable: boolean;
  productionReady: boolean;
  issues: string[];
}
