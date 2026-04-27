import { getIfFresh } from "@/lib/db/trades"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { telegramId, exchange } = await request.json()
    if (!telegramId || !exchange) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }
    const result = await getIfFresh(String(telegramId), exchange)
    if (result.fresh) return Response.json({ fresh: true, trades: result.trades })
    return Response.json({ fresh: false, trades: [] })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
