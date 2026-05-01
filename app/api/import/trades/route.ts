import { getStoredTrades } from "@/lib/db/trades"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, exchange: string }
 * Returns all stored trades for that exchange with no freshness expiry.
 * Used for manual imports like Jupiter Perps.
 */
export async function POST(request: Request) {
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
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
