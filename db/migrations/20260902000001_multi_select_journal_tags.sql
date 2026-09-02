-- migrate:up
-- exit_reason, mistake and emotion become multi-select: one trade can carry
-- several tags, stored in the existing text column as a '|'-joined list
-- ("tp1|sl" = took the first target, then got stopped out of the runner).
--
-- Still one text column rather than text[] or a tag table: the values are a
-- short closed vocabulary, nothing queries them relationally, and the CSV export
-- — the surface these fields exist for — wants one cell per field either way.
-- A joined string also means every existing single-valued row is already a valid
-- one-element list, so there is no data to rewrite.
--
-- '|' is the delimiter because the export is a CSV: a comma would force the
-- writer to quote the cell, and the point of the export is that it pastes into
-- a spreadsheet or an LLM cleanly. lib/services/journalFields.ts owns the
-- delimiter and holds a test that no slug in any vocabulary contains it.

-- The only schema change this needs. mistake and emotion never had a CHECK —
-- deliberately, per 20260828000001 — but exit_reason did, and it would reject
-- 'tp1|sl' as not being one of its five values. The vocabulary is still enforced
-- in lib/services/journalFields.ts, on the API route, on the way into the DB and
-- again on the way out, which is what mistake and emotion have always relied on.
ALTER TABLE trade_overrides DROP CONSTRAINT IF EXISTS trade_overrides_exit_reason_chk;

-- migrate:down
-- Re-adding the CHECK would fail against any row that has since stored more than
-- one exit reason, so collapse those to their first tag first. Lossy, and it has
-- to be: the single-valued column cannot hold what the multi-valued one did.
UPDATE trade_overrides
   SET exit_reason = split_part(exit_reason, '|', 1)
 WHERE exit_reason LIKE '%|%';

ALTER TABLE trade_overrides ADD CONSTRAINT trade_overrides_exit_reason_chk
  CHECK (exit_reason IS NULL OR exit_reason IN ('tp1', 'tp2', 'sl', 'be', 'manual'));
