import type { ChatMessage, ProfileData } from './models';
import { mockChatThread, mockProfile } from './mockData';

export interface PocketaRepository {
  getAssistantThread: () => Promise<ChatMessage[]>;
  getProfile: () => Promise<ProfileData>;
}

const MOCK_DELAY_MS = 180;

function withMockDelay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_DELAY_MS);
  });
}

export const mockRepository: PocketaRepository = {
  getAssistantThread: () => withMockDelay(mockChatThread),
  getProfile: () => withMockDelay(mockProfile),
};

export const pocketaRepository: PocketaRepository = mockRepository;
