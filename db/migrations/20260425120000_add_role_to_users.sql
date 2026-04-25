-- migrate:up
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'USER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'USER';

-- migrate:down
ALTER TABLE users
  DROP COLUMN IF EXISTS role;

DROP TYPE IF EXISTS user_role;
