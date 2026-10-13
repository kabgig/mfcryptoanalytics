/**
 * Headless UI check: a failed exchange sync must be visible on the dashboard.
 *
 * When the server cannot reach an exchange it answers with the trades it has
 * stored and `stale: true`. The dashboard ignored that flag, so a broken OKX sync
 * (2026-10-06 → 10-13) looked like "no new trades" for a week. This drives the
 * real stack end to end: the browser holds deliberately invalid OKX keys, the dev
 * server calls okx.com for real, OKX rejects them, and the route falls back to the
 * seeded trade. Asserts on the DOM, the route's JSON and the DB.
 *
 * SAFETY: one synthetic user, created and removed by this script; teardown runs
 * in a finally block and also at the start, for a crashed previous run. The OKX
 * key is fake — it cannot touch any real account.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:okx-stale
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
const TEST_TELEGRAM_ID = "990000001101"
const TICKER = "UITESTUSDT"

const sql = neon(process.env.DATABASE_URL)
const tid = BigInt(TEST_TELEGRAM_ID)

// Inside the default 3m period, so the row is not filtered out.
const closed = new Date(Date.now() - 5 * 86_400_000)
const TRADE = {
  id: "okx-futures-uitest-1", exchange: "OKX", ticker: TICKER, positionSize: 1,
  tp: null, sl: null, pnl: 42, market: "futures",
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

/** Loads the dashboard and returns the parsed /api/trades-global response. */
async function loadDashboard(page) {
  const resp = page.waitForResponse((r) => r.url().includes("/api/trades-global"), { timeout: 90_000 })
  await gotoApp(page, `${BASE}/`)
  const json = await (await resp).json()
  await row(page).first().waitFor({ timeout: 30_000 })
  return json
}

async function main() {
  await teardown()
  const cookie = await signIn(BASE, TEST_TELEGRAM_ID, "okx-stale-test")
  const stored = await fetch(`${BASE}/api/trades-store`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ exchange: "OKX", trades: [TRADE] }),
  })
  assert.equal(stored.status, 200, "seed trade")
  // trades-store marks the cache fresh; drop that so the page goes to OKX.
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    await context.addInitScript((id) => {
      localStorage.setItem("mfca-user-store", JSON.stringify({
        state: {
          userId: null, walletAddress: null,
          telegramId: id, telegramName: "okx-stale-test", role: "USER",
          apiKeys: { okxApiKey: "uitest-fake-key", okxApiSecret: "uitest-fake-secret", okxPassphrase: "uitest" },
          originalAdmin: null,
        },
        version: 0,
      }))
    }, TEST_TELEGRAM_ID)
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))
    await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "okx-stale-test")

    // --- 1. live sync fails ---------------------------------------------------
    const first = await loadDashboard(page)
    await check("route fell back to stored trades (stale: true)", async () => {
      assert.equal(first.stale, true)
      assert.equal(first.fromCache, true)
    })
    await check("stored trade still renders", async () => {
      assert.equal(await row(page).count(), 1)
    })
    await check("warning names OKX", async () => {
      await warning(page).waitFor({ timeout: 10_000 })
      assert.match(await warning(page).innerText(), /Could not sync OKX\b/)
    })
    await check("a failed sync does not mark the cache fresh", async () => {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`
      assert.equal(n, 0)
    })

    // --- 2. navbar refresh, still failing --------------------------------------
    await check("refresh retries live (force) and shows the warning once", async () => {
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().includes("/api/trades-global"), { timeout: 15_000 }),
        page.locator('header [data-testid="nav-refresh"]:visible').click(),
      ])
      assert.equal(JSON.parse(req.postData()).force, true)
      await page.waitForFunction(
        () => document.querySelector('header [data-testid="nav-refresh"]')?.getAttribute("data-busy") === "false",
        null,
        { timeout: 60_000 }
      )
      assert.equal(await warning(page).count(), 1)
      assert.match(await warning(page).innerText(), /Could not sync OKX —/, "not 'OKX, OKX'")
      assert.equal(await row(page).count(), 1, "no duplicate rows after refresh")
    })

    // --- 3. fresh cache: no live call, no warning ------------------------------
    await sql`
      INSERT INTO public.exchange_fetch_log (telegram_id, exchange, fetched_at)
      VALUES (${tid}, 'OKX', NOW())
    `
    {
      const fresh = await context.newPage()
      const json = await loadDashboard(fresh)
      await check("fresh cache: served from cache, no warning", async () => {
        assert.equal(json.fromCache, true)
        assert.notEqual(json.stale, true)
        assert.equal(await row(fresh).count(), 1)
        assert.equal(await warning(fresh).count(), 0)
      })
      await fresh.close()
    }

    // --- 4. route error: error banner, not the stale warning --------------------
    {
      const errPage = await context.newPage()
      await errPage.route("**/api/trades-global", (r) =>
        r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Internal server error" }) })
      )
      await gotoApp(errPage, `${BASE}/`)
      await check("route error still shows the Exchange errors banner", async () => {
        await errPage.getByText("Exchange errors:").waitFor({ timeout: 30_000 })
        assert.match(await errPage.locator("main").innerText(), /OKX:.*Internal server error/)
        assert.equal(await warning(errPage).count(), 0)
      })
      await errPage.close()
    }

    await check("no uncaught page errors", async () => {
      assert.deepEqual(pageErrors, [])
    })
  } finally {
    await browser.close()
    await teardown()
    console.log("\nteardown: synthetic user removed")
  }

  console.log(`\n${passed} passed, ${failed.length} failed`)
  if (failed.length) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await teardown().catch(() => {})
  process.exit(1)
})
