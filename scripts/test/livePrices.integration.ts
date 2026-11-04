/**
 * End-to-end check of the global live-price cache on /api/spot/prices against a
 * running dev server and the real database.
 *
 * Live prices are identical for every user, so the route must serve them from
 * public.live_prices and re-ask Coinbase/Kraken only past the TTL. The proof
 * here is the DB row: a second request within the TTL must not move
 * fetched_at, and a fresh row must exist at all after the first request (the
 * old code never wrote one).
 *
 * SAFETY: one synthetic user with a BTC entry, created and removed by this
 * script; teardown runs in a finally block and also at the start. The BTC live
 * price row is cache data shared with real users — the teardown deletes it,
 * and any concurrent reader simply refetches from Coinbase.
 *
 *   npm run dev        # in another terminal
 *   npm run test:live-prices
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"
import { signIn } from "./helpers/session.mjs"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000001103"
const TICKER = "BTC"

const sql = getSql()
const tid = BigInt(TEST_TELEGRAM_ID)

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
  await sql`DELETE FROM public.spot_entries WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.spot_price_history WHERE ticker = 'BTCUITESTX'` // none expected, belt and braces
  await sql`DELETE FROM public.live_prices     WHERE ticker = ${TICKER}`
  await sql`DELETE FROM public.users          WHERE telegram_id = ${tid}`
}

async function main() {
  await teardown()
  const cookie = await signIn(BASE, TEST_TELEGRAM_ID, "live-prices-test")

  // A BTC entry five days back; the daily-close backfill is small and real.
  await sql`
    INSERT INTO public.spot_entries (telegram_id, ticker, side, qty, price, traded_at)
    VALUES (${tid}, ${TICKER}, 'BUY', 1, 1, NOW() - INTERVAL '5 days')
  `

  const get = async () => {
    const res = await fetch(`${BASE}/api/spot/prices`, { headers: { cookie } })
    assert.equal(res.status, 200, `route answered ${res.status}`)
    return (await res.json()) as { history: unknown; current: Record<string, number>; unpriced: string[] }
  }

  let firstFetchedAt: Date | null = null

  await check("first request prices BTC and writes the cache row", async () => {
    const data = await get()
    assert.ok(data.current[TICKER] > 0, "BTC not priced")
    const rows = (await sql`
      SELECT fetched_at FROM public.live_prices WHERE ticker = ${TICKER}
    `) as { fetched_at: Date }[]
    assert.equal(rows.length, 1, "no live_prices row written")
    firstFetchedAt = rows[0].fetched_at
  })

  await check("second request within the TTL is served from the cache", async () => {
    const data = await get()
    assert.ok(data.current[TICKER] > 0, "BTC not priced from cache")
    const rows = (await sql`
      SELECT fetched_at FROM public.live_prices WHERE ticker = ${TICKER}
    `) as { fetched_at: Date }[]
    assert.equal(
      rows[0].fetched_at.getTime(),
      firstFetchedAt?.getTime(),
      "fetched_at moved within the TTL — cache not used"
    )
  })

  await check("a forced-stale row is refreshed on the next request", async () => {
    await sql`
      UPDATE public.live_prices SET fetched_at = NOW() - INTERVAL '10 minutes' WHERE ticker = ${TICKER}
    `
    const data = await get()
    assert.ok(data.current[TICKER] > 0)
    const rows = (await sql`
      SELECT fetched_at FROM public.live_prices WHERE ticker = ${TICKER}
    `) as { fetched_at: Date }[]
    assert.ok(
      rows[0].fetched_at.getTime() > (firstFetchedAt?.getTime() ?? 0),
      "stale row was not refreshed"
    )
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
