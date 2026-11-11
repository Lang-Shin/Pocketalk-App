import type { AppColors } from '@/theme';

/**
 * The app is edge-to-edge, so Android's adjustResize does not shrink this
 * React Native viewport on the tested device. KeyboardAvoidingView measures
 * the actual frame overlap, adding no offset when a viewport is already resized.
 * The safe-area top is the KAV's screen offset inside Screen.
 */
export function assistantKeyboardConfig(platform: string, topInset = 0) {
  const enabled = platform !== 'web';
  return {
    enabled,
    behavior: enabled ? 'padding' as const : undefined,
    keyboardVerticalOffset: platform === 'android' ? topInset : 0,
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
