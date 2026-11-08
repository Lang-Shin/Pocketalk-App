import { formatPeso, parsePesoToMinor } from '@/lib/money';

/**
 * Pure selection/confirmation logic for the container-transfer form.
 *
 * The modal uses these helpers so that a transfer is only requested after both
 * endpoints are explicitly chosen, and so the values shown in the confirmation
 * are exactly the values submitted to the finance service.
 */

export interface ContainerTransferEndpoint {
  id: string;
  name: string;
  systemKey?: string | null;
}

export interface ContainerTransferDraft {
  amountText: string;
  title: string;
  effectiveDate: string;
  sourceContainerId: string;
  destinationContainerId: string;
}

export type ContainerTransferDirection =
  | 'container_transfer'
  | 'savings_contribution'
  | 'savings_withdrawal';

export interface ContainerTransferConfirmation {
  amountMinor: number;
  sourceContainerId: string;
  destinationContainerId: string;
  sourceName: string;
  destinationName: string;
  effectiveDate: string;
  title: string;
  direction: ContainerTransferDirection;
  summary: string;
}

export type ContainerTransferConfirmationFailure =
  | 'choose_source'
  | 'choose_destination'
  | 'same_container'
  | 'invalid_amount';

export type ContainerTransferConfirmationResult =
  | {
      ok: true;
      confirmation: ContainerTransferConfirmation;
    }
  | {
      ok: false;
      reason: ContainerTransferConfirmationFailure;
      message: string;
    };

export function containerTransferDirection(
  source: ContainerTransferEndpoint | undefined,
  destination: ContainerTransferEndpoint | undefined,
): ContainerTransferDirection {
  if (destination?.systemKey === 'savings') return 'savings_contribution';
  if (source?.systemKey === 'savings') return 'savings_withdrawal';
  return 'container_transfer';
}

export function buildContainerTransferConfirmation(
  draft: ContainerTransferDraft,
  source: ContainerTransferEndpoint | undefined,
  destination: ContainerTransferEndpoint | undefined,
): ContainerTransferConfirmationResult {
  if (!draft.sourceContainerId) {
    return {
      ok: false,
      reason: 'choose_source',
      message: 'Choose the container to move money from.',
    };
  }
  if (!draft.destinationContainerId) {
    return {
      ok: false,
      reason: 'choose_destination',
      message: 'Choose the container to move money to.',
    };
  }
  if (draft.sourceContainerId === draft.destinationContainerId) {
    return {
      ok: false,
      reason: 'same_container',
      message: 'Choose two different containers.',
    };
  }
  if (!source || !destination) {
    return {
      ok: false,
      reason: 'choose_destination',
      message: 'One of the selected containers is no longer available.',
    };
  }
  const amountMinor = parsePesoToMinor(draft.amountText);
  if (amountMinor === null || amountMinor <= 0) {
    return {
      ok: false,
      reason: 'invalid_amount',
      message: 'Enter a valid amount, such as 145 or 145.50.',
    };
  }

  return {
    ok: true,
    confirmation: {
      amountMinor,
      sourceContainerId: source.id,
      destinationContainerId: destination.id,
      sourceName: source.name,
      destinationName: destination.name,
      effectiveDate: draft.effectiveDate,
      title: draft.title,
      direction: containerTransferDirection(source, destination),
      summary: `Move ${formatPeso(amountMinor)} from ${source.name} to ${destination.name}`,
    },
  };
}

/**
 * True while the form still holds exactly the values that were confirmed.
 * Any edit to the amount, endpoints, description, or date invalidates the
 * earlier confirmation so it cannot be submitted by accident.
 */
export function isTransferConfirmationCurrent(
  confirmation: ContainerTransferConfirmation,
  draft: ContainerTransferDraft,
): boolean {
  const amountMinor = parsePesoToMinor(draft.amountText);
  return (
    amountMinor === confirmation.amountMinor &&
    draft.sourceContainerId === confirmation.sourceContainerId &&
    draft.destinationContainerId === confirmation.destinationContainerId &&
    draft.effectiveDate === confirmation.effectiveDate &&
    draft.title === confirmation.title
  );
}
