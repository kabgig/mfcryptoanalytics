-- migrate:up
-- OKX, MEXC and Bitunix all built their futures trade id from the position's
-- *update* time (uTime / updateTime / mtime). Those exchanges mutate a position
-- history record in place when you close part of a position: pnl accumulates and
-- the update time advances. So every partial close produced a NEW id, which was
-- inserted as an extra trade instead of updating the existing row — and since
-- nothing prunes cached rows whose id vanished from the exchange response, the
-- intermediate snapshot survived forever as a ghost trade inflating the stats.
--
-- The adapters now key on the position's OPEN time, which is immutable for a
-- position instance and still distinguishes recycled position ids.
--
-- This rewrites the existing rows in place rather than purging them. A purge
-- would be simpler but destructive: OKX's positions-history only retains ~3
-- months and the cached history reaches further back than the exchanges will
-- re-serve, so re-fetching would permanently lose the oldest trades.
-- The trailing timestamp is reconstructed from open_time, verified to round-trip
-- exactly on all existing rows.
--
-- Idempotent: re-running strips the same suffix and re-appends the same value.

-- 1. Collapse rows that become duplicates under the new id — these are snapshots
--    of one position taken at different points as it was closed down. Keep the
--    latest close_time: that row holds the final, cumulative pnl.
WITH mapped AS (
  SELECT telegram_id, exchange, id, close_time,
         regexp_replace(id, '-[0-9]+$', '') || '-' ||
           (EXTRACT(EPOCH FROM open_time) * 1000)::numeric::bigint AS new_id
  FROM cached_trades
  WHERE exchange IN ('OKX', 'MEXC', 'Bitunix')
    AND id LIKE '%-futures-%'
    AND id ~ '-[0-9]+$'
),
losers AS (
  SELECT telegram_id, exchange, id
  FROM (
    SELECT telegram_id, exchange, id,
           row_number() OVER (
             PARTITION BY telegram_id, exchange, new_id
             ORDER BY close_time DESC, id DESC
           ) AS rn
    FROM mapped
  ) ranked
  WHERE rn > 1
)
DELETE FROM cached_trades ct
USING losers l
WHERE ct.telegram_id = l.telegram_id
  AND ct.exchange    = l.exchange
  AND ct.id          = l.id;

-- 2. Rewrite the surviving ids to the new format.
UPDATE cached_trades
SET id = regexp_replace(id, '-[0-9]+$', '') || '-' ||
         (EXTRACT(EPOCH FROM open_time) * 1000)::numeric::bigint
WHERE exchange IN ('OKX', 'MEXC', 'Bitunix')
  AND id LIKE '%-futures-%'
  AND id ~ '-[0-9]+$'
  AND id IS DISTINCT FROM
      regexp_replace(id, '-[0-9]+$', '') || '-' ||
      (EXTRACT(EPOCH FROM open_time) * 1000)::numeric::bigint;

-- exchange_fetch_log is deliberately NOT cleared: the rewritten ids already match
-- what the adapters now produce, so the next fetch upserts onto these rows and no
-- forced re-fetch is needed.

-- migrate:down
-- No-op. The old ids embedded the position's update time, which cannot be
-- recovered from the open time — the mapping is not reversible. Same precedent
-- as 20260708120000_purge_stale_futures_cache.sql.
SELECT 1;
