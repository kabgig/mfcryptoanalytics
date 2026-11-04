/**
 * Rate-limit parsing shared by the browser-side fetch path (Binance/Bybit are
 * fetched directly in the user's browser — see CLIENT_FETCH_EXCHANGES in
 * HomeView) and the server-side handler (OKX & co. via /api/trades-*).
 *
 * Pure functions only: no DOM, no DB — everything here is unit-tested in
 * scripts/test/rateLimitParse.test.ts.
 */

export interface Cooldown {
  /** Epoch ms — do not call the exchange again before this time. */
  untilMs: number
  reason: string
}

/** A forced refresh within this window is served from cache instead. */
export const FORCE_REFRESH_MIN_INTERVAL_MS = 60_000

/** Binance 429s carry no end time; wait it out briefly rather than pile on. */
export const RATE_LIMIT_429_COOLDOWN_MS = 120_000

/** 418 without a parsable "banned until" timestamp; Binance always sends one,
 *  so this is a defensive floor for other exchanges' bans. */
export const RATE_LIMIT_FALLBACK_COOLDOWN_MS = 5 * 60_000

/** Slack on top of the server-stated ban end, for clock skew and page latency. */
export const COOLDOWN_SAFETY_MARGIN_MS = 30_000

/**
 * "banned until 1793764798003." → epoch ms. Binance sends milliseconds; a
 * 10-digit value (seconds) is normalised defensively.
 */
export function parseBannedUntilMs(body: string): number | null {
  const m = body.match(/banned until (\d{9,14})/i)
  if (!m) return null
  const n = Number(m[1])
  return n > 1e12 ? n : n * 1000
}

/**
 * HTTP 418/429 (or Binance code -1003) → the cooldown to record, or null when
 * the response is not a rate limit.
 */
export function rateLimitFromResponse(
  status: number,
  body: string,
  nowMs: number = Date.now()
): Cooldown | null {
  const isRateLimit = status === 418 || status === 429 || /"code"\s*:\s*-1003/.test(body)
  if (!isRateLimit) return null

  const banned = parseBannedUntilMs(body)
  // A "banned until" already in the past (clock skew, long-lifted ban) must not
  // produce an already-expired — or worse, negative — cooldown; fall through to
  // the fixed window instead.
  if (banned != null && banned > nowMs) {
    return { untilMs: banned + COOLDOWN_SAFETY_MARGIN_MS, reason: "IP banned by exchange" }
  }
  if (status === 429) {
    return { untilMs: nowMs + RATE_LIMIT_429_COOLDOWN_MS, reason: "rate-limited (429)" }
  }
  return { untilMs: nowMs + RATE_LIMIT_FALLBACK_COOLDOWN_MS, reason: "IP banned by exchange" }
}

/**
 * Extracts a cooldown from a thrown adapter error message. Adapters throw
 * `... error ${status}: ${body}` (Binance/Bybit futures, balances), so the
 * status and Binance's "banned until" both live in the text.
 */
export function rateLimitFromErrorMessage(
  message: string,
  nowMs: number = Date.now()
): Cooldown | null {
  // Anchored on the word before the status so trade ids, amounts or PnL values
  // of 418/429 in an error body cannot trigger a false cooldown.
  const m = message.match(/(?:error|balance|status)\s+(418|429)\b/i)
  if (!m) return null
  return rateLimitFromResponse(Number(m[1]), message, nowMs)
}

/** Force-refresh throttle: true when the last forced fetch is old enough. */
export function shouldForceRefresh(lastForceMs: number | null, nowMs: number = Date.now()): boolean {
  if (lastForceMs == null) return true
  return nowMs - lastForceMs >= FORCE_REFRESH_MIN_INTERVAL_MS
}
