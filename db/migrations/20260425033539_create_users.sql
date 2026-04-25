-- migrate:up
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT       NOT NULL UNIQUE,
  telegram_name   TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE IF EXISTS users;
