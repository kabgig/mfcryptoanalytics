/**
 * End-to-end check of the rate-limit cooldown and force-refresh throttle on
 * /api/trades-* (the server-side sync path) and /api/trades-cache (the
 * browser-side fallback), against a running dev server and the real database.
 *
 * The scenarios deliberately never depend on a real exchange rate limit: the
 * cooldown row is inserted directly, and the "live fetch" always fails fast on
 * fake keys. That keeps the test deterministic — what it asserts is that a
 * recorded cooldown STOPS the live fetch, which is the whole point of the
 * feature (a retry during a Binance 418 ban extends the ban).
 *
 * SAFETY: one synthetic user, created and removed by this script; teardown runs
 * in a finally block and also at the start, for a crashed previous run. The
 * exchange keys are fake — they cannot touch any real account.
 *
 *   npm run dev        # in another terminal
 *   npm run test:cooldown
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"
import { signIn } from "./helpers/session.mjs"
import type { Trade } from "@/types"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000001102"
const FAKE_KEYS = { apiKey: "uitest-fake-key", apiSecret: "uitest-fake-secret" }

const sql = getSql()
const tid = BigInt(TEST_TELEGRAM_ID)

// Inside the default 3m period, so the row is not filtered out.
const closed = new Date(Date.now() - 5 * 86_400_000)
const TRADE = (exchange: string): Trade => ({
  id: `cooldown-uitest-${exchange}`, exchange, ticker: "UITESTUSDT", positionSize: 1,
  tp: null, sl: null, pnl: 7, market: "futures",
  openTime: new Date(closed.getTime() - 3_600_000).toISOString(),
  closeTime: closed.toISOString(),
})

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${String((err as Error).message ?? err).split("\n")[0]}`)
  }
}

async function teardown() {
  await sql`DELETE FROM public.exchange_cooldowns WHERE exchange LIKE 'UITEST%' OR exchange IN ('Binance', 'OKX')`
  await sql`DELETE FROM public.cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users              WHERE telegram_id = ${tid}`
}

async function seedTrade(exchange: string, cookie: string) {
  const res = await fetch(`${BASE}/api/trades-store`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ exchange, trades: [TRADE(exchange)] }),
  })
  assert.equal(res.status, 200, "seeding trade failed")
}

async function main() {
  await teardown()
  const cookie = await signIn(BASE, TEST_TELEGRAM_ID, "cooldown-test")

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }

  // --- 1. trades-cache allowStale --------------------------------------------
  // Binance has no fetch log (never synced live), but stored trades exist.
  await seedTrade("Binance", cookie)
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid} AND exchange = 'Binance'`

  await check("trades-cache with allowStale returns stored trades on a stale cache", async () => {
    const { status, json } = await post("/api/trades-cache", { exchange: "Binance", allowStale: true })
    assert.equal(status, 200)
    assert.equal(json.fresh, false)
    assert.equal(json.stale, true)
    assert.equal(json.trades.length, 1, `expected stored trade, got ${json.trades?.length}`)
    assert.equal(json.trades[0].id, TRADE("Binance").id)
  })

  await check("trades-cache without allowStale keeps the old empty answer", async () => {
    const { json } = await post("/api/trades-cache", { exchange: "Binance" })
    assert.equal(json.fresh, false)
    assert.equal(json.trades.length, 0)
  })

  // --- 2. server-side force-refresh throttle ----------------------------------
  // OKX cache was written moments ago (seed above) — a forced refresh must be
  // served from cache rather than re-hitting the exchange.
  await seedTrade("OKX", cookie)

  await check("forced refresh moments after a fetch is throttled to cache", async () => {
    const { status, json } = await post("/api/trades-global", {
      exchange: "OKX", ...FAKE_KEYS, passphrase: "x", force: true,
    })
    assert.equal(status, 200)
    assert.equal(json.throttled, true, "force was not throttled")
    assert.equal(json.fromCache, true)
    assert.equal(json.trades.length, 1, "throttled answer lost the cached trade")
  })

  // A cache 25 hours old is beyond both the 24h freshness and the 60s throttle:
  // force must go live (and fail on fake keys, falling back to stored trades).
  await sql`
    UPDATE public.exchange_fetch_log
    SET fetched_at = NOW() - INTERVAL '25 hours'
    WHERE telegram_id = ${tid} AND exchange = 'OKX'
  `
  await check("forced refresh past the freshness window still goes live", async () => {
    const { status, json } = await post("/api/trades-global", {
      exchange: "OKX", ...FAKE_KEYS, passphrase: "x", force: true,
    })
    assert.equal(status, 200)
    assert.equal(json.throttled, undefined, "a stale cache must not be 'throttled'")
    assert.equal(json.stale, true, "failed live fetch should fall back to stored")
    assert.equal(json.trades.length, 1)
  })

  // --- 3. cooldown gate stops the live fetch ----------------------------------
  await sql`
    INSERT INTO public.exchange_cooldowns (exchange, blocked_until, reason)
    VALUES ('Binance', NOW() + INTERVAL '10 minutes', 'uitest ban')
    ON CONFLICT (exchange) DO UPDATE SET blocked_until = NOW() + INTERVAL '10 minutes'
  `

  await check("an active cooldown serves stored trades without a live fetch", async () => {
    const t0 = Date.now()
    const { status, json } = await post("/api/trades-global", {
      exchange: "Binance", ...FAKE_KEYS, force: true,
    })
    assert.equal(status, 200)
    assert.equal(json.stale, true, "cooldown answer must be flagged stale")
    // cooldownUntil is only ever set by the cooldown gate (a failed live fetch
    // on a 401 leaves it undefined), so this is the discriminator.
    assert.ok(json.cooldownUntil, "cooldownUntil missing from the answer")
    assert.equal(json.trades.length, 1, "stored trade not served during cooldown")
    // Secondary signal: the live path is 13+ signed upstream calls plus the
    // same fallback queries, while the gate is ~3 Neon round-trips (~300ms
    // each from a dev machine). 2.5s sits well above the gate and well below
    // a real exchange round trip.
    assert.ok(Date.now() - t0 < 2500, "answer was not immediate — live fetch probably ran")
  })

  await check("a cooldown row blocked_until in the past is ignored", async () => {
    // OKX, not Binance: this check deliberately lets a live fetch through, and
    // OKX's answer to fake keys is a plain auth error. Binance occasionally
    // answers this machine's exit IP with a real 429 — which the handler would
    // rightly record, setting cooldownUntil and failing this check for
    // environmental rather than code reasons.
    await sql`
      INSERT INTO public.exchange_cooldowns (exchange, blocked_until, reason)
      VALUES ('OKX', NOW() - INTERVAL '1 minute', 'expired uitest ban')
      ON CONFLICT (exchange) DO UPDATE SET blocked_until = NOW() - INTERVAL '1 minute'
    `
    const { json } = await post("/api/trades-global", {
      exchange: "OKX", ...FAKE_KEYS, passphrase: "x", force: true,
    })
    assert.equal(json.cooldownUntil, undefined, "expired cooldown still gating")
    // Fake keys → the live fetch fails → stale fallback, which is the
    // pre-existing behaviour, not a gate.
    assert.equal(json.stale, true)
    assert.equal(json.trades.length, 1)
  })

  await teardown()
  console.log(`\n${passed} passed, ${failed.length} failed`)
  if (failed.length > 0) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await teardown().catch(() => {})
  process.exit(1)
})
