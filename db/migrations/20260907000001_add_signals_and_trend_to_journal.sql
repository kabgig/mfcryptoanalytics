-- migrate:up
-- Two more journal fields: `signals` — the confluence that justified the entry,
-- multi-valued — and `trend`, whether the entry went with the prevailing trend
-- or against it.
--
-- Both are text columns on the existing row rather than anything new, for the
-- reason 20260828000001 gives: one row per trade is what stops the form and the
-- CSV export from ever disagreeing, and `signals` stores its tags '|'-joined in
-- one column exactly as exit_reason, mistake and emotion have since
-- 20260902000001.
--
-- Idempotent throughout: IF NOT EXISTS columns, DROP-then-ADD constraints. Safe
-- to re-run against a database that already has all of this.

ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS signals text;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS trend   text;

-- trend gets a CHECK: two values, and they are not going to grow — the entry was
-- either with the trend or against it. Same call as strategy/timeframe/killzone.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_trend_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_trend_chk
  CHECK (trend IS NULL OR trend IN ('with_trend', 'against_trend'));

-- signals deliberately gets none, for two reasons that both apply. It is
-- multi-valued, so it stores 'poi|sweep' and no IN (...) list could accept it —
-- the same wall 20260902000001 hit and why exit_reason's CHECK had to go. And
-- the vocabulary will grow as the user's read of the market does, which is the
-- argument 20260828000001 made for mistake and emotion. It is validated in
-- lib/services/journalFields.ts, on the API route, on the way into the DB and
-- again on the way out.

-- Rebuilt over the two new columns. Without this a journal entry carrying only
-- signals or only a trend — a perfectly ordinary "I logged the setup, I will
-- review it later" — would leave every enumerated column NULL and be rejected
-- outright, surfacing as a 500 on save.
--
-- Strictly weaker than the constraint it replaces: the previous fourteen terms
-- are all still here, so no row that passed before can fail now, and the
-- all-NULL row it exists to reject is still rejected.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_empty_chk
  CHECK (
    tp1 IS NOT NULL OR tp2 IS NOT NULL OR sl IS NOT NULL OR entry IS NOT NULL OR
    bias IS NOT NULL OR risk_pct IS NOT NULL OR rr IS NOT NULL OR
    rules_ok IS NOT NULL OR strategy IS NOT NULL OR timeframe IS NOT NULL OR
    killzone IS NOT NULL OR exit_reason IS NOT NULL OR mistake IS NOT NULL OR
    emotion IS NOT NULL OR signals IS NOT NULL OR trend IS NOT NULL
  );

-- migrate:down
-- Restore the fourteen-column constraint first: a row kept alive only by signals
-- or trend would violate it the moment those columns go, so it has to be deleted
-- while they are still there to be read.
DELETE FROM trade_overrides
 WHERE tp1 IS NULL AND tp2 IS NULL AND sl IS NULL AND entry IS NULL
   AND bias IS NULL AND risk_pct IS NULL AND rr IS NULL
   AND rules_ok IS NULL AND strategy IS NULL AND timeframe IS NULL
   AND killzone IS NULL AND exit_reason IS NULL AND mistake IS NULL
   AND emotion IS NULL;

ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_empty_chk
  CHECK (
    tp1 IS NOT NULL OR tp2 IS NOT NULL OR sl IS NOT NULL OR entry IS NOT NULL OR
    bias IS NOT NULL OR risk_pct IS NOT NULL OR rr IS NOT NULL OR
    rules_ok IS NOT NULL OR strategy IS NOT NULL OR timeframe IS NOT NULL OR
    killzone IS NOT NULL OR exit_reason IS NOT NULL OR mistake IS NOT NULL OR
    emotion IS NOT NULL
  );

ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_trend_chk;
ALTER TABLE trade_overrides
  DROP COLUMN IF EXISTS trend,
  DROP COLUMN IF EXISTS signals;
