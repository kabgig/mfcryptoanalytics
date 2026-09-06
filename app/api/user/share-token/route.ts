import { getSql } from "@/lib/db"
import { randomBytes } from "node:crypto"
import { requireUser } from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * The user's public-report token. Scoped to the session throughout: previously
 * any caller could read, mint or revoke any user's token by passing their id,
 * which meant enabling sharing for someone who never asked for it.
 */

// POST — generate a new token, replacing any existing one
export async function POST() {
  const user = await requireUser()
  if (user instanceof Response) return user

  const token = randomBytes(24).toString("hex")

  try {
    const sql = getSql()
    await sql`
      UPDATE public.users SET share_token = ${token}
      WHERE telegram_id = ${BigInt(user.telegramId)}
    `
    return Response.json({ token })
  } catch (err) {
    return serverError("share-token", err)
  }
}

// GET — the caller's current token, or null
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT share_token FROM public.users
      WHERE telegram_id = ${BigInt(user.telegramId)} LIMIT 1
    ` as { share_token: string | null }[]
    return Response.json({ token: rows[0]?.share_token ?? null })
  } catch (err) {
    return serverError("share-token", err)
  }
}

// DELETE — revoke it
export async function DELETE() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const sql = getSql()
    await sql`
      UPDATE public.users SET share_token = NULL
      WHERE telegram_id = ${BigInt(user.telegramId)}
    `
    return Response.json({ ok: true })
  } catch (err) {
    return serverError("share-token", err)
  }
}
