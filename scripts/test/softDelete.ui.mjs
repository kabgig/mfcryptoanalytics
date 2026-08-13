/**
 * Headless UI smoke test for trade soft delete.
 *
 * Seeds a synthetic user through the API, drives the real dashboard in Chromium,
 * and asserts the ✕ / restore flow updates both the table and the stats.
 * Screenshots land in scripts/test/screenshots/.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"

// Playwright is installed globally, not as a project dependency.
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000000002"
const EXCHANGE = "OKX"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

const TRADES = [
  { id: "ui-test-1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1, tp: null, sl: null, pnl: 100,
    openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z" },
  { id: "ui-test-2", exchange: EXCHANGE, ticker: "ETHUSDT", positionSize: 2, tp: null, sl: null, pnl: -50,
    openTime: "2026-08-02T00:00:00.000Z", closeTime: "2026-08-03T00:00:00.000Z" },
  { id: "ui-test-3", exchange: EXCHANGE, ticker: "XRPUSDT", positionSize: 3, tp: null, sl: null, pnl: 25,
    openTime: "2026-08-03T00:00:00.000Z", closeTime: "2026-08-04T00:00:00.000Z" },
]

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users             WHERE telegram_id = ${tid}`
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  await post("/api/trades-store", { telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, trades: TRADES })
  console.log(`\nsetup: seeded ${TRADES.length} trades for synthetic user ${TEST_TELEGRAM_ID}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })

  // Sign in the synthetic user the way the app persists it: no API keys, so the
  // dashboard loads everything from the DB cache instead of hitting an exchange.
  await context.addInitScript((id) => {
    localStorage.setItem("mfca-user-store", JSON.stringify({
      state: {
        userId: null, walletAddress: null,
        telegramId: id, telegramName: "ui-test", role: "USER",
        apiKeys: {}, originalAdmin: null,
      },
      version: 0,
    }))
  }, TEST_TELEGRAM_ID)

  const page = await context.newPage()
  // Uncaught JS errors only. Aborted requests are tracked separately below:
  // navigations and the wallet SDK's external analytics beacon abort routinely
  // and say nothing about this feature.
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))

  const netIssues = []
  page.on("requestfailed", (r) => netIssues.push(`${r.url()} ${r.failure()?.errorText}`))
  page.on("response", (r) => {
    if (r.status() >= 400) netIssues.push(`HTTP ${r.status()} ${r.url()}`)
  })
  const apiCalls = []
  page.on("requestfinished", async (req) => {
    if (!req.url().includes("/api/")) return
    const res = await req.response()
    const body = await res?.text().catch(() => "")
    apiCalls.push(`${req.method()} ${new URL(req.url()).pathname} → ${(body ?? "").slice(0, 120)}`)
  })

  const rowCount = () => page.locator('[data-testid="delete-trade"]').count()
  const totalPnl = async () => (await page.locator('[data-testid="total-pnl"]').innerText()).replace(/\s/g, "")
  const tradeCount = () => page.locator('[data-testid="trade-count"]').innerText()
  const waitForRows = (n) =>
    page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="delete-trade"]').length === expected,
      n
    )

  /**
   * Clicks a button and waits for the request it fires to actually come back.
   * The UI updates optimistically, so waiting on the DOM alone would let the
   * next reload abort the still-in-flight request and silently lose the change.
   */
  async function clickAndAwait(selector, endpoint) {
    const responded = page.waitForResponse(
      (r) => r.url().endsWith(endpoint) && r.request().method() === "POST"
    )
    await page.locator(selector).click()
    const res = await responded
    assert.equal(res.status(), 200, `${endpoint} returned ${res.status()}`)
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="delete-trade"]')
    await page.screenshot({ path: `${SHOTS}/1-initial.png`, fullPage: true })

    console.log("\ninitial render")
    await check("a delete button is visible on every row", async () => {
      assert.equal(await rowCount(), 3)
      // Visible without hover — the button must not be hover-gated.
      assert.ok(await page.locator('[data-testid="delete-trade"]').first().isVisible())
    })
    await check("stats show +$75.00 across 3 trades", async () => {
      assert.equal(await totalPnl(), "+$75.00")
      assert.equal(await tradeCount(), "3")
    })
    await check("no toggle is shown while nothing is deleted", async () => {
      assert.equal(await page.locator('[data-testid="toggle-deleted"]').count(), 0)
    })

    console.log("\ndelete the losing trade")
    await clickAndAwait('[aria-label="Delete ETHUSDT trade"]', "/api/trades/delete")
    await waitForRows(2)
    await page.screenshot({ path: `${SHOTS}/2-after-delete.png`, fullPage: true })

    await check("the row disappears from the table", async () => {
      assert.equal(await rowCount(), 2)
      assert.equal(await page.locator('tr:has-text("ETHUSDT")').count(), 0)
    })
    await check("stats recompute: +$75.00 → +$125.00, 3 trades → 2", async () => {
      assert.equal(await totalPnl(), "+$125.00")
      assert.equal(await tradeCount(), "2")
    })

    console.log("\nshow deleted")
    const toggle = page.locator('[data-testid="toggle-deleted"]')
    await check("the toggle appears and reports one deleted trade", async () => {
      assert.match(await toggle.innerText(), /Show deleted \(1\)/)
    })

    await toggle.click()
    await page.waitForSelector('[data-testid="restore-trade"]')
    await page.screenshot({ path: `${SHOTS}/3-showing-deleted.png`, fullPage: true })

    await check("the deleted row reappears with a restore button", async () => {
      assert.equal(await page.locator('[data-testid="restore-trade"]').count(), 1)
      assert.equal(await page.locator('tr:has-text("ETHUSDT")').count(), 1)
    })
    await check("the revealed row is actually rendered, not a 0-opacity ghost", async () => {
      // The rows animate in via useInView, so presence in the DOM is not enough.
      const row = page.locator('tr:has-text("ETHUSDT")')
      await row.scrollIntoViewIfNeeded()
      assert.ok(await row.isVisible())
      const opacity = await row.evaluate((el) => getComputedStyle(el).opacity)
      assert.ok(Number(opacity) > 0, `row rendered at opacity ${opacity}`)
    })
    await check("the revealed row sits in date order, not dumped at the bottom", async () => {
      // ETHUSDT closes 2026-08-03, between XRPUSDT (08-04) and BTCUSDT (08-02).
      const tickers = await page.locator("tbody tr td:nth-child(2)").allInnerTexts()
      assert.deepEqual(tickers.map((t) => t.trim()), ["XRPUSDT", "ETHUSDT", "BTCUSDT"])
    })
    await check("revealing a deleted row does NOT put it back into the stats", async () => {
      assert.equal(await totalPnl(), "+$125.00")
      assert.equal(await tradeCount(), "2")
    })

    console.log("\nrestore")
    await clickAndAwait('[data-testid="restore-trade"]', "/api/trades/restore")
    await waitForRows(3)
    await page.screenshot({ path: `${SHOTS}/4-after-restore.png`, fullPage: true })

    await check("the trade returns and the stats go back to their original values", async () => {
      assert.equal(await rowCount(), 3)
      assert.equal(await totalPnl(), "+$75.00")
      assert.equal(await tradeCount(), "3")
    })

    console.log("\npersistence")
    await clickAndAwait('[aria-label="Delete ETHUSDT trade"]', "/api/trades/delete")
    await waitForRows(2)

    // Cold-load the app in a new tab rather than reloading this one: an in-page
    // reload races with the SDK's own navigation and gets ERR_ABORTED, which
    // would make this check flaky for reasons unrelated to soft delete.
    const fresh = await context.newPage()
    await fresh.goto(BASE, { waitUntil: "networkidle" })
    await fresh.waitForSelector('[data-testid="delete-trade"]')
    await fresh.screenshot({ path: `${SHOTS}/5-fresh-load.png`, fullPage: true })

    await check("the deletion survives a fresh load of the app", async () => {
      assert.equal(await fresh.locator('[data-testid="delete-trade"]').count(), 2)
      assert.equal(
        (await fresh.locator('[data-testid="total-pnl"]').innerText()).replace(/\s/g, ""),
        "+$125.00"
      )
      assert.equal(await fresh.locator('tr:has-text("ETHUSDT")').count(), 0)
      assert.match(await fresh.locator('[data-testid="toggle-deleted"]').innerText(), /Show deleted \(1\)/)
    })
    await fresh.close()

    await check("no uncaught JS errors in the browser", () => {
      assert.deepEqual(pageErrors, [])
    })
    await check("no failing app requests", () => {
      const appFailures = netIssues.filter((n) => n.includes("localhost") && !n.includes("ERR_ABORTED"))
      assert.deepEqual(appFailures, [])
    })
  } catch (err) {
    await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {})
    console.error("\nbrowser errors:", pageErrors)
    console.error("network issues:", netIssues)
    console.error("rows in DOM:", await page.locator("tbody tr").count().catch(() => "?"))
    console.error("delete buttons in DOM:", await page.locator('[data-testid="delete-trade"]').count().catch(() => "?"))
    console.error("first row html:", await page.locator("tbody tr").first().evaluate((el) => el.outerHTML).catch(() => "?"))
    console.error("api calls:\n  " + apiCalls.slice(-12).join("\n  "))
    throw err
  } finally {
    await browser.close()
    await teardown()
    console.log("\nteardown: synthetic user removed")
  }

  console.log(`\n✓ ${passed} checks passed — screenshots in scripts/test/screenshots/\n`)
}

main().catch((err) => {
  console.error("\n✗ UI test failed:\n", err)
  process.exit(1)
})
