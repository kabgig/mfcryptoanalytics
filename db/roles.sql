-- Least-privilege application role.
--
-- Run ONCE per environment, as the database owner, on Neon's DIRECT (non-pooled)
-- endpoint. Pass the password as a psql variable so it never lands in this file:
--
--   psql "$OWNER_URL" -v pw="'<password>'" -f db/roles.sql
--
-- Then point the app's DATABASE_URL at app_frontend instead of the owner, and
-- keep the owner URL as MIGRATION_DATABASE_URL — dbmate needs DDL rights, which
-- app_frontend deliberately does not have. The db:* npm scripts pass
-- `--env MIGRATION_DATABASE_URL` for exactly this reason.
--
-- STATUS: applied to the Neon project on 2026-09-06. Local .env.local already
-- points at app_frontend. Vercel's DATABASE_URL must be updated separately.
--
-- Why: the app currently connects as the Neon owner, which can DROP TABLE. A SQL
-- injection or a compromised deploy key would therefore be able to destroy the
-- schema, not merely read rows. Nothing the app does needs DDL.

CREATE ROLE app_frontend WITH LOGIN PASSWORD :pw;

-- Enforced at the ROLE level on purpose: a connection pooler silently strips
-- statement_timeout when it is passed as a client connection option.
ALTER ROLE app_frontend SET statement_timeout = '5000';

GRANT CONNECT ON DATABASE neondb TO app_frontend;
GRANT USAGE   ON SCHEMA public   TO app_frontend;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES     IN SCHEMA public TO app_frontend;
GRANT USAGE, SELECT                  ON ALL SEQUENCES  IN SCHEMA public TO app_frontend;

-- Tables created by a later migration must stay reachable without re-running this.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_frontend;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_frontend;

-- Deliberately NOT granted: CREATE on the schema, ownership of any table, and
-- any DDL. Migrations keep running as the owner via dbmate.
