import type { ContainerSnapshot } from '@/data/models';
import type { AppTheme, Tone } from '@/theme/tokens';

export type BudgetSpendingStatus =
  | 'archived'
  | 'closed'
  | 'no-limit'
  | 'on-track'
  | 'near-limit'
  | 'at-limit'
  | 'over-budget';

/** Preserve warning/danger and inactive status semantics while tinting normal progress. */
export function budgetProgressAccent(
  theme: AppTheme,
  tone: Tone,
  status: BudgetSpendingStatus,
): string | undefined {
  return status === 'on-track' ? theme.colors.categories[tone].foreground : undefined;
}

export interface BudgetStatusPresentation {
  label: string;
  icon:
    | 'archive-outline'
    | 'lock-closed-outline'
    | 'remove-circle-outline'
    | 'checkmark-circle-outline'
    | 'alert-circle-outline'
    | 'warning-outline';
  progressTone: 'primary' | 'success' | 'warning' | 'danger';
  semantic: 'neutral' | 'success' | 'warning' | 'danger';
}

export function budgetSpendingStatus(
  container: Pick<
    ContainerSnapshot,
    'status' | 'limitMinor' | 'remainingMinor' | 'spentMinor'
  >,
): BudgetSpendingStatus {
  if (container.status === 'closed') return 'closed';
  if (container.status === 'archived') return 'archived';
  if (container.limitMinor <= 0) return 'no-limit';
  if (container.remainingMinor < 0) return 'over-budget';
  if (container.remainingMinor === 0) return 'at-limit';
  if (container.spentMinor / container.limitMinor >= 0.85) return 'near-limit';
  return 'on-track';
}

export function budgetStatusPresentation(
  status: BudgetSpendingStatus,
): BudgetStatusPresentation {
  switch (status) {
    case 'archived':
      return { label: 'Archived', icon: 'archive-outline', progressTone: 'primary', semantic: 'neutral' };
    case 'closed':
      return { label: 'Closed', icon: 'lock-closed-outline', progressTone: 'primary', semantic: 'neutral' };
    case 'no-limit':
      return { label: 'No limit', icon: 'remove-circle-outline', progressTone: 'primary', semantic: 'neutral' };
    case 'on-track':
      return { label: 'On track', icon: 'checkmark-circle-outline', progressTone: 'success', semantic: 'success' };
    case 'near-limit':
      return { label: 'Near limit', icon: 'alert-circle-outline', progressTone: 'warning', semantic: 'warning' };
    case 'at-limit':
      return { label: 'Limit', icon: 'alert-circle-outline', progressTone: 'danger', semantic: 'danger' };
    case 'over-budget':
      return { label: 'Over budget', icon: 'warning-outline', progressTone: 'danger', semantic: 'danger' };
  }
}

/** Integer-minor-unit progress, clamped so the fill never exceeds the track. */
export function budgetProgress(
  container: Pick<ContainerSnapshot, 'limitMinor' | 'spentMinor'>,
): number {
  if (container.limitMinor <= 0) return 0;
  return Math.min(Math.max(container.spentMinor / container.limitMinor, 0), 1);
}
