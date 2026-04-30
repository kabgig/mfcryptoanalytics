import { NextResponse } from "next/server"
import { getSql } from "@/lib/db"

export async function GET() {
  try {
    const sql = getSql()

    const rows = await sql`
      SELECT
        u.telegram_id,
        u.telegram_name,
        u.role,
        u.created_at,
        COUNT(ct.id)::int           AS trade_count,
        COUNT(DISTINCT ct.exchange)  AS exchange_count,
        COALESCE(SUM(ct.pnl), 0)     AS total_pnl
      FROM users u
      LEFT JOIN cached_trades ct ON ct.telegram_id = u.telegram_id
      GROUP BY u.telegram_id, u.telegram_name, u.role, u.created_at
      ORDER BY u.created_at ASC
    ` as {
      telegram_id: bigint
      telegram_name: string
      role: string
      created_at: Date
      trade_count: number
      exchange_count: number
      total_pnl: string
    }[]

    return NextResponse.json(
      rows.map((r) => ({
        telegramId: r.telegram_id.toString(),
        telegramName: r.telegram_name,
        role: r.role,
        createdAt: r.created_at.toISOString(),
        tradeCount: Number(r.trade_count),
        exchangeCount: Number(r.exchange_count),
        totalPnl: parseFloat(r.total_pnl as unknown as string),
      }))
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
