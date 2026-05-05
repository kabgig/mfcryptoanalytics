-- migrate:up
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS users_share_token_idx ON users (share_token)
  WHERE share_token IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS users_share_token_idx;
ALTER TABLE users
  DROP COLUMN IF EXISTS share_token;
