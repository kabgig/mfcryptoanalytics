import { NextResponse } from "next/server"
import { getSql } from "@/lib/db"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Every user's id, name, role and PnL — the most sensitive read in the app, and
 * until now completely unauthenticated.
 *
 * STOPGAP. The caller's `telegramId` still comes from the client, so this proves
 * only that the caller knows an admin's Telegram id, not that they are one. It
 * closes the anonymous full dump — which was also the thing publishing the id
 * list that makes every other route impersonatable — and it reads `role` from
 * the database rather than trusting the client's copy. Replace the whole block
 * with `requireAdmin()` once sessions land (Phase 2).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || !/^\d{1,19}$/.test(telegramId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const sql = getSql()

    const roleRows = await sql`
      SELECT role FROM users WHERE telegram_id = ${BigInt(telegramId)} LIMIT 1
    ` as { role: string }[]

    // An unknown user and a non-admin get the same answer, so the response
    // cannot be used to probe which ids exist or which of them are admins.
    if (roleRows.length === 0 || roleRows[0].role !== "ADMIN") {
      console.warn(`[admin/users] denied for telegram_id=${telegramId}`)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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
      -- Soft-deleted trades are excluded from the counts/PnL. The filter stays in
      -- the ON clause so users with no visible trades are still listed.
      LEFT JOIN cached_trades ct
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
