import { NextResponse, type NextRequest } from "next/server"
import { MODERATE, STRICT, rateLimit, type RateLimitTier } from "@/lib/rate-limit"

/**
 * Edge gate over /api/*. This is NOT authorization — every route still calls
 * requireUser()/requireAdmin() and does the real database check. This is the
 * safety net: a route added without a guard is still closed by default, because
 * a request with no session cookie never reaches it.
 *
 * Kept standalone on purpose. Importing lib/auth/session here would pull the
 * database driver and node:crypto into the proxy bundle, which runs on every
 * single request. The cookie name is inlined below for the same reason —
 * lib/auth/session.ts is the source of truth, keep the two in step.
 */
const SESSION_COOKIE = "mfca_session"

/**
 * The only /api prefixes reachable without a session. Everything else is closed.
 * Adding to this list makes an endpoint world-readable — do not do it casually.
 */
const PUBLIC_API = [
  "/api/auth/exchange",   // no cookie yet; this is what mints one
  "/api/auth/dev-login",  // 404s outside development
  "/api/auth/logout",     // must work even with an already-invalid cookie
  "/api/telegram/webhook", // guarded by its own constant-time secret header
  "/api/cron",            // guarded by CRON_SECRET
  "/api/share/",          // public read-only report, guarded by a 192-bit token
  "/api/spot/symbols",    // static Coinbase ticker list, identical for everyone
]

function isPublic(pathname: string): boolean {
  return PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * Only the anonymous surface is rate limited. The proxy runs on every request,
 * so metering the cookie-gated routes too would add work to every call for no
 * benefit — those already need a valid session to reach anything.
 */
function tierFor(pathname: string): RateLimitTier | null {
  if (pathname.startsWith("/api/auth/")) return STRICT
  if (pathname.startsWith("/api/share/")) return MODERATE
  return null
}

/** x-real-ip first; only the FIRST hop of x-forwarded-for is trustworthy. */
function clientIp(request: NextRequest): string {
  const real = request.headers.get("x-real-ip")
  if (real) return real.trim()
  const fwd = request.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim() || "unknown"
  return "unknown"
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const tier = tierFor(pathname)
  if (tier) {
    const { ok, retryAfter } = rateLimit(`${clientIp(request)}:${pathname}`, tier)
    if (!ok) {
      console.warn(`[proxy] rate limited ${clientIp(request)} on ${pathname}`)
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }
  }

  if (isPublic(pathname)) return NextResponse.next()

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // A cookie is present. Whether it is *valid* is the route guard's job — this
  // layer deliberately does no database work.
  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
