import { getIfFresh } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const { exchange } = await request.json()
    if (!exchange) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }
    const result = await getIfFresh(user.telegramId, exchange)
    if (result.fresh) return Response.json({ fresh: true, trades: result.trades })
    return Response.json({ fresh: false, trades: [] })
  } catch (err) {
    return serverError("trades-cache", err, 500)
  }
}
