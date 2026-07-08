-- migrate:up
-- The futures trade ID format changed to include the close timestamp so that
-- multiple close records sharing a position/order ID no longer collapse into one
-- cached row (OKX, Bybit, MEXC, Bitunix). Old-format rows use a different ID than
-- the new format for the same trade, so they would coexist and double-count.
-- Purge the (fully re-fetchable) cached rows and clear the fetch log for those
-- exchanges only — the next page load repopulates them from the exchange APIs.
-- Imported exchanges (Jupiter Perps, bluefin) are NOT touched: they are not
-- re-fetchable and were never affected by this ID change.
DELETE FROM cached_trades
  WHERE exchange IN ('OKX', 'Bybit', 'MEXC', 'Bitunix');
DELETE FROM exchange_fetch_log
  WHERE exchange IN ('OKX', 'Bybit', 'MEXC', 'Bitunix');

-- migrate:down
-- No-op: cached_trades / exchange_fetch_log are a transient cache that is
-- rebuilt from the exchange APIs on the next fetch.
SELECT 1;
