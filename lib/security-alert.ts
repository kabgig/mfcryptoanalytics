/**
 * Flood detection and admin alerting.
 *
 * Called from proxy.ts whenever a request is blocked (401 cookie-gate or 429
 * rate-limit), and from requireUser()'s success path for authenticated abuse.
 *
 * State is IN MEMORY per serverless instance — no Redis — so the hot path stays
 * cheap. Per-instance counting is a deliberate trade-off: counts are best-effort
 * and real thresholds are effectively higher than the constants suggest, since
 * each instance counts alone. For alerting, which is advisory, that is fine.
 *
 * Nothing here may ever throw into the request path.
 */

interface CountWindow {
  count: number
  start: number
}

// ─── per-IP flood ────────────────────────────────────────────────────────────
const IP_WINDOW_MS = 60_000
const IP_THRESHOLD = 30          // blocked requests/min from one IP
const IP_DEBOUNCE_MS = 10 * 60_000
const MAX_TRACKED_IPS = 10_000   // safety valve against unbounded growth

// ─── distributed attack ──────────────────────────────────────────────────────
const DIST_WINDOW_MS = 60_000
const DIST_THRESHOLD = 200       // total blocks/min across all IPs
const DIST_DEBOUNCE_MS = 10 * 60_000
const DIST_MAX_IPS = 5_000

// ─── authenticated-user abuse ────────────────────────────────────────────────
const USER_WINDOW_MS = 60_000
const USER_THRESHOLD = 300       // authenticated req/min from one user
const USER_DEBOUNCE_MS = 10 * 60_000
const USER_MAX_TRACKED = 10_000

const ADMIN_CACHE_TTL_MS = 5 * 60_000

export type BlockReason = "401" | "429"

const ipWindows = new Map<string, CountWindow>()
const ipLastAlert = new Map<string, number>()
let distWindow = { count: 0, start: 0, ips: new Set<string>() }
let distLastAlert = 0
const userWindows = new Map<string, CountWindow>()
const userLastAlert = new Map<string, number>()

/**
 * Alerts are only delivered from production. Local dev and the test suites
 * would otherwise Telegram the admins during a 401-burst test — the suites
 * deliberately fire dozens of blocked requests from one IP.
 */
function shouldDeliver(): boolean {
  if (process.env.SECURITY_ALERTS_LOCAL === "1") return true
  return process.env.NODE_ENV === "production"
}

/** Rolling-window counter. Returns the running count for `key`. */
function record(
  map: Map<string, CountWindow>,
  key: string,
  windowMs: number,
  maxTracked: number
): number {
  const now = Date.now()
  // Under a spray attack, clear rather than grow without bound.
  if (map.size > maxTracked) map.clear()
  const w = map.get(key)
  if (!w || now - w.start > windowMs) {
    map.set(key, { count: 1, start: now })
    return 1
  }
  w.count++
  return w.count
}

/** True at most once per key per debounce window. */
function claimSlot(
  map: Map<string, number>,
  key: string,
  debounceMs: number,
  maxTracked: number
): boolean {
  const now = Date.now()
  if (now - (map.get(key) ?? 0) < debounceMs) return false
  if (map.size > maxTracked) map.clear()
  map.set(key, now)
  return true
}

// ─── admin recipients ────────────────────────────────────────────────────────

let adminCache: { ids: string[]; at: number } | null = null

/**
 * Recipients are every role='ADMIN' user, read from the database and cached.
 * No hardcoded ids. The db import is a lazy dynamic import so the driver stays
 * off the proxy's hot path until an alert actually fires.
 */
async function getAdminChatIds(): Promise<string[]> {
  const now = Date.now()
  if (adminCache && now - adminCache.at < ADMIN_CACHE_TTL_MS) return adminCache.ids
  try {
    const { getSql } = await import("@/lib/db")
    const rows = await getSql()`
      SELECT telegram_id FROM public.users WHERE role = 'ADMIN'
    ` as { telegram_id: string }[]
    const ids = rows.map((r) => String(r.telegram_id))
    adminCache = { ids, at: now }
    return ids
  } catch {
    // On DB error reuse the last known list; never throw.
    return adminCache?.ids ?? []
  }
}

/**
 * Sent with raw fetch rather than lib/telegram/bot's sendMessage, so alerting
 * stays independent of the bot helpers and cannot be affected by changes there.
 * One failing recipient must never abort the rest.
 */
async function fanOutToAdmins(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const chatIds = await getAdminChatIds()
  if (chatIds.length === 0) return

  await Promise.all(
    chatIds.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true },
        }),
      }).catch(() => {
        // Best-effort per recipient.
      })
    )
  )
}

