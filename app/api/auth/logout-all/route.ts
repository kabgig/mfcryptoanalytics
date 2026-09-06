import { cookies } from "next/headers"
import {
  SESSION_COOKIE,
  requireUser,
  revokeAllSessionsForUser,
  sessionCookieOptions,
} from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Revokes every session belonging to the caller, on every device, and clears the
 * cookie here too. Revocation is immediate: getSessionUser reads revoked_at on
 * each request, so a token captured elsewhere stops working at once.
 */
export async function POST() {
  const user = await requireUser()
  if (user instanceof Response) return user

  // While impersonating, requireUser resolves to the TARGET user — revoking here
  // would sign out an innocent person and leave the admin's own sessions intact.
  // Refuse rather than guess which identity was meant.
  if (user.impersonating) {
    return Response.json(
      { error: "Stop impersonating before signing out all devices" },
      { status: 403 }
    )
  }

  try {
    const revoked = await revokeAllSessionsForUser(user.userId)

    const store = await cookies()
    store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 })

    console.warn(`[auth/logout-all] ${user.telegramId} revoked ${revoked} sessions`)
    return Response.json({ ok: true, revoked })
  } catch (err) {
    return serverError("auth/logout-all", err)
  }
}
