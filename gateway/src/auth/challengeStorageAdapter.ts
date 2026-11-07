import type {
  QuotaSqlStorage,
  QuotaSqlValue,
} from '../quota/sqliteQuotaStore';

export type ChallengeSqlStorage = QuotaSqlStorage;
export type ChallengeSqlValue = QuotaSqlValue;

export {
  createDurableObjectQuotaStorage as createDurableObjectChallengeStorage,
} from '../quota/durableObjectStorage';
