-- migrate:up
CREATE TABLE IF NOT EXISTS cached_trades (
  id            TEXT        NOT NULL,
  telegram_id   BIGINT      NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  exchange      TEXT        NOT NULL,
  ticker        TEXT        NOT NULL,
  position_size NUMERIC     NOT NULL DEFAULT 0,
  tp            NUMERIC,
  sl            NUMERIC,
  open_time     TIMESTAMPTZ NOT NULL,
  close_time    TIMESTAMPTZ NOT NULL,
  pnl           NUMERIC     NOT NULL DEFAULT 0,
  market        TEXT,
  PRIMARY KEY (telegram_id, id)
);

CREATE INDEX IF NOT EXISTS cached_trades_telegram_close_time
  ON cached_trades (telegram_id, close_time DESC);

-- migrate:down
DROP INDEX IF EXISTS cached_trades_telegram_close_time;
DROP TABLE IF EXISTS cached_trades;