const envLabel = () => process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local"

// ─── detectors ───────────────────────────────────────────────────────────────

/**
 * Call on every blocked request. Returns a promise ONLY when this IP crosses the
 * sustained-flood threshold and is not already debounced; otherwise undefined,
 * so the caller does no work. Hand the promise to event.waitUntil().
 */
export function maybeAlertFlood(
  ip: string,
  route: string,
  reason: BlockReason
): Promise<void> | undefined {
  try {
    const count = record(ipWindows, ip, IP_WINDOW_MS, MAX_TRACKED_IPS)
    if (count < IP_THRESHOLD) return undefined
    if (!claimSlot(ipLastAlert, ip, IP_DEBOUNCE_MS, MAX_TRACKED_IPS)) return undefined

    const kind = reason === "429" ? "rate-limited" : "unauthenticated"
    const text =
      `🚨 *FLOOD DETECTED*\n\n` +
      `*IP:* \`${ip}\`\n` +
      `*Route:* \`${route}\`\n` +
      `*Blocked:* ${count}+ ${kind} req/min\n` +
      `*Env:* \`${envLabel()}\``
    console.warn(`[security-alert] flood from ${ip} on ${route} (${count} ${kind}/min)`)
    if (!shouldDeliver()) return undefined
    return fanOutToAdmins(text)
  } catch {
    return undefined
  }
}

/**
 * Counts blocked requests across ALL IPs, catching "many IPs, each slow" attacks
 * that stay under the per-IP threshold.
 */
export function maybeAlertDistributed(
  ip: string,
  reason: BlockReason
): Promise<void> | undefined {
  try {
    const now = Date.now()
    if (now - distWindow.start > DIST_WINDOW_MS) {
      distWindow = { count: 1, start: now, ips: new Set([ip]) }
    } else {
      distWindow.count++
      if (distWindow.ips.size < DIST_MAX_IPS) distWindow.ips.add(ip)
    }

    if (distWindow.count < DIST_THRESHOLD) return undefined
    if (now - distLastAlert < DIST_DEBOUNCE_MS) return undefined
    distLastAlert = now

    const kind = reason === "429" ? "rate-limited" : "unauthenticated"
    const text =
      `🌍 *DISTRIBUTED ATTACK*\n\n` +
      `*Total blocks:* ${distWindow.count}+ ${kind} req/min\n` +
      `*Unique IPs:* ${distWindow.ips.size}\n` +
      `*Env:* \`${envLabel()}\``
    console.warn(`[security-alert] distributed: ${distWindow.count} blocks from ${distWindow.ips.size} IPs`)
    if (!shouldDeliver()) return undefined
    return fanOutToAdmins(text)
  } catch {
    return undefined
  }
}

/**
 * Called from requireUser()'s success path, so it only counts requests that
 * passed real session validation. Alert-only: it never blocks a paying user.
 */
export function maybeAlertUserAbuse(
  telegramId: string,
  route = "authenticated"
): Promise<void> | undefined {
  try {
    const count = record(userWindows, telegramId, USER_WINDOW_MS, USER_MAX_TRACKED)
    if (count < USER_THRESHOLD) return undefined
    if (!claimSlot(userLastAlert, telegramId, USER_DEBOUNCE_MS, USER_MAX_TRACKED)) return undefined

    const text =
      `⚠️ *USER ABUSE*\n\n` +
      `*Telegram id:* \`${telegramId}\`\n` +
      `*Route:* \`${route}\`\n` +
      `*Requests:* ${count}+/min\n` +
      `*Env:* \`${envLabel()}\`\n\n` +
      `_Alert only — the user was not blocked._`
    console.warn(`[security-alert] user ${telegramId} at ${count} req/min on ${route}`)
    if (!shouldDeliver()) return undefined
    return fanOutToAdmins(text)
  } catch {
    return undefined
  }
}

/** Test hook. Not used in request paths. */
export function __resetSecurityAlerts(): void {
  ipWindows.clear()
  ipLastAlert.clear()
  userWindows.clear()
  userLastAlert.clear()
  distWindow = { count: 0, start: 0, ips: new Set() }
  distLastAlert = 0
  adminCache = null
}

/** Test hook: thresholds, so tests never hardcode the numbers. */
export const __thresholds = {
  IP_THRESHOLD,
  DIST_THRESHOLD,
  USER_THRESHOLD,
  MAX_TRACKED_IPS,
  USER_MAX_TRACKED,
}
