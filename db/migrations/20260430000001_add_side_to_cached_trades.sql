-- migrate:up
ALTER TABLE cached_trades ADD COLUMN IF NOT EXISTS side VARCHAR(5);

-- migrate:down
ALTER TABLE cached_trades DROP COLUMN IF EXISTS side;
