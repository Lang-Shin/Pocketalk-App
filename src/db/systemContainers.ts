import type {
  ContainerKind,
  ContainerLabel,
  SystemContainerKey,
} from '@/data/models';

import { FinanceError } from './errors';
import { FinanceRepository } from './financeRepository';
import type { SqlDatabase } from './sqlDatabase';

export const UNALLOCATED_CONTAINER_ID = 'system-unallocated';
export const UNALLOCATED_SYSTEM_KEY: SystemContainerKey = 'unallocated';
export const UNALLOCATED_EFFECTIVE_MONTH_KEY = '1970-01';

export const SAVINGS_CONTAINER_ID = 'system-savings';
export const SAVINGS_SYSTEM_KEY: SystemContainerKey = 'savings';
export const SAVINGS_EFFECTIVE_MONTH_KEY = '1970-01';

const UNALLOCATED_LABEL: ContainerLabel = {
  name: 'Unallocated',
  description: 'Income not yet assigned to a budget container.',
  icon: 'layers-outline',
  tone: 'blue',
};

const SAVINGS_LABEL: ContainerLabel = {
  name: 'Savings',
  description: 'Permanent savings kept outside monthly spending.',
  icon: 'wallet-outline',
  tone: 'emerald',
};

interface SystemContainerDefinition {
  id: string;
  systemKey: SystemContainerKey;
  kind: ContainerKind;
  sortOrder: number;
  effectiveMonthKey: string;
  label: ContainerLabel;
}

const SYSTEM_CONTAINERS: readonly SystemContainerDefinition[] = [
  {
    id: UNALLOCATED_CONTAINER_ID,
    systemKey: UNALLOCATED_SYSTEM_KEY,
    kind: 'budget',
    sortOrder: 0,
    effectiveMonthKey: UNALLOCATED_EFFECTIVE_MONTH_KEY,
    label: UNALLOCATED_LABEL,
  },
  {
    id: SAVINGS_CONTAINER_ID,
    systemKey: SAVINGS_SYSTEM_KEY,
    kind: 'savings',
    sortOrder: 1,
    effectiveMonthKey: SAVINGS_EFFECTIVE_MONTH_KEY,
    label: SAVINGS_LABEL,
  },
];

export interface EnsureUnallocatedContainerOptions {
  recordedAt: string;
}

export interface EnsureUnallocatedContainerResult {
  containerId: string;
}

export interface EnsureSavingsContainerOptions {
  recordedAt: string;
}

export interface EnsureSavingsContainerResult {
  containerId: string;
}

export async function ensureSystemUnallocatedContainer(
  database: SqlDatabase,
  options: EnsureUnallocatedContainerOptions,
): Promise<EnsureUnallocatedContainerResult> {
  return ensureSystemContainer(
    database,
    SYSTEM_CONTAINERS[0] as SystemContainerDefinition,
    options.recordedAt,
  );
}

export async function ensureSystemSavingsContainer(
  database: SqlDatabase,
  options: EnsureSavingsContainerOptions,
): Promise<EnsureSavingsContainerResult> {
  return ensureSystemContainer(
    database,
    SYSTEM_CONTAINERS[1] as SystemContainerDefinition,
    options.recordedAt,
  );
}

async function ensureSystemContainer(
  database: SqlDatabase,
  definition: SystemContainerDefinition,
  recordedAt: string,
): Promise<{ containerId: string }> {
  const repository = new FinanceRepository(database);

  return database.withTransactionAsync(async () => {
    const byId = await repository.getContainer(definition.id, true);
    const byKey = await repository.getContainerBySystemKey(definition.systemKey);

    if (byKey && byKey.id !== definition.id) {
      throw new FinanceError(
        'INVALID_STATE',
        `The system ${definition.label.name} container has an unexpected identity.`,
      );
    }

    if (byId) {
      if (byId.systemKey !== definition.systemKey) {
        throw new FinanceError(
          'INVALID_STATE',
          `The reserved ${definition.label.name} container ID belongs to a user container.`,
        );
      }
      if (byId.kind !== definition.kind) {
        throw new FinanceError(
          'INVALID_STATE',
          `The system ${definition.label.name} container has an invalid kind.`,
        );
      }
      if (byId.status !== 'active' || byId.archivedAt || byId.deletedAt) {
        throw new FinanceError(
          'INVALID_STATE',
          `The system ${definition.label.name} container must remain active.`,
        );
      }

      const metadata = await repository.listMetadataHistory(byId.id);
      if (metadata.length === 0) {
        await repository.insertMetadata({
          id: 0,
          containerId: byId.id,
          effectiveMonthKey: definition.effectiveMonthKey,
          label: definition.label,
          recordedAt,
        });
      } else {
        const baseMetadata = await repository.getMetadataAsOf(
          byId.id,
          definition.effectiveMonthKey,
        );
        if (!baseMetadata) {
          throw new FinanceError(
            'INVALID_STATE',
            `The system ${definition.label.name} container is missing its base metadata.`,
          );
        }
      }

      return { containerId: byId.id };
    }

    await repository.insertContainer({
      id: definition.id,
      kind: definition.kind,
      status: 'active',
      sortOrder: definition.sortOrder,
      createdMonthKey: definition.effectiveMonthKey,
      createdAt: recordedAt,
      archivedAt: null,
      deletedAt: null,
      systemKey: definition.systemKey,
    });
    await repository.insertMetadata({
      id: 0,
      containerId: definition.id,
      effectiveMonthKey: definition.effectiveMonthKey,
      label: definition.label,
      recordedAt,
    });
    await repository.insertLifecycleEvent({
      id: 0,
      containerId: definition.id,
      eventType: 'created',
      effectiveMonthKey: definition.effectiveMonthKey,
      recordedAt,
      detailsJson: JSON.stringify({
        system: true,
        systemKey: definition.systemKey,
      }),
    });

    return { containerId: definition.id };
  });
}
