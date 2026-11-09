import type { ResponsePresentation } from '@/features/assistant/responsePresentation';
import { parsePesoToMinor } from '@/lib/money';

export interface ContainerSaveResult {
  ok: boolean;
  message?: string;
}

export type ContainerCreationCallbacks = {
  onStart: () => void;
  onSuccess: (result: ContainerSaveResult) => void;
  onError: (message: string) => void;
  onFinish: () => void;
  onValidationError: (message: string) => void;
};

export function parseContainerLimit(
  text: string,
): { ok: true; limitMinor: number } | { ok: false; message: string } {
  if (!text.trim()) return { ok: true, limitMinor: 0 };
  const limitMinor = parsePesoToMinor(text);
  if (limitMinor === null) {
    return {
      ok: false,
      message: 'Enter a valid monthly limit, such as 1200 or 1200.50.',
    };
  }
  return { ok: true, limitMinor };
}

/**
 * Runs creation through the shared presentation coordinator. Validation and
 * duplicate guards fail before onStart, so no loading indicator appears for
 * invalid or already-pending submissions. The database operation itself is
 * never delayed internally.
 */
export async function presentContainerCreation({
  presentation,
  limitText,
  save,
  callbacks,
  minimumMs = 500,
}: {
  presentation: ResponsePresentation;
  limitText: string;
  save: (limitMinor: number) => Promise<ContainerSaveResult>;
  callbacks: ContainerCreationCallbacks;
  minimumMs?: number;
}): Promise<'invalid' | 'busy' | 'accepted'> {
  const limit = parseContainerLimit(limitText);
  if (!limit.ok) {
    callbacks.onValidationError(limit.message);
    return 'invalid';
  }

  let outcome:
    | { kind: 'success'; result: ContainerSaveResult }
    | { kind: 'error'; message: string }
    | null = null;
  let failureMessage: string | undefined;

  const accepted = await presentation.run(
    async () => {
      let result: ContainerSaveResult;
      try {
        result = await save(limit.limitMinor);
      } catch (error) {
        failureMessage =
          error instanceof Error
            ? error.message
            : 'The container could not be created.';
        throw error;
      }
      if (!result.ok) {
        failureMessage = result.message ?? 'The container could not be created.';
        throw new Error(failureMessage);
      }
      return result;
    },
    {
      start: callbacks.onStart,
      success: (result) => {
        outcome = { kind: 'success', result };
      },
      error: () => {
        outcome = {
          kind: 'error',
          message: failureMessage ?? 'The container could not be created.',
        };
      },
      finish: () => {
        callbacks.onFinish();
        if (!outcome) return;
        if (outcome.kind === 'success') callbacks.onSuccess(outcome.result);
        else callbacks.onError(outcome.message);
      },
    },
    minimumMs,
  );

  return accepted ? 'accepted' : 'busy';
}
