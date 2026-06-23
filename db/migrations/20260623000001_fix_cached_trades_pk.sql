-- migrate:up
-- The original PK (telegram_id, id) does not include exchange, causing trades
-- from different exchanges with the same trade ID to overwrite each other.
-- Correct PK must be (telegram_id, exchange, id).
ALTER TABLE cached_trades DROP CONSTRAINT IF EXISTS cached_trades_pkey;
ALTER TABLE cached_trades ADD PRIMARY KEY (telegram_id, exchange, id);

-- migrate:down
ALTER TABLE cached_trades DROP CONSTRAINT IF EXISTS cached_trades_pkey;
ALTER TABLE cached_trades ADD PRIMARY KEY (telegram_id, id);
