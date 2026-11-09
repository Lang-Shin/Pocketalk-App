import type { AppColors } from '@/theme';

/**
 * A single padding adjustment keeps the composer above the Android keyboard.
 * With windowSoftInputMode=adjustResize the measured overlap usually settles
 * to zero, so this does not add a second offset on top of the resized window.
 */
export const ASSISTANT_KEYBOARD_BEHAVIOR = 'padding' as const;

export function isAssistantSendEnabled(
  input: string,
  isResponding: boolean,
): boolean {
  return input.trim().length > 0 && !isResponding;
}

export function assistantInputPalette(
  colors: Pick<
    AppColors,
    'text' | 'textTertiary' | 'primary' | 'surface'
  >,
) {
  return {
    text: colors.text,
    placeholder: colors.textTertiary,
    selection: colors.primary,
    cursor: colors.primary,
  };
}
