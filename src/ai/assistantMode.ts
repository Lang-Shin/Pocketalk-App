import {
  createAssistantProvider,
  ValidatedAssistantProvider,
  type AssistantProvider,
} from './providers';

export type AssistantMode = 'offline' | 'online';

export type AssistantModeAvailability = 'available' | 'coming_soon';

export interface AssistantModeOption {
  mode: AssistantMode;
  label: string;
  availability: AssistantModeAvailability;
  statusLabel: string;
  description: string;
}

export interface AvailableAssistantModeSelection {
  mode: 'offline';
  status: 'available';
  provider: AssistantProvider;
}

export interface UnavailableAssistantModeSelection {
  mode: 'online';
  status: 'unavailable';
  provider: null;
  message: string;
}

export type AssistantModeSelection =
  | AvailableAssistantModeSelection
  | UnavailableAssistantModeSelection;

export interface SelectAssistantModeOptions {
  createOfflineProvider?: () => AssistantProvider;
}

export const DEFAULT_ASSISTANT_MODE = 'offline' as const;

export const ASSISTANT_MODE_OPTIONS: readonly AssistantModeOption[] = [
  {
    mode: 'offline',
    label: 'Offline',
    availability: 'available',
    statusLabel: 'Available',
    description:
      'Deterministic rules on this device. No internet or LLM required.',
  },
  {
    mode: 'online',
    label: 'Online',
    availability: 'coming_soon',
    statusLabel: 'Coming soon',
    description:
      'Future remote LLM mode. Not available in this build.',
  },
];

export function selectAssistantMode(
  mode?: 'offline',
  options?: SelectAssistantModeOptions,
): AvailableAssistantModeSelection;
export function selectAssistantMode(
  mode: 'online',
  options?: SelectAssistantModeOptions,
): UnavailableAssistantModeSelection;
export function selectAssistantMode(
  mode: AssistantMode,
  options?: SelectAssistantModeOptions,
): AssistantModeSelection;
export function selectAssistantMode(
  mode: AssistantMode = DEFAULT_ASSISTANT_MODE,
  options: SelectAssistantModeOptions = {},
): AssistantModeSelection {
  if (mode === 'online') {
    return {
      mode: 'online',
      status: 'unavailable',
      provider: null,
      message:
        'Online mode is not available yet. No provider was activated and no online request was made.',
    };
  }

  const createOfflineProvider =
    options.createOfflineProvider ?? createAssistantProvider;
  const provider = createOfflineProvider();

  if (
    provider.info.kind !== 'offline' ||
    !(provider instanceof ValidatedAssistantProvider)
  ) {
    throw new Error(
      'Offline mode requires a validated OfflineAssistantProvider.',
    );
  }

  return {
    mode: 'offline',
    status: 'available',
    provider,
  };
}
