import { cookies } from "next/headers"
import { SESSION_COOKIE, revokeSession, sessionCookieOptions } from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Revokes the current session server-side and clears the cookie. Both halves
 * matter: clearing the cookie alone would leave a token that still validates if
 * it were ever captured.
 */
export async function POST() {
  try {
    const store = await cookies()
    const raw = store.get(SESSION_COOKIE)?.value
    if (raw) await revokeSession(raw)
    store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 })
    return Response.json({ ok: true })
  } catch (err) {
    return serverError("auth/logout", err)
  }
}
