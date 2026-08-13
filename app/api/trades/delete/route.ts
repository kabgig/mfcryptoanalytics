import { softDeleteTrade } from "@/lib/db/trades"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, exchange: string, id: string }
 * Soft-deletes one trade: it stays in cached_trades but is hidden from every
 * read path (dashboard, share links, admin totals) and survives re-syncs.
 * Reversible via /api/trades/restore.
 *
 * Like every other route here, telegramId is taken from the body and not
 * verified — the scoping below only prevents deleting a *different* user's trade
 * by id alone, it is not authentication.
 */
export async function POST(request: Request) {
  try {
    const { telegramId, exchange, id } = await request.json() as {
      telegramId: string
      exchange: string
      id: string
    }

    if (!telegramId || !exchange || !id) {
      return Response.json({ error: "Missing fields" }, { status: 400 })
    }

    const ok = await softDeleteTrade(String(telegramId), exchange, id)
    if (!ok) return Response.json({ error: "Trade not found" }, { status: 404 })

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
