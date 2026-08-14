-- migrate:up
-- Daily close cache for spot tickers, sized for the Neon free tier.
--
-- Three deliberate choices keep this small:
--   1. Global, not per-user — one row per (ticker, day) shared across every
--      account, instead of duplicating the same BTC history per user.
--   2. Close only. The DCA charts need one number per day; storing full OHLCV
--      would be ~5x the bytes for columns nothing renders.
--   3. DATE + DOUBLE PRECISION, and the composite PK doubles as the lookup
--      index so there is no second index to pay for.
--
-- Prices are a regenerable cache, hence DOUBLE PRECISION here while
-- spot_entries keeps NUMERIC for the user's actual money.
--
-- Writes must stay incremental (fetch only days after MAX(day) per ticker):
-- re-upserting whole histories would churn WAL and bloat the table, which is
-- the real free-tier risk — not the row count.
CREATE TABLE IF NOT EXISTS spot_price_history (
  ticker TEXT             NOT NULL,
  day    DATE             NOT NULL,
  close  DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (ticker, day)
);

-- migrate:down
DROP TABLE IF EXISTS spot_price_history;
