-- migrate:up

-- One-shot login tokens, delivered out of band via a Telegram DM.
-- Only the SHA-256 hash is stored: a database leak cannot produce a login.
CREATE TABLE IF NOT EXISTS public.login_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_expires_at ON public.login_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_user_id    ON public.login_tokens (user_id);

-- Server-side sessions. The cookie carries a random token; this table holds its
-- hash, so revocation is immediate (validation reads the row) and a leaked dump
-- yields nothing usable.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  user_agent         TEXT,
  ip                 INET,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id    ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions (expires_at);
-- Shared-IP abuse signal.
CREATE INDEX IF NOT EXISTS idx_user_sessions_ip         ON public.user_sessions (ip);

-- migrate:down
DROP TABLE IF EXISTS public.user_sessions;
DROP TABLE IF EXISTS public.login_tokens;
