import { getSql } from "@/lib/db"
import { upsertTrades, insertTradesSkipExisting, getDeletedKeys } from "@/lib/db/trades"
import type { Trade } from "@/types"
import { serverError } from "@/lib/api/errors"
import {
  enforceBodyLimit,
  MAX_TRADES_PER_REQUEST,
  TRADE_BATCH_BODY_LIMIT,
} from "@/lib/api/body-limit"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const tooLarge = enforceBodyLimit(request, TRADE_BATCH_BODY_LIMIT)
  if (tooLarge) return tooLarge

  try {
    const { telegramId, exchange, trades, skipExisting } = await request.json() as {
      telegramId: string
      exchange: string
      trades: Trade[]
      skipExisting?: boolean
    }

    if (!telegramId || !exchange || !Array.isArray(trades)) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    // upsertTrades issues one round-trip per trade, so an unbounded array is a
    // database-fill and compute-cost DoS in a single request.
    if (trades.length > MAX_TRADES_PER_REQUEST) {
      return Response.json(
        { error: `Too many trades (max ${MAX_TRADES_PER_REQUEST} per request)` },
        { status: 413 }
      )
    }

    const sql = getSql()
    await sql`
      INSERT INTO users (telegram_id, telegram_name)
      VALUES (${BigInt(telegramId)}, ${'unknown'})
      ON CONFLICT (telegram_id) DO NOTHING
    `

    // Binance/Bybit are fetched in the browser and only persisted here, so the
    // caller holds an unfiltered array. Hand back the soft-deleted ids for this
    // exchange so it can drop them before rendering.
    const deletedIds = [...await getDeletedKeys(telegramId, exchange)]

    if (skipExisting) {
      const saved = await insertTradesSkipExisting(telegramId, exchange, trades)
      return Response.json({ ok: true, saved, deletedIds })
    }

    await upsertTrades(telegramId, exchange, trades)
    return Response.json({ ok: true, deletedIds })
  } catch (err) {
    return serverError("trades-store", err, 500)
  }
}
