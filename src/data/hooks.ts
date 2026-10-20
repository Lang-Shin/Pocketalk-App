import { useCallback, useEffect, useState } from 'react';

import type { ChatMessage, ProfileData } from './models';
import { pocketaRepository } from './repository';

export type QueryStatus = 'loading' | 'success' | 'error';

export interface QueryResult<T> {
  status: QueryStatus;
  data: T | null;
  error: Error | null;
  retry: () => void;
}

export function useRepositoryQuery<T>(
  load: () => Promise<T>,
): QueryResult<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<QueryResult<T>, 'retry'>>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    Promise.resolve()
      .then(load)
      .then((data) => {
        if (active) {
          setState({ status: 'success', data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            data: null,
            error:
              error instanceof Error
                ? error
                : new Error('Something went wrong while loading this screen.'),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, load]);

  const retry = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    setAttempt((current) => current + 1);
  }, []);

  return { ...state, retry };
}

export function useAssistantThread(): QueryResult<ChatMessage[]> {
  return useRepositoryQuery(pocketaRepository.getAssistantThread);
}

export function useProfileData(): QueryResult<ProfileData> {
  return useRepositoryQuery(pocketaRepository.getProfile);
}
