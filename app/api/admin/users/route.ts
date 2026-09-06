import { NextResponse } from "next/server"
import { getSql } from "@/lib/db"
import { serverError } from "@/lib/api/errors"
import { requireAdmin } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * Every user's id, name, role and PnL — the most sensitive read in the app.
 * requireAdmin reads `role` from the database on every request, so a demotion
 * takes effect immediately and the client cannot forge it.
 */
export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

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
      FROM public.users u
      -- Soft-deleted trades are excluded from the counts/PnL. The filter stays in
      -- the ON clause so users with no visible trades are still listed.
      LEFT JOIN public.cached_trades ct
        ON ct.telegram_id = u.telegram_id
       AND ct.deleted_at IS NULL
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
    return serverError("admin/users", err, 500)
  }
}
