import { getSql } from "@/lib/db"
import type { Trade } from "@/types"

export const dynamic = "force-dynamic"

function rowToTrade(r: Record<string, unknown>): Trade {
  return {
    id: r.id as string,
    exchange: r.exchange as string,
    ticker: r.ticker as string,
    positionSize: Number(r.position_size),
    tp: r.tp != null ? Number(r.tp) : null,
    sl: r.sl != null ? Number(r.sl) : null,
    openTime: (r.open_time as Date).toISOString(),
    closeTime: (r.close_time as Date).toISOString(),
    pnl: Number(r.pnl),
    market: r.market as Trade["market"],
    side: (r.side as Trade["side"]) ?? undefined,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return Response.json({ error: "Invalid token" }, { status: 400 })
  }

  try {
    const sql = getSql()

    // Resolve token → user (no identity data returned)
    const userRows = await sql`
      SELECT id FROM users WHERE share_token = ${token} LIMIT 1
    ` as { id: string }[]

    if (userRows.length === 0) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const userId = userRows[0].id

    // Fetch all cached trades for that user via internal id
    const tradeRows = await sql`
      SELECT ct.id, ct.exchange, ct.ticker, ct.position_size, ct.tp, ct.sl,
             ct.open_time, ct.close_time, ct.pnl, ct.market, ct.side
      FROM cached_trades ct
      JOIN users u ON u.telegram_id = ct.telegram_id
      WHERE u.id = ${userId}
      ORDER BY ct.close_time DESC
    ` as Record<string, unknown>[]

    return Response.json({ trades: tradeRows.map(rowToTrade) })
  } catch (err) {
    console.error("[share/token] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
