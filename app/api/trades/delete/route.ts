import { softDeleteTrade } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, exchange: string, id: string }
 * Soft-deletes one trade: it stays in cached_trades but is hidden from every
 * read path (dashboard, share links, admin totals) and survives re-syncs.
 * Reversible via /api/trades/restore.
 *
 * The owner comes from the session; the SQL is still scoped by telegram_id so
 * ownership is enforced in the query, not assumed from the guard.
 */
export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const { exchange, id } = await request.json() as {
      exchange: string
      id: string
    }

    if (!exchange || !id) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    const ok = await softDeleteTrade(user.telegramId, exchange, id)
    if (!ok) return Response.json({ error: "Trade not found" }, { status: 404 })

    return Response.json({ ok: true })
  } catch (err) {
    return serverError("trades/delete", err, 500)
  }
}
