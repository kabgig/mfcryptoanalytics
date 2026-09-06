import { cache } from "react"
import { cookies } from "next/headers"
import { createHash, randomBytes } from "node:crypto"
import { getSql } from "@/lib/db"
import { maybeAlertUserAbuse } from "@/lib/security-alert"

/**
 * Session and login-token handling.
 *
 * The model, in one line: an opaque random token goes to the client, only its
 * SHA-256 hash is stored, and the row it points at is the authority. A database
 * leak therefore cannot produce a login, and revoking a session takes effect on
 * the very next request because validation reads the row every time.
 *
 * No bcrypt/argon here on purpose: the input is already 256 bits of entropy, so
 * a plain hash is the right primitive. Key stretching exists for low-entropy
 * secrets like passwords.
 */

/** Cookie name. The proxy inlines this string — keep the two in step. */
export const SESSION_COOKIE = "mfca_session"

/**
 * Set only while an admin is viewing the app as someone else. It is honoured
 * *solely* when the real session's role is ADMIN, re-checked from the database on
 * every request — so forging it as a normal user achieves nothing.
 */
export const IMPERSONATE_COOKIE = "mfca_impersonate"

const LOGIN_TOKEN_TTL_MINUTES = 10
const SESSION_TTL_DAYS = 30
/**
 * How stale last_seen_at must be before a request writes to user_sessions.
 * Without a throttle every request writes a row; with it, an active user still
 * touches it often enough for rolling expiry to behave identically.
 */
const SESSION_TOUCH_THROTTLE_MINUTES = 15

export interface SessionUser {
  sessionId: string
  userId: string
  telegramId: string
  telegramName: string
  role: "ADMIN" | "USER"
  /** True when an admin is acting as this user. */
  impersonating?: boolean
  /** The admin's own telegram id while impersonating — for audit logging. */
  actorTelegramId?: string
}

/** ~256 bits, URL-safe so it survives a query string intact. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/**
 * Cookie options, defined once so every issuance is identical. `secure` is off
 * in development so plain-HTTP localhost works.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
}

/** Mints a one-shot login token for a user. Returns the RAW token. */
export async function createLoginToken(userId: string | bigint): Promise<string> {
  const sql = getSql()
  const raw = randomToken()
  await sql`
    INSERT INTO public.login_tokens (token_hash, user_id, expires_at)
    VALUES (
      ${hashToken(raw)},
      ${BigInt(userId)},
      NOW() + (${LOGIN_TOKEN_TTL_MINUTES} * INTERVAL '1 minute')
    )
  `
  return raw
}

/**
 * Redeems a login token, returning its user_id or null.
 *
 * One atomic UPDATE, deliberately: unknown, expired and already-used all collapse
 * to zero rows in a single round-trip, so two simultaneous redemptions cannot
 * both succeed. Splitting this into SELECT-then-UPDATE would reintroduce that race.
 */
export async function consumeLoginToken(raw: string): Promise<string | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE public.login_tokens
       SET used_at = NOW()
     WHERE token_hash = ${hashToken(raw)}
       AND used_at IS NULL
       AND expires_at > NOW()
    RETURNING user_id
  ` as { user_id: string }[]
  return rows.length > 0 ? String(rows[0].user_id) : null
}

/** Creates a session row and returns the RAW token for the cookie. */
export async function createSession(
  userId: string | bigint,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): Promise<string> {
  const sql = getSql()
  const raw = randomToken()
  await sql`
    INSERT INTO public.user_sessions
      (user_id, session_token_hash, user_agent, ip, expires_at)
    VALUES (
      ${BigInt(userId)},
      ${hashToken(raw)},
      ${meta.userAgent ?? null},
      ${meta.ip ?? null}::inet,
      NOW() + (${SESSION_TTL_DAYS} * INTERVAL '1 day')
    )
  `
  return raw
}

/** Revocation is immediate: getSessionUser reads revoked_at on every request. */
export async function revokeSession(rawToken: string): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE public.user_sessions
       SET revoked_at = NOW()
     WHERE session_token_hash = ${hashToken(rawToken)}
       AND revoked_at IS NULL
  `
}

export async function revokeAllSessionsForUser(userId: string | bigint): Promise<number> {
  const sql = getSql()
  const rows = await sql`
    UPDATE public.user_sessions
       SET revoked_at = NOW()
     WHERE user_id = ${BigInt(userId)}
       AND revoked_at IS NULL
    RETURNING id
  ` as { id: string }[]
  return rows.length
}

