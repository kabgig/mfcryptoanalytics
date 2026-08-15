-- migrate:up
-- Per-trade journal. Each trade can carry up to three notes — what the user was
-- thinking BEFORE the entry, DURING the position, and AFTER the close.
--
-- Deliberately a separate table rather than three columns on cached_trades:
-- upsertTrades / insertTradesSkipExisting rewrite every trade row on each sync,
-- so anything user-authored living there is one careless ON CONFLICT list away
-- from being wiped (see the warning above upsertTrades). Notes in their own
-- table cannot be touched by a sync at all.
--
-- The FK is to users, NOT to cached_trades: trades from Binance/Bybit are
-- fetched client-side and rendered before the store round-trip completes, so a
-- composite FK to (telegram_id, exchange, id) could reject a legitimate note.
-- The trade key is stored as plain columns and may briefly point at a row that
-- is still being written.
--
-- NOTE FOR FUTURE MIGRATIONS: notes are keyed by trade id. Any migration that
-- rewrites cached_trades.id (as 20260813000002 did for futures ids) MUST apply
-- the same rewrite here, or every note on those trades is orphaned.
CREATE TABLE IF NOT EXISTS trade_notes (
  telegram_id bigint NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  exchange    text   NOT NULL,
  trade_id    text   NOT NULL,
  phase       text   NOT NULL,
  body        text   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, exchange, trade_id, phase),
  CONSTRAINT trade_notes_phase_chk CHECK (phase IN ('before', 'during', 'after')),
  -- An empty note is deleted rather than stored, so the UI can treat "row
  -- exists" and "has a note" as the same thing.
  CONSTRAINT trade_notes_body_chk CHECK (length(btrim(body)) > 0)
);

-- The only read is "every note for this user", loaded once per dashboard mount
-- and joined to the trades in memory. The PK's leading column already serves
-- that, so no extra index is needed.

-- migrate:down
DROP TABLE IF EXISTS trade_notes;
