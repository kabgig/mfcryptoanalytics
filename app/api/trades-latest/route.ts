import { getLatestCloseTime } from "@/lib/db/trades"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { telegramId, exchange } = await request.json()
    if (!telegramId || !exchange) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }
    const latestMs = await getLatestCloseTime(String(telegramId), exchange)
    return Response.json({ latestMs })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
