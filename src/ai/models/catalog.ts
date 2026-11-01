import type { ModelManifest } from './types';

const GIB = 1024 ** 3;

export const MODEL_CANDIDATES = [
  {
    id: 'qwen2.5-1.5b-executorch-xnnpack-8da4w',
    displayName: 'Qwen2.5-1.5B-Instruct · ExecuTorch XNNPACK 8da4w',
    family: 'Qwen2.5',
    parametersBillions: 1.54,
    runtime: 'executorch',
    format: 'pte',
    quantization: '8da4w',
    structuredOutputSupport: 'prompt-and-parse',
    artifactSizeBytes: Math.round(1.1 * GIB),
    artifactSizeStatus: 'documented-approximate',
    devicePerformanceStatus: 'unverified',
    recommendedContextLength: 4096,
    maxContextLength: 16384,
    minimumPhysicalRamBytes: 4 * GIB,
    minimumFreeStorageBytes: 3 * GIB,
    license: 'Apache-2.0',
    source:
      'https://huggingface.co/software-mansion/Qwen2.5-ExecuTorch',
    selectionStatus: 'candidate',
    distribution: {
      bundled: false,
      requiresUserConsent: true,
      requiresChecksum: true,
      checksum: null,
      removable: true,
    },
  },
  {
    id: 'qwen2.5-1.5b-llama-rn-q4-k-m',
    displayName: 'Qwen2.5-1.5B-Instruct · llama.rn Q4_K_M',
    family: 'Qwen2.5',
    parametersBillions: 1.54,
    runtime: 'llama_rn',
    format: 'gguf',
    quantization: 'Q4_K_M',
    structuredOutputSupport: 'runtime-grammar',
    artifactSizeBytes: 1 * GIB,
    artifactSizeStatus: 'documented-approximate',
    devicePerformanceStatus: 'unverified',
    recommendedContextLength: 4096,
    maxContextLength: 32768,
    minimumPhysicalRamBytes: 4 * GIB,
    minimumFreeStorageBytes: 3 * GIB,
    license: 'Apache-2.0',
    source:
      'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct',
    selectionStatus: 'candidate',
    distribution: {
      bundled: false,
      requiresUserConsent: true,
      requiresChecksum: true,
      checksum: null,
      removable: true,
    },
  },
] as const satisfies readonly ModelManifest[];
