import { cookies } from "next/headers"
import {
  SESSION_COOKIE,
  clientIp,
  consumeLoginToken,
  createSession,
  sessionCookieOptions,
} from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Redeems the one-shot token from the bot's magic link and sets the session
 * cookie. Public by necessity — there is no cookie yet at this point.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")

  const redirect = (path: string) =>
    new Response(null, { status: 303, headers: { Location: path } })

  // base64url of 32 bytes is always 43 chars; anything else cannot be ours.
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return redirect("/?auth=invalid")
  }

  try {
    const userId = await consumeLoginToken(token)
    // Unknown, expired and already-used are indistinguishable here by design.
    if (!userId) return redirect("/?auth=expired")

    const raw = await createSession(userId, {
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request.headers),
    })

    const store = await cookies()
    store.set(SESSION_COOKIE, raw, sessionCookieOptions)

    return redirect("/")
  } catch (err) {
    return serverError("auth/exchange", err)
  }
}
