import { validateQuotaKey } from './types';

export const QUOTA_OBJECT_PREFIX = 'quota-pool:';

export interface DurableObjectIdLike {
  toString(): string;
}

export interface DurableObjectNamespaceLike<
  Stub,
  Id = DurableObjectIdLike,
> {
  idFromName(name: string): Id;
  get(id: Id): Stub;
}

export function quotaObjectName(poolId: string): string {
  validateQuotaKey(poolId, 'poolId');
  return `${QUOTA_OBJECT_PREFIX}${poolId}`;
}

export function quotaObjectId<Stub, Id>(
  namespace: DurableObjectNamespaceLike<Stub, Id>,
  poolId: string,
): Id {
  return namespace.idFromName(quotaObjectName(poolId));
}

export function quotaObjectStub<Stub, Id>(
  namespace: DurableObjectNamespaceLike<Stub, Id>,
  poolId: string,
): Stub {
  return namespace.get(quotaObjectId(namespace, poolId));
}
