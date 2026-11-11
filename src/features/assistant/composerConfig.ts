import type { AppColors } from '@/theme';

/** Android's adjustResize owns IME layout; never add a second keyboard offset. */
export function assistantKeyboardConfig(platform: string) {
  return {
    enabled: platform === 'ios',
    behavior: platform === 'ios' ? 'padding' as const : undefined,
  };
}

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
