-- migrate:up

-- Global rate-limit cooldown per exchange, shared by every serverless instance.
-- Binance (and friends) ban the calling IP, not the API key, so a 418/-1003 from
-- any user's sync must stop ALL instances from calling that exchange until the
-- ban lifts — otherwise every retry extends the ban (Binance escalates up to
-- 3 days). Vercel functions share nothing in memory, so Neon is the source of
-- truth; the browser-side fetch path keeps its own copy in localStorage.
CREATE TABLE IF NOT EXISTS public.exchange_cooldowns (
  exchange     TEXT PRIMARY KEY,
  blocked_until TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global live-price cache (Coinbase/Kraken). Prices are identical for every
-- user, so one refresh serves everyone; the fetch on /api/spot/prices only
-- asks the upstream for tickers whose cached row is older than the TTL.
CREATE TABLE IF NOT EXISTS public.live_prices (
  ticker     TEXT PRIMARY KEY,
  price      DOUBLE PRECISION NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE IF EXISTS public.live_prices;
DROP TABLE IF EXISTS public.exchange_cooldowns;
