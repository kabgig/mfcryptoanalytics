import { getDeletedTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * POST — returns { trades }, the session user's soft-deleted trades across all
 * exchanges.
 * Every other read path hides them, so this backs the "show deleted" toggle.
 */
export async function POST() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const trades = await getDeletedTrades(user.telegramId)
    return Response.json({ trades })
  } catch (err) {
    return serverError("trades/deleted", err, 500)
  }
}
