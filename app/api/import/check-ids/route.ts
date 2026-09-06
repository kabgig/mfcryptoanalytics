import { getSql } from "@/lib/db"
import { serverError } from "@/lib/api/errors"
import {
  enforceBodyLimit,
  MAX_IDS_PER_REQUEST,
  TRADE_BATCH_BODY_LIMIT,
} from "@/lib/api/body-limit"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * POST { ids: string[] }
 * Returns { existingIds: string[] } — the subset of ids already in the DB for this user.
 *
 * Soft-deleted trades count as existing (no `deleted_at IS NULL` filter below):
 * re-uploading the same CSV should leave a deleted trade deleted, not resurrect it.
 */
export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request, TRADE_BATCH_BODY_LIMIT)
  if (tooLarge) return tooLarge

  try {
    const { ids } = await request.json() as { ids: string[] }

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ existingIds: [] })
    }

    if (ids.length > MAX_IDS_PER_REQUEST) {
      return Response.json(
        { error: `Too many ids (max ${MAX_IDS_PER_REQUEST} per request)` },
        { status: 413 }
      )
    }

    const sql = getSql()
    const rows = await sql`
      SELECT id
      FROM public.cached_trades
      WHERE telegram_id = ${BigInt(user.telegramId)}
        AND id = ANY(${ids}::text[])
    ` as { id: string }[]

    return Response.json({ existingIds: rows.map((r) => r.id) })
  } catch (err) {
    return serverError("import/check-ids", err, 500)
  }
}
