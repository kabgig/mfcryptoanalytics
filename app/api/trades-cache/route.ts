import { getIfFresh, getStoredTrades } from "@/lib/db/trades"
import { enforceBodyLimit } from "@/lib/api/body-limit"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request)
  if (tooLarge) return tooLarge

  try {
    const { exchange, allowStale } = await request.json() as {
      exchange?: unknown
      allowStale?: unknown
    }
    if (typeof exchange !== "string" || exchange.length === 0 || exchange.length > 32) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    const result = await getIfFresh(user.telegramId, exchange)
    if (result.fresh) return Response.json({ fresh: true, trades: result.trades })

    // The client-fetch path (Binance/Bybit in the browser) asks for stored
    // trades when a rate-limit cooldown makes a live fetch impossible — the
    // alternative is an empty dashboard for the whole cooldown window.
    if (allowStale === true) {
      return Response.json({ fresh: false, stale: true, trades: await getStoredTrades(user.telegramId, exchange) })
    }
    return Response.json({ fresh: false, trades: [] })
  } catch (err) {
    return serverError("trades-cache", err, 500)
  }
}
