/**
 * Headless UI check: a rate-limit cooldown must keep the browser off Binance.
 *
 * Binance trades are fetched directly in the user's browser (geo-block
 * workaround), so an IP ban lands on the user's own IP — and every retry during
 * the ban extends it. This test seeds the exact situation the feature was built
 * for: a stored Binance trade, a cooldown recorded in localStorage (as the
 * 418 handler now does), and fake API keys. Asserts on the DOM, the network and
 * the route's JSON: no request may leave for binance.com, the stored trade must
 * still render, and the yellow stale banner — not a red error — must explain it.
 *
 * SAFETY: one synthetic user, created and removed by this script; teardown runs
 * in a finally block and also at the start, for a crashed previous run. The
 * Binance key is fake — it cannot touch any real account.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:binance-cooldown
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"
import { signIn, signInBrowser } from "./helpers/session.mjs"
import { gotoApp } from "./helpers/nav.mjs"

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000001104"
const TICKER = "UITESTUSDT"

const sql = neon(process.env.DATABASE_URL)
const tid = BigInt(TEST_TELEGRAM_ID)

// Inside the default 3m period, so the row is not filtered out.
const closed = new Date(Date.now() - 5 * 86_400_000)
const TRADE = {
  id: "binance-futures-uitest-1", exchange: "Binance", ticker: TICKER, positionSize: 1,
  tp: null, sl: null, pnl: 11, market: "futures",
  openTime: new Date(closed.getTime() - 3_600_000).toISOString(),
  closeTime: closed.toISOString(),
}

let passed = 0
const failed = []
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${String(err.message ?? err).split("\n")[0]}`)
  }
}

async function teardown() {
  await sql`DELETE FROM public.cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users              WHERE telegram_id = ${tid}`
}

const warning = (page) => page.locator('[data-testid="stale-sync-warning"]')
const row = (page) => page.locator("main td span", { hasText: TICKER })

/** Loads the dashboard, recording every request URL that leaves the browser. */
async function loadDashboard(page) {
  const urls = []
  const onReq = (r) => urls.push(r.url())
  page.on("request", onReq)
  const cacheResp = page.waitForResponse(
    (r) => r.url().includes("/api/trades-cache") && r.request().method() === "POST",
    { timeout: 90_000 }
  )
  await gotoApp(page, `${BASE}/`)
  const json = await (await cacheResp).json()
  await row(page).first().waitFor({ timeout: 30_000 })
  page.off("request", onReq)
  return { json, urls }
}

async function main() {
  await teardown()
  const cookie = await signIn(BASE, TEST_TELEGRAM_ID, "binance-cooldown-test")
  const stored = await fetch(`${BASE}/api/trades-store`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ exchange: "Binance", trades: [TRADE] }),
  })
  assert.equal(stored.status, 200, "seed trade")
  // No fetch log → the cache is not fresh, so only the cooldown can save us
  // from a live (fake-key) fetch.
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    await context.addInitScript(() => {
      localStorage.setItem("mfca-user-store", JSON.stringify({
        state: {
          userId: null, walletAddress: null,
          telegramId: "990000001104", telegramName: "binance-cooldown-test", role: "USER",
          apiKeys: { binanceApiKey: "uitest-fake-key", binanceApiSecret: "uitest-fake-secret" },
          originalAdmin: null,
        },
        version: 0,
      }))
      // The 418 handler's own bookkeeping, replayed as it would be after a ban.
      localStorage.setItem("mfca-exchange-cooldowns", JSON.stringify({
        Binance: { untilMs: Date.now() + 10 * 60_000, reason: "IP banned by exchange" },
      }))
    })
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))
    await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "binance-cooldown-test")

    // --- 1. load with an active cooldown --------------------------------------
    const first = await loadDashboard(page)

    await check("cooldown asked the server for stored trades (stale: true)", async () => {
      assert.equal(first.json.stale, true)
      assert.ok(Array.isArray(first.json.trades) && first.json.trades.length === 1)
    })
    await check("no request left for binance.com", async () => {
      const hits = first.urls.filter((u) => u.includes("binance.com"))
      assert.deepEqual(hits, [], `cooldown did not stop: ${hits.slice(0, 3).join(", ")}`)
    })
    await check("stored trade still renders", async () => {
      assert.equal(await row(page).count(), 1)
    })
    await check("warning names Binance, no red error block", async () => {
      await warning(page).waitFor({ timeout: 10_000 })
      assert.match(await warning(page).innerText(), /Could not sync Binance\b/)
      const errors = await page.locator("text=Exchange errors:").count()
      assert.equal(errors, 0, "red exchange-errors block shown during cooldown")
    })

    // --- 2. navbar refresh during the cooldown --------------------------------
    await check("refresh click stays off Binance and keeps the banner", async () => {
      const urls = []
      const onReq = (r) => urls.push(r.url())
      page.on("request", onReq)
      await page.locator('header [data-testid="nav-refresh"]:visible').click()
      await page.waitForFunction(
        () => document.querySelector('header [data-testid="nav-refresh"]')?.getAttribute("data-busy") === "false",
        null,
        { timeout: 60_000 }
      )
      page.off("request", onReq)
      const hits = urls.filter((u) => u.includes("binance.com"))
      assert.deepEqual(hits, [], `refresh broke through the cooldown: ${hits.slice(0, 3).join(", ")}`)
      assert.equal(await warning(page).count(), 1)
      assert.equal(await row(page).count(), 1, "no duplicate rows after refresh")
    })

    await check("no page errors", async () => {
      assert.deepEqual(pageErrors, [])
    })
  } finally {
    await browser.close()
    await teardown()
  }

  console.log(`\n${passed} passed, ${failed.length} failed`)
  if (failed.length > 0) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await teardown().catch(() => {})
  process.exit(1)
})
