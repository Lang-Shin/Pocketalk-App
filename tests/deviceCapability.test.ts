import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEVICE_PROFILE_THRESHOLDS,
  evaluateDeviceCapability,
  type DeviceCapabilityDetector,
  type DeviceCapabilitySnapshot,
} from '../src/ai/device';

const GIB = 1024 ** 3;

function snapshot(
  overrides: Partial<DeviceCapabilitySnapshot> = {},
): DeviceCapabilitySnapshot {
  return {
    platform: 'android',
    androidApiLevel: 34,
    supportedAbis: ['arm64-v8a'],
    physicalRamBytes: 8 * GIB,
    availableStorageBytes: 16 * GIB,
    runtimeAvailability: {
      executorch: 'available',
      llamaRn: 'unknown',
    },
    ...overrides,
  };
}

test('device profiles use the provisional physical RAM boundaries', () => {
  const minimum = evaluateDeviceCapability(
    snapshot({ physicalRamBytes: 4 * GIB }),
  );
  assert.equal(minimum.profile, 'minimum');
  assert.equal(minimum.localAi, 'local_candidate');

  const typical = evaluateDeviceCapability(
    snapshot({ physicalRamBytes: 6 * GIB }),
  );
  assert.equal(typical.profile, 'typical');

  const higherEnd = evaluateDeviceCapability(
    snapshot({ physicalRamBytes: 12 * GIB }),
  );
  assert.equal(higherEnd.profile, 'higher_end');

  const belowMinimum = evaluateDeviceCapability(
    snapshot({ physicalRamBytes: 4 * GIB - 1 }),
  );
  assert.equal(belowMinimum.profile, 'unsupported');
  assert.equal(belowMinimum.localAi, 'mock_fallback');
});

test('unsupported devices fall back to mock mode', () => {
  const unsupportedProfiles = [
    snapshot({ platform: 'ios' }),
    snapshot({ androidApiLevel: 25 }),
    snapshot({ supportedAbis: ['armeabi-v7a'] }),
    snapshot({ physicalRamBytes: 3 * GIB }),
    snapshot({ availableStorageBytes: 2 * GIB }),
  ];

  for (const device of unsupportedProfiles) {
    const decision = evaluateDeviceCapability(device);
    assert.equal(decision.profile, 'unsupported');
    assert.equal(decision.localAi, 'mock_fallback');
    assert.equal(decision.reasons.length > 0, true);
  }
});

test('virtual RAM never raises the physical capability profile', () => {
  const lowPhysical = evaluateDeviceCapability(
    snapshot({
      physicalRamBytes: 3 * GIB,
      virtualRamBytes: 8 * GIB,
    }),
  );
  assert.equal(lowPhysical.profile, 'unsupported');

  const exactMinimum = evaluateDeviceCapability(
    snapshot({
      physicalRamBytes: DEVICE_PROFILE_THRESHOLDS.minimumPhysicalRamBytes,
      virtualRamBytes: 8 * GIB,
    }),
  );
  assert.equal(exactMinimum.profile, 'minimum');
});

test('runtime availability controls local candidate versus mock fallback', () => {
  const unknown = evaluateDeviceCapability(
    snapshot({
      runtimeAvailability: {
        executorch: 'unknown',
        llamaRn: 'unknown',
      },
    }),
  );
  assert.equal(unknown.profile, 'typical');
  assert.equal(unknown.localAi, 'mock_fallback');

  const unavailable = evaluateDeviceCapability(
    snapshot({
      runtimeAvailability: {
        executorch: 'unavailable',
        llamaRn: 'unavailable',
      },
    }),
  );
  assert.equal(unavailable.localAi, 'mock_fallback');

  const executorchAvailable = evaluateDeviceCapability(
    snapshot({
      runtimeAvailability: {
        executorch: 'available',
        llamaRn: 'unavailable',
      },
    }),
  );
  assert.equal(executorchAvailable.localAi, 'local_candidate');

  const llamaAvailable = evaluateDeviceCapability(
    snapshot({
      runtimeAvailability: {
        executorch: 'unavailable',
        llamaRn: 'available',
      },
    }),
  );
  assert.equal(llamaAvailable.localAi, 'local_candidate');
});

test('capability detection is injectable and evaluation is deterministic', async () => {
  const detector: DeviceCapabilityDetector = {
    async detect() {
      return snapshot();
    },
  };

  const first = evaluateDeviceCapability(await detector.detect());
  const second = evaluateDeviceCapability(await detector.detect());

  assert.deepEqual(first, second);
  assert.equal(first.profile, 'typical');
  assert.equal(first.localAi, 'local_candidate');
});
