-- migrate:up
-- Manually entered long-term spot positions (DCA ledger). Unlike cached_trades
-- these are never synced from an exchange — the user types every row — so there
-- is no id collision concern and a plain BIGSERIAL is enough.
CREATE TABLE IF NOT EXISTS spot_entries (
  id          BIGSERIAL   PRIMARY KEY,
  telegram_id BIGINT      NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  ticker      TEXT        NOT NULL,
  side        VARCHAR(4)  NOT NULL DEFAULT 'BUY',
  qty         NUMERIC     NOT NULL CHECK (qty > 0),
  price       NUMERIC     NOT NULL CHECK (price >= 0),
  traded_at   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT spot_entries_side_chk CHECK (side IN ('BUY', 'SELL'))
);

-- Every read path walks one user's entries for one ticker in trade order to
-- replay the DCA cycles, so the index matches that access pattern exactly.
-- Partial on deleted_at IS NULL: soft-deleted rows are excluded from all
-- aggregates and only ever fetched by the (rare) "show deleted" path.
CREATE INDEX IF NOT EXISTS spot_entries_user_ticker_time
  ON spot_entries (telegram_id, ticker, traded_at) WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS spot_entries_user_ticker_time;
DROP TABLE IF EXISTS spot_entries;
