import { getAllStoredTrades } from "@/lib/db/trades"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function POST() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const trades = await getAllStoredTrades(user.telegramId)
    return Response.json({ trades })
  } catch (err) {
    return serverError("trades-cache/all", err, 500)
  }
}
