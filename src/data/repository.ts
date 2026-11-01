import type { ProfileData } from './models';
import { mockProfile } from './mockData';

export interface PocketaRepository {
  getProfile: () => Promise<ProfileData>;
}

const MOCK_DELAY_MS = 180;

function withMockDelay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_DELAY_MS);
  });
}

export const mockRepository: PocketaRepository = {
  getProfile: () => withMockDelay(mockProfile),
};

export const pocketaRepository: PocketaRepository = mockRepository;
