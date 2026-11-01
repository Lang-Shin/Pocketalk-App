export type DevicePlatform = 'android' | 'ios' | 'web' | 'unknown';

export type LocalRuntimeAvailability =
  | 'available'
  | 'unavailable'
  | 'unknown';

export interface DeviceRuntimeAvailability {
  executorch: LocalRuntimeAvailability;
  llamaRn: LocalRuntimeAvailability;
}

export interface DeviceCapabilitySnapshot {
  platform: DevicePlatform;
  androidApiLevel: number | null;
  supportedAbis: string[];
  physicalRamBytes: number;
  /** Reported expansion memory. The policy never treats this as physical RAM. */
  virtualRamBytes?: number;
  availableMemoryBytes?: number;
  availableStorageBytes: number;
  runtimeAvailability: DeviceRuntimeAvailability;
}

export interface DeviceCapabilityDetector {
  detect(): Promise<DeviceCapabilitySnapshot>;
}

export type DeviceSupportProfile =
  | 'unsupported'
  | 'minimum'
  | 'typical'
  | 'higher_end';

export type LocalAiDecision = 'mock_fallback' | 'local_candidate';

export interface DeviceCapabilityDecision {
  profile: DeviceSupportProfile;
  localAi: LocalAiDecision;
  reasons: string[];
}
