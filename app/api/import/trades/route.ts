import { getStoredTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { enforceBodyLimit } from "@/lib/api/body-limit"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, exchange: string }
 * Returns all stored trades for that exchange with no freshness expiry.
 * Used for manual imports like Jupiter Perps.
 */
export async function POST(request: Request) {
  const tooLarge = enforceBodyLimit(request)
  if (tooLarge) return tooLarge

  try {
    const { telegramId, exchange } = await request.json() as {
      telegramId: string
      exchange: string
    }

    if (!telegramId || !exchange) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    const trades = await getStoredTrades(String(telegramId), exchange)
    return Response.json({ trades })
  } catch (err) {
    return serverError("import/trades", err, 500)
  }
}
