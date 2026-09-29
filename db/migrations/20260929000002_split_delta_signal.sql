-- migrate:up
-- Split the `delta` signal into `delta1_5` and `delta5`; every stored `delta`
-- becomes `delta5`.
--
-- A data migration, like 20260920000001 (poi → at_level) and for the same
-- reason: `signals` has no CHECK, and lib/services/journalFields.ts no longer
-- lists `delta`, so normalizeChoices would silently drop it on the next save and
-- the export would show the column blank immediately.
--
-- Tag-wise rather than replace(), so `delta1_5` or any future slug containing
-- 'delta' can never be rewritten by accident. `delta5` takes the slot `delta`
-- held in SIGNALS, so a rewritten row stays in canonical order and a later
-- re-save is a no-op.
--
-- Idempotent: once no row holds the tag, the WHERE matches nothing.
UPDATE public.trade_overrides
   SET signals = array_to_string(
         ARRAY(
           SELECT CASE WHEN tag = 'delta' THEN 'delta5' ELSE tag END
             FROM unnest(string_to_array(signals, '|')) WITH ORDINALITY AS t(tag, ord)
            ORDER BY ord
         ), '|')
 WHERE signals IS NOT NULL
   AND 'delta' = ANY (string_to_array(signals, '|'));

-- migrate:down
-- Both halves fold back into `delta`, once. `ask1_5` is left as it is: the old
-- code ignores a tag it does not know, and it comes back if this is re-applied.
UPDATE public.trade_overrides
   SET signals = array_to_string(
         ARRAY(
           SELECT tag
             FROM (
               SELECT CASE WHEN tag IN ('delta1_5', 'delta5') THEN 'delta' ELSE tag END AS tag,
                      min(ord) AS ord
                 FROM unnest(string_to_array(signals, '|')) WITH ORDINALITY AS t(tag, ord)
                GROUP BY 1
             ) folded
            ORDER BY ord
         ), '|')
 WHERE signals IS NOT NULL
   AND string_to_array(signals, '|') && ARRAY['delta1_5', 'delta5'];
