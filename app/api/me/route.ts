import { requireUser } from "@/lib/auth/session"
import { getSql } from "@/lib/db"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * The single hydration endpoint: who am I, and what does the client need to
 * render the shell? Replaces the old waterfall of /api/user/role plus a
 * share-token read, and is the only thing the client trusts for identity.
 */
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT share_token FROM public.users WHERE id = ${BigInt(user.userId)} LIMIT 1
    ` as { share_token: string | null }[]

    return Response.json({
      telegramId: user.telegramId,
      telegramName: user.telegramName,
      role: user.role,
      impersonating: user.impersonating ?? false,
      actorTelegramId: user.actorTelegramId ?? null,
      shareToken: rows[0]?.share_token ?? null,
    })
  } catch (err) {
    return serverError("me", err)
  }
}
