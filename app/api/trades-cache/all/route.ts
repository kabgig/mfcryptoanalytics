import { getAllStoredTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { telegramId } = await request.json()
    if (!telegramId) {
      return Response.json({ error: "Missing telegramId" }, { status: 400 })
    }
    const trades = await getAllStoredTrades(String(telegramId))
    return Response.json({ trades })
  } catch (err) {
    return serverError("trades-cache/all", err, 500)
  }
}
