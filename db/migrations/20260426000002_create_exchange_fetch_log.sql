-- migrate:up
CREATE TABLE IF NOT EXISTS exchange_fetch_log (
  telegram_id BIGINT      NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  exchange    TEXT        NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, exchange)
);

-- migrate:down
DROP TABLE IF EXISTS exchange_fetch_log;
