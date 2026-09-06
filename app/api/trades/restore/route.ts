import { restoreTrade } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, exchange: string, id: string }
 * Clears deleted_at, making a soft-deleted trade visible again everywhere.
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

    const ok = await restoreTrade(user.telegramId, exchange, id)
    if (!ok) return Response.json({ error: "Trade not found" }, { status: 404 })

    return Response.json({ ok: true })
  } catch (err) {
    return serverError("trades/restore", err, 500)
  }
}
