import { getSql } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * POST { telegramId: string, ids: string[] }
 * Returns { existingIds: string[] } — the subset of ids already in the DB for this user.
 */
export async function POST(request: Request) {
  try {
    const { telegramId, ids } = await request.json() as {
      telegramId: string
      ids: string[]
    }

    if (!telegramId || !Array.isArray(ids) || ids.length === 0) {
      return Response.json({ existingIds: [] })
    }

    const sql = getSql()
    const rows = await sql`
      SELECT id
      FROM cached_trades
      WHERE telegram_id = ${BigInt(telegramId)}
        AND id = ANY(${ids}::text[])
    ` as { id: string }[]

    return Response.json({ existingIds: rows.map((r) => r.id) })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
