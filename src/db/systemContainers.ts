import type { ContainerLabel, SystemContainerKey } from '@/data/models';

import { FinanceError } from './errors';
import { FinanceRepository } from './financeRepository';
import type { SqlDatabase } from './sqlDatabase';

export const UNALLOCATED_CONTAINER_ID = 'system-unallocated';
export const UNALLOCATED_SYSTEM_KEY: SystemContainerKey = 'unallocated';
export const UNALLOCATED_EFFECTIVE_MONTH_KEY = '1970-01';

const UNALLOCATED_LABEL: ContainerLabel = {
  name: 'Unallocated',
  description: 'Income not yet assigned to a budget container.',
  icon: 'layers-outline',
  tone: 'blue',
};

export interface EnsureUnallocatedContainerOptions {
  recordedAt: string;
}

export interface EnsureUnallocatedContainerResult {
  containerId: string;
}

export async function ensureSystemUnallocatedContainer(
  database: SqlDatabase,
  options: EnsureUnallocatedContainerOptions,
): Promise<EnsureUnallocatedContainerResult> {
  const repository = new FinanceRepository(database);

  return database.withTransactionAsync(async () => {
    const byId = await repository.getContainer(
      UNALLOCATED_CONTAINER_ID,
      true,
    );
    const byKey = await repository.getContainerBySystemKey(
      UNALLOCATED_SYSTEM_KEY,
    );

    if (byKey && byKey.id !== UNALLOCATED_CONTAINER_ID) {
      throw new FinanceError(
        'INVALID_STATE',
        'The system Unallocated container has an unexpected identity.',
      );
    }

    if (byId) {
      if (byId.systemKey !== UNALLOCATED_SYSTEM_KEY) {
        throw new FinanceError(
          'INVALID_STATE',
          'The reserved Unallocated container ID belongs to a user container.',
        );
      }
      if (byId.status !== 'active' || byId.archivedAt || byId.deletedAt) {
        throw new FinanceError(
          'INVALID_STATE',
          'The system Unallocated container must remain active.',
        );
      }

      const metadata = await repository.listMetadataHistory(byId.id);
      if (metadata.length === 0) {
        await repository.insertMetadata({
          id: 0,
          containerId: byId.id,
          effectiveMonthKey: UNALLOCATED_EFFECTIVE_MONTH_KEY,
          label: UNALLOCATED_LABEL,
          recordedAt: options.recordedAt,
        });
      } else {
        const baseMetadata = await repository.getMetadataAsOf(
          byId.id,
          UNALLOCATED_EFFECTIVE_MONTH_KEY,
        );
        if (!baseMetadata) {
          throw new FinanceError(
            'INVALID_STATE',
            'The system Unallocated container is missing its base metadata.',
          );
        }
      }

      return { containerId: byId.id };
    }

    await repository.insertContainer({
      id: UNALLOCATED_CONTAINER_ID,
      kind: 'budget',
      status: 'active',
      sortOrder: 0,
      createdMonthKey: UNALLOCATED_EFFECTIVE_MONTH_KEY,
      createdAt: options.recordedAt,
      archivedAt: null,
      deletedAt: null,
      systemKey: UNALLOCATED_SYSTEM_KEY,
    });
    await repository.insertMetadata({
      id: 0,
      containerId: UNALLOCATED_CONTAINER_ID,
      effectiveMonthKey: UNALLOCATED_EFFECTIVE_MONTH_KEY,
      label: UNALLOCATED_LABEL,
      recordedAt: options.recordedAt,
    });
    await repository.insertLifecycleEvent({
      id: 0,
      containerId: UNALLOCATED_CONTAINER_ID,
      eventType: 'created',
      effectiveMonthKey: UNALLOCATED_EFFECTIVE_MONTH_KEY,
      recordedAt: options.recordedAt,
      detailsJson: JSON.stringify({ system: true }),
    });

    return { containerId: UNALLOCATED_CONTAINER_ID };
  });
}
