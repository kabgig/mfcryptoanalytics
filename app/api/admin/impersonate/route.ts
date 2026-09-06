import { cookies } from "next/headers"
import {
  IMPERSONATE_COOKIE,
  getUserByTelegramId,
  requireAdmin,
  sessionCookieOptions,
} from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Admin "view as user".
 *
 * This used to be a client-side swap of a field in localStorage, which was
 * meaningless as a control and unavailable as an audit trail. It is now a
 * server-set cookie that getSessionUser only honours when the real session's
 * role is ADMIN, re-read from the database on every request.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  try {
    const { telegramId } = await request.json() as { telegramId?: string }
    if (!telegramId || !/^\d{1,19}$/.test(telegramId)) {
      return Response.json({ error: "Invalid telegramId" }, { status: 400 })
    }

    const target = await getUserByTelegramId(telegramId)
    if (!target) return Response.json({ error: "Not found" }, { status: 404 })

    console.warn(`[admin/impersonate] ${admin.telegramId} started acting as ${target.telegramId}`)

    const store = await cookies()
    store.set(IMPERSONATE_COOKIE, target.telegramId, sessionCookieOptions)

    return Response.json({
      ok: true,
      telegramId: target.telegramId,
      telegramName: target.telegramName,
      role: target.role,
    })
  } catch (err) {
    return serverError("admin/impersonate", err)
  }
}

/**
 * Stop impersonating. Deliberately NOT behind requireAdmin: while the cookie is
 * set the effective role is the target's, so requiring admin here would trap the
 * admin as that user. Clearing a cookie for yourself is harmless.
 */
export async function DELETE() {
  const store = await cookies()
  store.set(IMPERSONATE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 })
  return Response.json({ ok: true })
}
