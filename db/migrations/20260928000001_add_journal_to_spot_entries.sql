-- migrate:up
-- A short journal on every spot entry: was it planned, why it was taken, how it
-- felt, and a free-text note.
--
-- Columns on the existing row rather than a side table, for the reason
-- 20260828000001 gave for trade_overrides: one row per entry is what stops the
-- popup and the CSV export from ever disagreeing, and an entry and its journal
-- are soft-deleted together.
--
-- `why` and `feeling` are multi-valued and store their tags '|'-joined in one
-- text column, like trade_overrides.signals. No CHECK on them for the same
-- reason signals has none: an IN (...) list cannot accept 'dca|dip', and the
-- vocabulary is validated in lib/services/spotJournalFields.ts on the way in
-- and again on the way out.
--
-- Every column is nullable and defaults to NULL, so existing rows read as
-- "no journal" and code that selects explicit columns is unaffected.
--
-- Idempotent throughout: IF NOT EXISTS columns, DROP-then-ADD constraints.

ALTER TABLE public.spot_entries ADD COLUMN IF NOT EXISTS planned boolean;
ALTER TABLE public.spot_entries ADD COLUMN IF NOT EXISTS why     text;
ALTER TABLE public.spot_entries ADD COLUMN IF NOT EXISTS feeling text;
ALTER TABLE public.spot_entries ADD COLUMN IF NOT EXISTS note    text;

-- Same cap as the futures notes. The API enforces it first; this is the backstop.
ALTER TABLE public.spot_entries DROP CONSTRAINT IF EXISTS spot_entries_note_len_chk;
ALTER TABLE public.spot_entries ADD  CONSTRAINT spot_entries_note_len_chk
  CHECK (note IS NULL OR char_length(note) <= 4000);

-- migrate:down
ALTER TABLE public.spot_entries DROP CONSTRAINT IF EXISTS spot_entries_note_len_chk;
ALTER TABLE public.spot_entries
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS feeling,
  DROP COLUMN IF EXISTS why,
  DROP COLUMN IF EXISTS planned;
