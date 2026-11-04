/**
 * Browser-side cooldown + force-refresh bookkeeping, in localStorage.
 *
 * Binance and Bybit are fetched directly in the user's browser (the Vercel
 * egress is geo-blocked by them), so an IP ban lands on the *user's own* IP
 * and only that browser can back off. Same deliberate localStorage trade-off
 * as the API keys (see doc/KNOWN-ISSUES.md): best-effort, per-browser, and
 * every access is wrapped — a private-mode quota error must never break the
 * sync path, worst case we hit the exchange and get told again.
 */
import { Cooldown } from "./rateLimitParse"

const COOLDOWNS_KEY = "mfca-exchange-cooldowns"
const FORCE_AT_KEY = "mfca-exchange-force-at"

function readMap(key: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeMap(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / storage full — cooldown becomes best-effort, never fatal.
  }
}

/** Active cooldown for the exchange, or null when none is still in force. */
export function getClientCooldown(exchange: string, nowMs: number = Date.now()): Cooldown | null {
  const raw = readMap(COOLDOWNS_KEY)[exchange] as Cooldown | undefined
  if (raw == null || typeof raw.untilMs !== "number") return null
  if (raw.untilMs <= nowMs) return null
  return { untilMs: raw.untilMs, reason: raw.reason ?? "rate-limited" }
}

export function setClientCooldown(exchange: string, cooldown: Cooldown): void {
  const map = readMap(COOLDOWNS_KEY)
  const existing = map[exchange] as Cooldown | undefined
  // Keep the longer of the two: a 429 cooldown must not shorten a live ban.
  if (existing != null && existing.untilMs > cooldown.untilMs) return
  map[exchange] = cooldown
  writeMap(COOLDOWNS_KEY, map)
}

/** Epoch ms of the last forced (cache-bypassing) fetch, or null. */
export function getLastForceAt(exchange: string): number | null {
  const v = readMap(FORCE_AT_KEY)[exchange]
  return typeof v === "number" ? v : null
}

/** Called when a forced fetch actually goes to the exchange — including a
 *  failing one, so a retry loop cannot turn into a request storm. */
export function markForceAttempt(exchange: string, nowMs: number = Date.now()): void {
  const map = readMap(FORCE_AT_KEY)
  map[exchange] = nowMs
  writeMap(FORCE_AT_KEY, map)
}
