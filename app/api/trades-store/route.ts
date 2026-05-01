import { getSql } from "@/lib/db"
import { upsertTrades, insertTradesSkipExisting } from "@/lib/db/trades"
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

    if (skipExisting) {
      const saved = await insertTradesSkipExisting(telegramId, exchange, trades)
      return Response.json({ ok: true, saved })
    }

    await upsertTrades(telegramId, exchange, trades)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