/**
 * Resolves the current session, or null.
 *
 * Wrapped in React `cache()` so several guards in one request share a single
 * round-trip. Identity resolution and the rolling-expiry slide happen in one
 * statement via CTEs; the touch is throttled so an active session does not write
 * on every request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw) return null

  const actor = await getSessionUserByToken(raw)
  if (!actor) return null

  const target = store.get(IMPERSONATE_COOKIE)?.value
  if (!target) return actor

  // The cookie is inert unless the *real* session belongs to an admin, and that
  // role came from the database a moment ago — not from anything the client sent.
  if (actor.role !== "ADMIN") return actor

  const impersonated = await getUserByTelegramId(target)
  if (!impersonated) return actor

  console.warn(`[auth] ${actor.telegramId} acting as ${impersonated.telegramId}`)
  return {
    ...impersonated,
    sessionId: actor.sessionId,
    impersonating: true,
    actorTelegramId: actor.telegramId,
  }
})

/** Identity lookup by telegram id, used by the impersonation path. */
export async function getUserByTelegramId(
  telegramId: string
): Promise<Omit<SessionUser, "sessionId"> | null> {
  if (!/^\d{1,19}$/.test(telegramId)) return null
  const sql = getSql()
  const rows = await sql`
    SELECT id, telegram_id, telegram_name, role
      FROM public.users
     WHERE telegram_id = ${BigInt(telegramId)}
     LIMIT 1
  ` as { id: string; telegram_id: string; telegram_name: string; role: "ADMIN" | "USER" }[]
  if (rows.length === 0) return null
  return {
    userId: String(rows[0].id),
    telegramId: String(rows[0].telegram_id),
    telegramName: rows[0].telegram_name,
    role: rows[0].role,
  }
}

/** The same lookup, given a raw token directly (used where cookies() is unavailable). */
export async function getSessionUserByToken(raw: string): Promise<SessionUser | null> {
  const sql = getSql()
  const rows = await sql`
    WITH s AS (
      SELECT se.id, se.user_id, se.last_seen_at,
             u.telegram_id, u.telegram_name, u.role
        FROM public.user_sessions se
        JOIN public.users u ON u.id = se.user_id
       WHERE se.session_token_hash = ${hashToken(raw)}
         AND se.revoked_at IS NULL
         AND se.expires_at > NOW()
    ),
    upd AS (
      UPDATE public.user_sessions
         SET last_seen_at = NOW(),
             expires_at   = NOW() + (${SESSION_TTL_DAYS} * INTERVAL '1 day')
       WHERE id = (SELECT id FROM s)
         AND (SELECT last_seen_at FROM s)
             < NOW() - (${SESSION_TOUCH_THROTTLE_MINUTES} * INTERVAL '1 minute')
    )
    SELECT id, user_id, telegram_id, telegram_name, role FROM s
  ` as {
    id: string
    user_id: string
    telegram_id: string
    telegram_name: string
    role: "ADMIN" | "USER"
  }[]

  if (rows.length === 0) return null
  const r = rows[0]
  return {
    sessionId: String(r.id),
    userId: String(r.user_id),
    telegramId: String(r.telegram_id),
    telegramName: r.telegram_name,
    role: r.role,
  }
}

/**
 * The uniform guard contract. Call sites are always:
 *
 *   const user = await requireUser()
 *   if (user instanceof Response) return user
 *
 * Returning the Response rather than throwing keeps the happy path free of
 * try/catch and makes "did this route guard itself" greppable.
 */
export async function requireUser(): Promise<SessionUser | Response> {
  const user = await getSessionUser()
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  trackUserRequest(user)
  return user
}

/**
 * Best-effort telemetry on the authenticated hot path. Wrapped so a bug in the
 * detector — or in the header read — can never bubble into a handler and turn a
 * working request into a 500.
 *
 * Statically imported: this runs on every authenticated request, and a dynamic
 * import here would add a module resolution to each one. security-alert keeps
 * its own lazy import of the database driver, so nothing heavy is pulled in
 * until an alert actually fires.
 */
function trackUserRequest(user: SessionUser): void {
  try {
    // No route label: obtaining one required the proxy to rewrite request
    // headers, which destabilised the app (see proxy.ts). The user id and the
    // rate are the actionable part anyway.
    const alert = maybeAlertUserAbuse(user.telegramId)
    if (alert) void alert.catch(() => {})
  } catch {
    // Telemetry must never affect the request.
  }
}

export async function requireAdmin(): Promise<SessionUser | Response> {
  const user = await getSessionUser()
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  // While impersonating, the effective role is the target's. Admin rights must
  // follow the real actor, or an admin acting as a USER could not stop.
  if (user.impersonating) {
    return Response.json({ error: "Forbidden while impersonating" }, { status: 403 })
  }
  if (user.role !== "ADMIN") {
    // Role is read from the database on every request, never from the cookie,
    // so a demotion takes effect immediately and cannot be forged client-side.
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }
  return user
}

/**
 * Client IP: x-real-ip first, then only the FIRST hop of x-forwarded-for.
 * Later hops are attacker-controlled.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")
  if (real) return real.trim()
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim() || null
  return null
}

/**
 * Scheduled hygiene for the auth tables. Expired login tokens go immediately;
 * sessions keep a 7-day grace after expiry or revocation so a recently signed-out
 * device is still explicable when someone asks what happened.
 */
export async function purgeExpiredAuthRows(): Promise<{
  loginTokens: number
  sessions: number
}> {
  const sql = getSql()
  const tokens = await sql`
    DELETE FROM public.login_tokens WHERE expires_at < NOW() RETURNING token_hash
  ` as unknown[]
  const sessions = await sql`
    DELETE FROM public.user_sessions
     WHERE expires_at < NOW() - INTERVAL '7 days'
        OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')
    RETURNING id
  ` as unknown[]
  return { loginTokens: tokens.length, sessions: sessions.length }
}
