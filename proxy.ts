import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"
import { MODERATE, STRICT, rateLimit, type RateLimitTier } from "@/lib/rate-limit"
import { maybeAlertDistributed, maybeAlertFlood } from "@/lib/security-alert"

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
  // Exact match: /api/auth/logout-all must NOT inherit this, it needs a session.
  "/api/auth/logout",     // must work even with an already-invalid cookie
  "/api/telegram/webhook", // guarded by its own constant-time secret header
  "/api/cron",            // guarded by CRON_SECRET
  "/api/share/",          // public read-only report, guarded by a 192-bit token
  "/api/spot/symbols",    // static Coinbase ticker list, identical for everyone
]

function isPublic(pathname: string): boolean {
  return PUBLIC_API.some((p) =>
    // A bare path matches exactly; only entries written with a trailing slash
    // match by prefix. Without this, "/api/auth/logout" would also open
    // "/api/auth/logout-all", which must stay behind the cookie gate.
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")
  )
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

/**
 * Loopback is exempt outside production.
 *
 * Every request in local development and in the test suites comes from
 * 127.0.0.1, so they share a single bucket and the suites trip the STRICT tier
 * on /api/auth/* while signing in a handful of users. On Vercel the client IP
 * arrives via x-forwarded-for and is never loopback, so this cannot widen
 * anything in production — and it is gated on NODE_ENV as well.
 *
 * The limiter itself is unit-tested directly (scripts/test/rateLimit.test.ts),
 * so exempting it here costs no coverage.
 */
function isExemptFromRateLimit(ip: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  return ip === "127.0.0.1" || ip === "::1" || ip === "unknown"
}

/** x-real-ip first; only the FIRST hop of x-forwarded-for is trustworthy. */
function clientIp(request: NextRequest): string {
  const real = request.headers.get("x-real-ip")
  if (real) return real.trim()
  const fwd = request.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim() || "unknown"
  return "unknown"
}

/**
 * Feeds the flood detectors. Every block (401 and 429) is recorded, and any
 * resulting alert goes to waitUntil so notifying an admin never delays the
 * response the attacker is already being refused.
 */
function reportBlock(
  event: NextFetchEvent,
  ip: string,
  pathname: string,
  reason: "401" | "429"
) {
  const flood = maybeAlertFlood(ip, pathname, reason)
  if (flood) event.waitUntil(flood)
  const dist = maybeAlertDistributed(ip, reason)
  if (dist) event.waitUntil(dist)
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  const ip = clientIp(request)

  const tier = isExemptFromRateLimit(ip) ? null : tierFor(pathname)
  if (tier) {
    const { ok, retryAfter } = rateLimit(`${ip}:${pathname}`, tier)
    if (!ok) {
      console.warn(`[proxy] rate limited ${ip} on ${pathname}`)
      reportBlock(event, ip, pathname, "429")
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }
  }

  // Plain next(), deliberately. An earlier version rewrote the request headers
  // here (NextResponse.next({ request: { headers } })) to stamp the route for
  // the authenticated-abuse detector. That made the dashboard flaky: the
  // overrides UI suite went from 4/5 passing to 1/4, with journal state going
  // missing mid-flow. Not worth a label in an alert — do not reintroduce it.
  const forward = () => NextResponse.next()

  if (isPublic(pathname)) return forward()

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    reportBlock(event, ip, pathname, "401")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // A cookie is present. Whether it is *valid* is the route guard's job — this
  // layer deliberately does no database work.
  return forward()
}

export const config = {
  matcher: "/api/:path*",
}
