-- migrate:up
-- Soft delete for individual trades. A user can hide a trade from the dashboard
-- (and from every aggregate derived from it) without removing the row, so the
-- next exchange sync does not resurrect it: upsertTrades / insertTradesSkipExisting
-- never touch deleted_at, and every read path filters on `deleted_at IS NULL`.
ALTER TABLE cached_trades ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index: the deleted set is tiny compared to the table, and the only
-- queries that touch it look up "all deleted rows for this user (+exchange)".
CREATE INDEX IF NOT EXISTS cached_trades_deleted
  ON cached_trades (telegram_id, exchange) WHERE deleted_at IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS cached_trades_deleted;
ALTER TABLE cached_trades DROP COLUMN IF EXISTS deleted_at;
