-- migrate:up
-- Turns trade_overrides from "three corrections" into the user's full hand-written
-- record of a trade: the plan made before entry (strategy, timeframe, killzone,
-- entry, TP1/TP2, SL, risk %, R:R) and the review written after the exit
-- (rules followed, exit reason, mistake, emotion).
--
-- Still one row per trade in this table rather than a new one: same key, same
-- lifecycle, same reason for living outside cached_trades (upsertTrades rewrites
-- tp/sl/side from EXCLUDED on every sync and would wipe anything user-authored).
-- Keeping it in one row is also what stops the form and the CSV export from ever
-- disagreeing about a trade's TP.
--
-- The table name now undersells what it holds; renaming it would cascade through
-- six files and a route for no user-visible gain, so it stays.
--
-- Idempotent throughout: guarded rename, IF NOT EXISTS columns, DROP-then-ADD
-- constraints. Safe to re-run against a database that already has all of this.

-- tp becomes tp1 — the single take-profit is now the first of two. A rename
-- rather than add-and-copy, so existing values carry over untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_overrides' AND column_name = 'tp'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_overrides' AND column_name = 'tp1'
  ) THEN
    ALTER TABLE trade_overrides RENAME COLUMN tp TO tp1;
  END IF;
END $$;

ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS tp1         numeric;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS tp2         numeric;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS entry       numeric;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS risk_pct    numeric;
-- Reward-to-risk. Normally derived from entry/tp1/sl and not stored at all; a
-- value here is the user overriding that arithmetic, so it must be nullable and
-- distinguishable from "not set".
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS rr          numeric;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS rules_ok    boolean;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS strategy    text;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS timeframe   text;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS killzone    text;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS exit_reason text;
-- mistake and emotion carry no CHECK on purpose: those vocabularies will grow,
-- and adding a tag should be a one-line change in lib/services/journalFields.ts,
-- not a migration. They are validated there and in the API route.
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS mistake     text;
ALTER TABLE trade_overrides ADD COLUMN IF NOT EXISTS emotion     text;

-- The four short, stable vocabularies are worth enforcing in the database.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_strategy_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_strategy_chk
  CHECK (strategy IS NULL OR strategy IN ('orderflow', 'pa', 'macro'));

ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_timeframe_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_timeframe_chk
  CHECK (timeframe IS NULL OR timeframe IN ('5m', '15m', '1h'));

ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_killzone_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_killzone_chk
  CHECK (killzone IS NULL OR killzone IN ('asia', 'london', 'nyam', 'nypm', 'outside'));

ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_exit_reason_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_exit_reason_chk
  CHECK (exit_reason IS NULL OR exit_reason IN ('tp1', 'tp2', 'sl', 'be', 'manual'));

-- Numbers a NUMERIC column would happily take but the UI could never render.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_numeric_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_numeric_chk
  CHECK (
    (entry    IS NULL OR entry    >= 0) AND
    (tp1      IS NULL OR tp1      >= 0) AND
    (tp2      IS NULL OR tp2      >= 0) AND
    (sl       IS NULL OR sl       >= 0) AND
    (rr       IS NULL OR rr       >= 0) AND
    (risk_pct IS NULL OR (risk_pct >= 0 AND risk_pct <= 100))
  );

-- Rebuilt over every column: a row still exists only while it carries something,
-- which is what lets the UI treat "row exists" and "this trade has a journal
-- entry" as the same thing.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE trade_overrides ADD  CONSTRAINT trade_overrides_empty_chk
  CHECK (
    tp1 IS NOT NULL OR tp2 IS NOT NULL OR sl IS NOT NULL OR entry IS NOT NULL OR
    bias IS NOT NULL OR risk_pct IS NOT NULL OR rr IS NOT NULL OR
    rules_ok IS NOT NULL OR strategy IS NOT NULL OR timeframe IS NOT NULL OR
    killzone IS NOT NULL OR exit_reason IS NOT NULL OR mistake IS NOT NULL OR
    emotion IS NOT NULL
  );

-- migrate:down
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_numeric_chk;
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_exit_reason_chk;
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_killzone_chk;
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_timeframe_chk;
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_strategy_chk;
ALTER TABLE trade_overrides
  DROP COLUMN IF EXISTS emotion,
  DROP COLUMN IF EXISTS mistake,
  DROP COLUMN IF EXISTS exit_reason,
  DROP COLUMN IF EXISTS killzone,
  DROP COLUMN IF EXISTS timeframe,
  DROP COLUMN IF EXISTS strategy,
  DROP COLUMN IF EXISTS rules_ok,
  DROP COLUMN IF EXISTS rr,
  DROP COLUMN IF EXISTS risk_pct,
  DROP COLUMN IF EXISTS entry,
  DROP COLUMN IF EXISTS tp2;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_overrides' AND column_name = 'tp1'
  ) THEN
    ALTER TABLE trade_overrides RENAME COLUMN tp1 TO tp;
  END IF;
END $$;
ALTER TABLE trade_overrides ADD CONSTRAINT trade_overrides_empty_chk
  CHECK (tp IS NOT NULL OR sl IS NOT NULL OR bias IS NOT NULL);
