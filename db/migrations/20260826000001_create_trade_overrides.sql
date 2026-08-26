-- migrate:up
-- Manual TP / SL / Bias for a trade.
--
-- No futures adapter populates tp or sl — every one of them hardcodes null (see
-- lib/exchanges/adapters/*/futures.ts), so those two columns on cached_trades
-- have never carried a real value. This table is where a user's own numbers go.
--
-- Deliberately a separate table rather than writing into cached_trades.tp/sl,
-- for exactly the reason trade_notes gives (20260815000001): upsertTrades
-- rewrites ticker, position_size, tp, sl, pnl, market and side from EXCLUDED on
-- every single sync, so a hand-typed TP living there would be silently wiped on
-- the next refresh. Overrides in their own table cannot be touched by a sync.
--
-- The FK is to users, NOT to cached_trades, for the same reason as trade_notes:
-- Binance/Bybit trades are fetched client-side and rendered before the
-- /api/trades-store round trip completes, so a composite FK to
-- (telegram_id, exchange, id) could reject a legitimate override.
--
-- `bias` is only ever the user's manual answer. When it is NULL the UI derives
-- the bias from cached_trades.side (long → buy, short → sell); an override wins
-- over that derivation. side itself is left completely alone, so the LVS view's
-- long/short split keeps reading the exchange's own answer.
--
-- NOTE FOR FUTURE MIGRATIONS: rows are keyed by trade id. Any migration that
-- rewrites cached_trades.id (as 20260813000002 did for futures ids) MUST apply
-- the same rewrite here, or every override on those trades is orphaned.
--
-- Idempotent: IF NOT EXISTS, and every constraint is declared inline so a
-- re-run adds nothing. Safe to apply against a database that already has it.
CREATE TABLE IF NOT EXISTS trade_overrides (
  telegram_id bigint  NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  exchange    text    NOT NULL,
  trade_id    text    NOT NULL,
  tp          numeric,
  sl          numeric,
  bias        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, exchange, trade_id),
  CONSTRAINT trade_overrides_bias_chk CHECK (bias IS NULL OR bias IN ('buy', 'sell')),
  -- A row with nothing overridden is deleted rather than stored, so the UI can
  -- treat "row exists" and "something was overridden" as the same thing.
  CONSTRAINT trade_overrides_empty_chk
    CHECK (tp IS NOT NULL OR sl IS NOT NULL OR bias IS NOT NULL)
);

-- The only read is "every override for this user", loaded once per dashboard
-- mount and joined to the trades in memory — the PK's leading column already
-- serves that, so no extra index is needed.

-- migrate:down
DROP TABLE IF EXISTS trade_overrides;
