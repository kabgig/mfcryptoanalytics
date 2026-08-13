import { getSql } from "@/lib/db"
import { upsertTrades, insertTradesSkipExisting, getDeletedKeys } from "@/lib/db/trades"
import type { Trade } from "@/types"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
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
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
