-- migrate:up
-- Two more columns on the futures journal row:
--
--   entry_order — whether the position was entered with a limit or a market
--                 order. Single-valued, and pinned by a CHECK like strategy,
--                 timeframe, killzone and trend: an order is one or the other.
--   notes       — the one free-text note on a trade. It replaces the three
--                 before/during/after notes in trade_notes, which the UI no
--                 longer reads or writes.
--
-- notes lives on trade_overrides rather than staying in trade_notes so the
-- journal form saves everything in one request and one row — the reason
-- 20260828000001 gave for putting the whole journal on this table.
--
-- trade_notes is deliberately left untouched: nothing hard-deletes user data,
-- and it is the rollback. Once this has been live for a while it can be dropped
-- in a migration of its own.
--
-- Idempotent throughout: IF NOT EXISTS columns, DROP-then-ADD constraints, and a
-- copy that only fills a note that is still empty.

ALTER TABLE public.trade_overrides ADD COLUMN IF NOT EXISTS entry_order text;
ALTER TABLE public.trade_overrides ADD COLUMN IF NOT EXISTS notes       text;

ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_entry_order_chk;
ALTER TABLE public.trade_overrides ADD  CONSTRAINT trade_overrides_entry_order_chk
  CHECK (entry_order IS NULL OR entry_order IN ('limit', 'market'));

-- Blank is stored as NULL, never as '' — the same rule trade_notes_body_chk
-- enforced — so "has a note" and "notes IS NOT NULL" stay the same question.
-- The length cap is MAX_NOTES_LENGTH in lib/services/overridesService.ts; the
-- API enforces it first and this is the backstop.
ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_notes_chk;
ALTER TABLE public.trade_overrides ADD  CONSTRAINT trade_overrides_notes_chk
  CHECK (notes IS NULL OR (length(btrim(notes)) > 0 AND char_length(notes) <= 16000));

-- Rebuilt over the two new columns, or a trade whose only journal content is a
-- note — the most ordinary entry there is — would be rejected on save. Strictly
-- weaker than the constraint it replaces: every previous term is still here.
ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE public.trade_overrides ADD  CONSTRAINT trade_overrides_empty_chk
  CHECK (
    tp1 IS NOT NULL OR tp2 IS NOT NULL OR sl IS NOT NULL OR entry IS NOT NULL OR
    bias IS NOT NULL OR risk_pct IS NOT NULL OR rr IS NOT NULL OR
    rules_ok IS NOT NULL OR strategy IS NOT NULL OR timeframe IS NOT NULL OR
    killzone IS NOT NULL OR exit_reason IS NOT NULL OR mistake IS NOT NULL OR
    emotion IS NOT NULL OR signals IS NOT NULL OR trend IS NOT NULL OR
    entry_order IS NOT NULL OR notes IS NOT NULL
  );

-- Fold each trade's before/during/after notes into one, in that order, each
-- under a label so the distinction the user made is not lost:
--
--   Before:
--   <before note>
--
--   After:
--   <after note>
--
-- A phase with no note is simply absent. A trade with notes but no journal row
-- gets a row holding only the note.
--
-- ON CONFLICT ... WHERE notes IS NULL: a row that already carries a note (a
-- re-run, or one written by the new UI) is never overwritten.
--
-- Three notes of at most 4000 each plus their labels come to ~12k, inside the
-- 16k cap above.
INSERT INTO public.trade_overrides (telegram_id, exchange, trade_id, notes)
SELECT telegram_id, exchange, trade_id,
       string_agg(
         CASE phase WHEN 'before' THEN 'Before:' WHEN 'during' THEN 'During:' ELSE 'After:' END
           || E'\n' || body,
         E'\n\n'
         ORDER BY CASE phase WHEN 'before' THEN 1 WHEN 'during' THEN 2 ELSE 3 END
       )
  FROM public.trade_notes
 GROUP BY telegram_id, exchange, trade_id
ON CONFLICT (telegram_id, exchange, trade_id) DO UPDATE
   SET notes = EXCLUDED.notes, updated_at = now()
 WHERE public.trade_overrides.notes IS NULL;

-- migrate:down
-- trade_notes still holds every original note, so dropping the column loses
-- nothing that was migrated. A row kept alive only by a note or an order type
-- would violate the restored empty_chk, so it goes first — while the columns
-- are still there to be read.
DELETE FROM public.trade_overrides
 WHERE tp1 IS NULL AND tp2 IS NULL AND sl IS NULL AND entry IS NULL
   AND bias IS NULL AND risk_pct IS NULL AND rr IS NULL
   AND rules_ok IS NULL AND strategy IS NULL AND timeframe IS NULL
   AND killzone IS NULL AND exit_reason IS NULL AND mistake IS NULL
   AND emotion IS NULL AND signals IS NULL AND trend IS NULL;

ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_empty_chk;
ALTER TABLE public.trade_overrides ADD  CONSTRAINT trade_overrides_empty_chk
  CHECK (
    tp1 IS NOT NULL OR tp2 IS NOT NULL OR sl IS NOT NULL OR entry IS NOT NULL OR
    bias IS NOT NULL OR risk_pct IS NOT NULL OR rr IS NOT NULL OR
    rules_ok IS NOT NULL OR strategy IS NOT NULL OR timeframe IS NOT NULL OR
    killzone IS NOT NULL OR exit_reason IS NOT NULL OR mistake IS NOT NULL OR
    emotion IS NOT NULL OR signals IS NOT NULL OR trend IS NOT NULL
  );

ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_notes_chk;
ALTER TABLE public.trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_entry_order_chk;
ALTER TABLE public.trade_overrides
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS entry_order;
