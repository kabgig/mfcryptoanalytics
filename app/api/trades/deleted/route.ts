import { getDeletedTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string }
 * Returns { trades } — the user's soft-deleted trades across all exchanges.
 * Every other read path hides them, so this backs the "show deleted" toggle.
 */
export async function POST(request: Request) {
  try {
    const { telegramId } = await request.json() as { telegramId: string }

    if (!telegramId) {
      return Response.json({ error: "Missing telegramId" }, { status: 400 })
    }

    const trades = await getDeletedTrades(String(telegramId))
    return Response.json({ trades })
  } catch (err) {
    return serverError("trades/deleted", err, 500)
  }
}
