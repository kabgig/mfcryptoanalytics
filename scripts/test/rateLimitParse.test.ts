/**
 * The rate-limit parser, tested directly.
 *
 * It sits between a raw exchange error and every cooldown decision — browser
 * (localStorage) and server (Neon) — so a false negative means retrying into an
 * active Binance IP ban (which extends it), and a false positive means a
 * healthy exchange is skipped for minutes. The sample strings below are the
 * real production messages this was built for.
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  COOLDOWN_SAFETY_MARGIN_MS,
  RATE_LIMIT_429_COOLDOWN_MS,
  parseBannedUntilMs,
  rateLimitFromErrorMessage,
  rateLimitFromResponse,
  shouldForceRefresh,
} from "@/lib/exchanges/rateLimitParse"

// Fixed clock: 2026-11-04T00:00:00Z — before the sample ban's end (03:59:58Z),
// so the "still active" assertions below are coherent with it.
const NOW = Date.UTC(2026, 10, 4)

// The exact production error that started this feature (IP scrubbed to role):
// "Binance Futures income error 418: {"code":-1003,"msg":"Way too many
// requests; IP banned until 1793764798003."}"
const BANNED_BODY =
  '{"code":-1003,"msg":"Way too many requests; IP(203.0.113.9) banned until 1793764798003. Please use the websocket for live updates to avoid bans."}'

describe("parseBannedUntilMs", () => {
  test("extracts the epoch-ms ban end from a production message", () => {
    assert.equal(parseBannedUntilMs(BANNED_BODY), 1793764798003)
  })

  test("normalises a seconds-form timestamp", () => {
    assert.equal(parseBannedUntilMs("banned until 1793764798."), 1793764798000)
  })

  test("returns null when nothing is banned", () => {
    assert.equal(parseBannedUntilMs('{"code":-2014,"msg":"API key format invalid"}'), null)
    assert.equal(parseBannedUntilMs(""), null)
  })
})

describe("rateLimitFromResponse", () => {
  test("418 with a ban end → cooldown until ban end + safety margin", () => {
    const cd = rateLimitFromResponse(418, BANNED_BODY, NOW)
    assert.ok(cd, "no cooldown for a 418 ban")
    assert.equal(cd.untilMs, 1793764798003 + COOLDOWN_SAFETY_MARGIN_MS)
  })

  test("429 without a ban end → short fixed cooldown", () => {
    const cd = rateLimitFromResponse(429, '{"msg":"too many requests"}', NOW)
    assert.ok(cd, "no cooldown for a 429")
    assert.equal(cd.untilMs, NOW + RATE_LIMIT_429_COOLDOWN_MS)
  })

  test("-1003 without HTTP status is still a rate limit", () => {
    const cd = rateLimitFromResponse(200, BANNED_BODY, NOW)
    assert.ok(cd, "code -1003 in the body was ignored")
  })

  test("a ban end already in the past falls back to the fixed window", () => {
    const late = NOW + 86_400_000 // ban "ends" a day before NOW's clock is fine
    const body = `banned until ${late - 2 * 86_400_000}.`
    const cd = rateLimitFromResponse(418, body, late)
    assert.ok(cd)
    assert.ok(cd.untilMs > late, "cooldown ended in the past")
  })

  test("auth and other errors are not rate limits", () => {
    assert.equal(rateLimitFromResponse(401, '{"code":-2015,"msg":"Invalid key"}', NOW), null)
    assert.equal(rateLimitFromResponse(400, "bad request", NOW), null)
    assert.equal(rateLimitFromResponse(500, "internal", NOW), null)
  })
})

describe("rateLimitFromErrorMessage", () => {
  test("reads the production adapter message end to end", () => {
    const cd = rateLimitFromErrorMessage(`Binance Futures income error 418: ${BANNED_BODY}`, NOW)
    assert.ok(cd, "production error string not recognised")
    assert.equal(cd.untilMs, 1793764798003 + COOLDOWN_SAFETY_MARGIN_MS)
  })

  test("balance-style messages parse too", () => {
    const cd = rateLimitFromErrorMessage("Binance balance 429: too many requests", NOW)
    assert.ok(cd)
    assert.equal(cd.untilMs, NOW + RATE_LIMIT_429_COOLDOWN_MS)
  })

  test("a 418/429 appearing as data, not a status, does not trip it", () => {
    // "trade 418" is a message about a trade, not HTTP 418.
    assert.equal(rateLimitFromErrorMessage("trade 418 not found"), null)
    assert.equal(rateLimitFromErrorMessage('{"pnl": -429.5}'), null)
  })

  test("non-rate-limit adapter errors pass through as null", () => {
    assert.equal(rateLimitFromErrorMessage("Binance Futures income error 401: bad key"), null)
  })
})

describe("shouldForceRefresh", () => {
  test("no recorded force → force", () => {
    assert.equal(shouldForceRefresh(null, NOW), true)
  })

  test("within the interval → throttled", () => {
    assert.equal(shouldForceRefresh(NOW - 59_000, NOW), false)
  })

  test("at/after the interval → force again", () => {
    assert.equal(shouldForceRefresh(NOW - 60_000, NOW), true)
    assert.equal(shouldForceRefresh(NOW - 600_000, NOW), true)
  })
})
