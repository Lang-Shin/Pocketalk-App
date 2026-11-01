import type {
  DeviceCapabilityDecision,
  DeviceCapabilitySnapshot,
  DeviceSupportProfile,
  LocalRuntimeAvailability,
} from './types';

const GIB = 1024 ** 3;

/**
 * Section C evaluation hypotheses only.
 * These are not product support commitments and must be revised with device evidence.
 */
export const DEVICE_PROFILE_THRESHOLDS = {
  minimumPhysicalRamBytes: 4 * GIB,
  typicalPhysicalRamBytes: 6 * GIB,
  higherEndPhysicalRamBytes: 12 * GIB,
  minimumFreeStorageBytes: 3 * GIB,
  minimumAndroidApiLevel: 26,
  requiredAbi: 'arm64-v8a',
} as const;

export function evaluateDeviceCapability(
  snapshot: DeviceCapabilitySnapshot,
): DeviceCapabilityDecision {
  const reasons: string[] = [];

  if (snapshot.platform !== 'android') {
    return unsupported(
      'Local AI evaluation is currently Android-only.',
    );
  }

  if (
    snapshot.androidApiLevel === null ||
    snapshot.androidApiLevel < DEVICE_PROFILE_THRESHOLDS.minimumAndroidApiLevel
  ) {
    return unsupported(
      `Android API level must be at least ${DEVICE_PROFILE_THRESHOLDS.minimumAndroidApiLevel}.`,
    );
  }

  if (!snapshot.supportedAbis.includes(DEVICE_PROFILE_THRESHOLDS.requiredAbi)) {
    return unsupported('The device does not expose the required arm64-v8a ABI.');
  }

  if (
    snapshot.physicalRamBytes <
    DEVICE_PROFILE_THRESHOLDS.minimumPhysicalRamBytes
  ) {
    return unsupported(
      'Physical RAM is below the provisional minimum profile.',
    );
  }

  if (
    snapshot.availableStorageBytes <
    DEVICE_PROFILE_THRESHOLDS.minimumFreeStorageBytes
  ) {
    return unsupported(
      'Available storage is below the provisional minimum profile.',
    );
  }

  const profile = profileForPhysicalRam(snapshot.physicalRamBytes);
  const runtimeState = localRuntimeState(snapshot);
  if (runtimeState !== 'available') {
    reasons.push(
      runtimeState === 'unknown'
        ? 'Local runtime availability is unknown.'
        : 'No compatible local runtime is available.',
    );
    return {
      profile,
      localAi: 'mock_fallback',
      reasons,
    };
  }

  return {
    profile,
    localAi: 'local_candidate',
    reasons: ['Device profile and local runtime availability are sufficient.'],
  };
}

function profileForPhysicalRam(physicalRamBytes: number): DeviceSupportProfile {
  if (
    physicalRamBytes >= DEVICE_PROFILE_THRESHOLDS.higherEndPhysicalRamBytes
  ) {
    return 'higher_end';
  }
  if (physicalRamBytes >= DEVICE_PROFILE_THRESHOLDS.typicalPhysicalRamBytes) {
    return 'typical';
  }
  return 'minimum';
}

function localRuntimeState(
  snapshot: DeviceCapabilitySnapshot,
): LocalRuntimeAvailability {
  const states = [
    snapshot.runtimeAvailability.executorch,
    snapshot.runtimeAvailability.llamaRn,
  ];
  if (states.includes('available')) return 'available';
  if (states.every((state) => state === 'unknown')) return 'unknown';
  return 'unavailable';
}

function unsupported(reason: string): DeviceCapabilityDecision {
  return {
    profile: 'unsupported',
    localAi: 'mock_fallback',
    reasons: [reason],
  };
}
