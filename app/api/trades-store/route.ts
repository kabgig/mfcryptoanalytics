import { getSql } from "@/lib/db"
import { upsertTrades, insertTradesSkipExisting, getDeletedKeys } from "@/lib/db/trades"
import type { Trade } from "@/types"
import { serverError } from "@/lib/api/errors"
import {
  enforceBodyLimit,
  MAX_TRADES_PER_REQUEST,
  TRADE_BATCH_BODY_LIMIT,
} from "@/lib/api/body-limit"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request, TRADE_BATCH_BODY_LIMIT)
  if (tooLarge) return tooLarge

  try {
    const { exchange, trades, skipExisting } = await request.json() as {
      exchange: string
      trades: Trade[]
      skipExisting?: boolean
    }

    if (!exchange || !Array.isArray(trades)) {
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

    // The user row already exists — the session could not have been created
    // otherwise — so the old defensive upsert here is gone.

    // Binance/Bybit are fetched in the browser and only persisted here, so the
    // caller holds an unfiltered array. Hand back the soft-deleted ids for this
    // exchange so it can drop them before rendering.
    const deletedIds = [...await getDeletedKeys(user.telegramId, exchange)]

    if (skipExisting) {
      const saved = await insertTradesSkipExisting(user.telegramId, exchange, trades)
      return Response.json({ ok: true, saved, deletedIds })
    }

    await upsertTrades(user.telegramId, exchange, trades)
    return Response.json({ ok: true, deletedIds })
  } catch (err) {
    return serverError("trades-store", err, 500)
  }
}
