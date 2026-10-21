import { FinanceError } from './errors';
import type { SqlDatabase } from './sqlDatabase';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY CHECK (length(trim(key)) > 0),
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  kind TEXT NOT NULL CHECK (kind IN ('cash', 'virtual_gcash')),
  icon TEXT NOT NULL CHECK (length(trim(icon)) > 0),
  tone TEXT NOT NULL CHECK (tone IN ('emerald', 'amber', 'coral', 'blue', 'violet')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('budget', 'savings')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_month_key TEXT NOT NULL
    CHECK (created_month_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  CHECK (archived_at IS NULL OR status = 'archived' OR deleted_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS container_metadata_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE RESTRICT,
  effective_month_key TEXT NOT NULL
    CHECK (effective_month_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  description TEXT NOT NULL CHECK (length(description) <= 90),
  icon TEXT NOT NULL CHECK (length(trim(icon)) > 0),
  tone TEXT NOT NULL CHECK (tone IN ('emerald', 'amber', 'coral', 'blue', 'violet')),
  recorded_at TEXT NOT NULL,
  UNIQUE (container_id, effective_month_key)
);

CREATE TABLE IF NOT EXISTS container_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'created',
      'metadata_changed',
      'limit_changed',
      'archived',
      'reactivated',
      'deleted'
    )
  ),
  effective_month_key TEXT NOT NULL
    CHECK (effective_month_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  recorded_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS budget_limits (
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE RESTRICT,
  month_key TEXT NOT NULL
    CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (container_id, month_key)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) > 0),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'expense',
      'income',
      'wallet_transfer',
      'container_transfer',
      'savings'
    )
  ),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'neutral')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  effective_date TEXT NOT NULL CHECK (length(effective_date) = 10),
  effective_month_key TEXT NOT NULL CHECK (
    length(effective_month_key) = 7
    AND effective_month_key = substr(effective_date, 1, 7)
  ),
  recorded_at TEXT NOT NULL,
  recorded_time_zone TEXT NOT NULL CHECK (length(trim(recorded_time_zone)) > 0),
  recorded_offset_minutes INTEGER NOT NULL
    CHECK (recorded_offset_minutes BETWEEN -840 AND 840),
  status TEXT NOT NULL CHECK (status IN ('posted', 'reversed')),
  source_wallet_id TEXT REFERENCES wallets(id) ON DELETE RESTRICT,
  destination_wallet_id TEXT REFERENCES wallets(id) ON DELETE RESTRICT,
  source_container_id TEXT REFERENCES containers(id) ON DELETE RESTRICT,
  destination_container_id TEXT REFERENCES containers(id) ON DELETE RESTRICT,
  source_wallet_name TEXT,
  destination_wallet_name TEXT,
  source_container_name TEXT,
  destination_container_name TEXT,
  icon TEXT NOT NULL CHECK (length(trim(icon)) > 0),
  tone TEXT NOT NULL CHECK (tone IN ('emerald', 'amber', 'coral', 'blue', 'violet')),
  reversal_of_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  correction_of_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (reversal_of_id IS NULL OR correction_of_id IS NULL),
  CHECK (
    (
      kind = 'expense'
      AND direction = 'out'
      AND source_wallet_id IS NOT NULL
      AND source_container_id IS NOT NULL
      AND destination_wallet_id IS NULL
      AND destination_container_id IS NULL
    )
    OR (
      kind = 'income'
      AND direction = 'in'
      AND destination_wallet_id IS NOT NULL
      AND destination_container_id IS NOT NULL
      AND source_wallet_id IS NULL
      AND source_container_id IS NULL
    )
    OR (
      kind = 'wallet_transfer'
      AND direction = 'neutral'
      AND source_wallet_id IS NOT NULL
      AND destination_wallet_id IS NOT NULL
      AND source_wallet_id <> destination_wallet_id
      AND source_container_id IS NULL
      AND destination_container_id IS NULL
    )
    OR (
      kind IN ('container_transfer', 'savings')
      AND direction = 'neutral'
      AND source_container_id IS NOT NULL
      AND destination_container_id IS NOT NULL
      AND source_container_id <> destination_container_id
      AND source_wallet_id IS NULL
      AND destination_wallet_id IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_type TEXT NOT NULL CHECK (account_type IN ('wallet', 'container')),
  account_id TEXT NOT NULL CHECK (length(trim(account_id)) > 0),
  wallet_id TEXT REFERENCES wallets(id) ON DELETE RESTRICT,
  container_id TEXT REFERENCES containers(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  recorded_at TEXT NOT NULL,
  CHECK (
    (
      account_type = 'wallet'
      AND wallet_id = account_id
      AND container_id IS NULL
    )
    OR (
      account_type = 'container'
      AND container_id = account_id
      AND wallet_id IS NULL
    )
  ),
  UNIQUE (transaction_id, account_type, account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reversal_of
  ON transactions(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_correction_of
  ON transactions(correction_of_id)
  WHERE correction_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_effective_month
  ON transactions(effective_month_key, effective_date);

CREATE INDEX IF NOT EXISTS idx_postings_wallet
  ON postings(wallet_id)
  WHERE wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_postings_container
  ON postings(container_id)
  WHERE container_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metadata_container_month
  ON container_metadata_history(container_id, effective_month_key);

CREATE INDEX IF NOT EXISTS idx_lifecycle_container
  ON container_lifecycle_events(container_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_limits_month
  ON budget_limits(month_key, container_id);

CREATE TRIGGER IF NOT EXISTS containers_identity_immutable
BEFORE UPDATE OF id, kind, created_month_key, created_at ON containers
BEGIN
  SELECT RAISE(ABORT, 'Container identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_financial_fields_immutable
BEFORE UPDATE OF
  id,
  idempotency_key,
  request_fingerprint,
  kind,
  title,
  category,
  direction,
  amount_minor,
  effective_date,
  effective_month_key,
  recorded_at,
  recorded_time_zone,
  recorded_offset_minutes,
  source_wallet_id,
  destination_wallet_id,
  source_container_id,
  destination_container_id,
  source_wallet_name,
  destination_wallet_name,
  source_container_name,
  destination_container_name,
  icon,
  tone,
  reversal_of_id,
  correction_of_id,
  created_at
ON transactions
BEGIN
  SELECT RAISE(ABORT, 'Financial transaction fields are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_status_transition
BEFORE UPDATE OF status ON transactions
WHEN NOT (OLD.status = 'posted' AND NEW.status = 'reversed')
BEGIN
  SELECT RAISE(ABORT, 'Invalid transaction status transition');
END;

CREATE TRIGGER IF NOT EXISTS transactions_reversal_guard
BEFORE INSERT ON transactions
WHEN NEW.reversal_of_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM transactions original
      WHERE original.id = NEW.reversal_of_id
        AND original.status = 'posted'
        AND original.kind = NEW.kind
        AND original.amount_minor = NEW.amount_minor
        AND original.reversal_of_id IS NULL
    )
    THEN RAISE(ABORT, 'Invalid reversal target')
  END;
END;

CREATE TRIGGER IF NOT EXISTS transactions_correction_guard
BEFORE INSERT ON transactions
WHEN NEW.correction_of_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM transactions original
      WHERE original.id = NEW.correction_of_id
        AND original.status = 'reversed'
        AND original.reversal_of_id IS NULL
    )
    THEN RAISE(ABORT, 'Invalid correction target')
  END;
END;

CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'Transactions cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS postings_no_update
BEFORE UPDATE ON postings
BEGIN
  SELECT RAISE(ABORT, 'Postings are immutable');
END;

CREATE TRIGGER IF NOT EXISTS postings_no_delete
BEFORE DELETE ON postings
BEGIN
  SELECT RAISE(ABORT, 'Postings cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS container_events_no_update
BEFORE UPDATE ON container_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'Container lifecycle events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS container_events_no_delete
BEFORE DELETE ON container_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'Container lifecycle events cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS metadata_history_no_delete
BEFORE DELETE ON container_metadata_history
BEGIN
  SELECT RAISE(ABORT, 'Container metadata history cannot be deleted');
END;
`;

const OPERATION_RECEIPTS_SQL = `
CREATE TABLE IF NOT EXISTS operation_receipts (
  idempotency_key TEXT PRIMARY KEY
    CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  operation_type TEXT NOT NULL CHECK (length(trim(operation_type)) > 0),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) > 0),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_receipts_type
  ON operation_receipts(operation_type, created_at);

CREATE TRIGGER IF NOT EXISTS operation_receipts_no_update
BEFORE UPDATE ON operation_receipts
BEGIN
  SELECT RAISE(ABORT, 'Operation receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS operation_receipts_no_delete
BEFORE DELETE ON operation_receipts
BEGIN
  SELECT RAISE(ABORT, 'Operation receipts cannot be deleted');
END;
`;

const SYSTEM_UNALLOCATED_SQL = `
ALTER TABLE containers ADD COLUMN system_key TEXT
  CHECK (system_key IS NULL OR system_key = 'unallocated');

CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_system_key
  ON containers(system_key)
  WHERE system_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS containers_reserved_system_id
BEFORE INSERT ON containers
WHEN NEW.id = 'system-unallocated'
  AND (NEW.system_key IS NULL OR NEW.system_key <> 'unallocated')
BEGIN
  SELECT RAISE(ABORT, 'Reserved system container ID');
END;

CREATE TRIGGER IF NOT EXISTS containers_system_requires_reserved_id
BEFORE INSERT ON containers
WHEN NEW.system_key IS NOT NULL AND NEW.id <> 'system-unallocated'
BEGIN
  SELECT RAISE(ABORT, 'System container must use the reserved ID');
END;

CREATE TRIGGER IF NOT EXISTS containers_system_key_immutable
BEFORE UPDATE OF system_key ON containers
WHEN OLD.system_key IS NOT NEW.system_key
BEGIN
  SELECT RAISE(ABORT, 'System container identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS containers_system_key_update_requires_reserved_id
BEFORE UPDATE OF system_key ON containers
WHEN NEW.system_key IS NOT NULL AND NEW.id <> 'system-unallocated'
BEGIN
  SELECT RAISE(ABORT, 'System container must use the reserved ID');
END;

CREATE TRIGGER IF NOT EXISTS containers_system_lifecycle_guard
BEFORE UPDATE OF status, archived_at, deleted_at ON containers
WHEN OLD.system_key IS NOT NULL
  AND (
    NEW.status <> 'active'
    OR NEW.archived_at IS NOT NULL
    OR NEW.deleted_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'System container cannot be archived or deleted');
END;

CREATE TRIGGER IF NOT EXISTS containers_system_no_delete
BEFORE DELETE ON containers
WHEN OLD.system_key IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'System container cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS metadata_system_no_insert
BEFORE INSERT ON container_metadata_history
WHEN EXISTS (
  SELECT 1 FROM containers
  WHERE id = NEW.container_id AND system_key IS NOT NULL
)
AND EXISTS (
  SELECT 1 FROM container_metadata_history
  WHERE container_id = NEW.container_id
)
BEGIN
  SELECT RAISE(ABORT, 'System container metadata is immutable');
END;

CREATE TRIGGER IF NOT EXISTS metadata_system_no_update
BEFORE UPDATE ON container_metadata_history
WHEN EXISTS (
  SELECT 1 FROM containers
  WHERE id = NEW.container_id AND system_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'System container metadata is immutable');
END;

CREATE TRIGGER IF NOT EXISTS budget_limits_system_no_insert
BEFORE INSERT ON budget_limits
WHEN EXISTS (
  SELECT 1 FROM containers
  WHERE id = NEW.container_id AND system_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'System container cannot have a budget limit');
END;

CREATE TRIGGER IF NOT EXISTS budget_limits_system_no_update
BEFORE UPDATE ON budget_limits
WHEN EXISTS (
  SELECT 1 FROM containers
  WHERE id = NEW.container_id AND system_key IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'System container cannot have a budget limit');
END;
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_finance_ledger',
    sql: CORE_SCHEMA_SQL,
  },
  {
    version: 2,
    name: 'operation_receipts',
    sql: OPERATION_RECEIPTS_SQL,
  },
  {
    version: 3,
    name: 'system_unallocated_container',
    sql: SYSTEM_UNALLOCATED_SQL,
  },
] as const;

export async function migrateDatabase(
  database: SqlDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const ordered = validateMigrationList(migrations);

  await database.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = await database.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const currentVersion = applied.at(-1)?.version ?? 0;
  const latestVersion = ordered.at(-1)?.version ?? 0;

  if (currentVersion > latestVersion) {
    throw new FinanceError(
      'SCHEMA_VERSION',
      `Database schema version ${currentVersion} is newer than this app supports (${latestVersion}).`,
    );
  }

  const pending = ordered.filter((migration) => migration.version > currentVersion);

  await database.withTransactionAsync(async () => {
    for (const migration of pending) {
      try {
        await database.execAsync(migration.sql);
        await database.runAsync(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, new Date().toISOString()],
        );
      } catch (error) {
        throw new FinanceError(
          'DATABASE',
          `Migration ${migration.version} (${migration.name}) failed.`,
          { cause: error },
        );
      }
    }
  });

  const expectedVersion = ordered.find(
    (migration) => migration.version === latestVersion,
  )?.version;
  if (expectedVersion !== undefined) {
    await database.execAsync(`PRAGMA user_version = ${expectedVersion}`);
  }
}

function validateMigrationList(migrations: readonly Migration[]): Migration[] {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  let previousVersion = 0;

  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new FinanceError(
        'SCHEMA_VERSION',
        `Invalid migration version: ${migration.version}.`,
      );
    }
    if (migration.version <= previousVersion) {
      throw new FinanceError(
        'SCHEMA_VERSION',
        `Duplicate or out-of-order migration version: ${migration.version}.`,
      );
    }
    if (!migration.name.trim()) {
      throw new FinanceError(
        'SCHEMA_VERSION',
        `Migration ${migration.version} is missing a name.`,
      );
    }
    previousVersion = migration.version;
  }

  return ordered;
}
