import { getStoredTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { enforceBodyLimit } from "@/lib/api/body-limit"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * POST { exchange: string }
 * Returns all stored trades for that exchange with no freshness expiry.
 * Used for manual imports like Jupiter Perps.
 */
export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request)
  if (tooLarge) return tooLarge

  try {
    const { exchange } = await request.json() as { exchange: string }

    if (!exchange) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    const trades = await getStoredTrades(user.telegramId, exchange)
    return Response.json({ trades })
  } catch (err) {
    return serverError("import/trades", err, 500)
  }
}
