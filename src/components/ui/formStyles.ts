import { StyleSheet } from 'react-native';

import { fontSizes, radii, spacing } from '@/theme';

// Shared geometry for single-line form fields; screens supply theme colors.
export const formStyles = StyleSheet.create({
  input: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSizes.body,
  },
});
