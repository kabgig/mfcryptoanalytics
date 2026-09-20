-- migrate:up
-- Rename the `poi` signal to `at_level`.
--
-- A data migration, not a schema one: `signals` carries no CHECK constraint
-- (20260907000001 explains why), so nothing in the schema names the tag — only
-- the rows that already chose it do. It has to run, because
-- lib/services/journalFields.ts no longer lists `poi` as a signal and
-- `normalizeChoices` drops what it cannot recognise: left alone, every trade
-- tagged `poi` would silently lose that tag the next time its journal was saved,
-- and would export blank in that column immediately.
--
-- Tag-wise rather than replace(): the column stores a '|'-joined list, and a
-- blind string replace would also rewrite any future slug that merely contained
-- 'poi'. Splitting on the delimiter renames the whole tag or nothing.
--
-- Position is preserved with WITH ORDINALITY, and `at_level` takes the slot
-- `poi` held at the head of SIGNALS, so a rewritten row is still in the
-- canonical order normalizeChoices would produce — a later re-save is a no-op
-- rather than looking like an edit.
--
-- Idempotent: once no row holds the tag, the WHERE matches nothing.
UPDATE public.trade_overrides
   SET signals = array_to_string(
         ARRAY(
           SELECT CASE WHEN tag = 'poi' THEN 'at_level' ELSE tag END
             FROM unnest(string_to_array(signals, '|')) WITH ORDINALITY AS t(tag, ord)
            ORDER BY ord
         ), '|')
 WHERE signals IS NOT NULL
   AND 'poi' = ANY (string_to_array(signals, '|'));

-- migrate:down
UPDATE public.trade_overrides
   SET signals = array_to_string(
         ARRAY(
           SELECT CASE WHEN tag = 'at_level' THEN 'poi' ELSE tag END
             FROM unnest(string_to_array(signals, '|')) WITH ORDINALITY AS t(tag, ord)
            ORDER BY ord
         ), '|')
 WHERE signals IS NOT NULL
   AND 'at_level' = ANY (string_to_array(signals, '|'));
