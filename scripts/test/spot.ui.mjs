/**
 * Headless UI smoke test for the Spot DCA tracker.
 *
 * Drives the real /spot page in Chromium: adds buys through the form, checks the
 * summary maths, sells the position to zero to prove the average entry resets,
 * re-buys to prove a fresh cycle starts, and deletes an entry.
 * Screenshots land in scripts/test/screenshots/.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one. Cached price rows
 * are global by design and are left alone — they carry no user data.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:spot
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
const TEST_TELEGRAM_ID = "990000000003"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM spot_entries WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users        WHERE telegram_id = ${tid}`
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  console.log(`\nsetup: synthetic user ${TEST_TELEGRAM_ID}, no entries`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })

  await context.addInitScript((id) => {
    localStorage.setItem(
      "mfca-user-store",
      JSON.stringify({
        state: {
          userId: null,
          walletAddress: null,
          telegramId: id,
          telegramName: "ui-test-spot",
          role: "USER",
          apiKeys: {},
          originalAdmin: null,
        },
        version: 0,
      })
    )
  }, TEST_TELEGRAM_ID)

  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))
  const netIssues = []
  page.on("response", (r) => {
    const u = r.url()
    if (r.status() >= 400 && u.includes("/api/spot")) netIssues.push(`HTTP ${r.status()} ${u}`)
  })

  const text = (tid) => page.locator(`[data-testid="${tid}"]`).innerText()
  const rowCount = () => page.locator('[data-testid="spot-entry-row"]').count()

  /** Fills the form and submits, waiting for the POST to actually land. */
  async function addEntry({ ticker, side = "BUY", mode = "qty", amount, price, date }) {
    await page.locator('[data-testid="spot-ticker"]').fill(ticker)
    // The autocomplete panel overlays the fields below it; dismiss it first.
    await page.keyboard.press("Escape")
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.locator(`[data-testid="spot-side-${side}"]`).click()
    await page.locator(`[data-testid="spot-mode-${mode}"]`).click()
    await page.locator('[data-testid="spot-amount"]').fill(String(amount))
    await page.locator('[data-testid="spot-price"]').fill(String(price))
    if (date) await page.locator('[data-testid="spot-date"]').fill(date)

    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "POST"
    )
    await page.locator('[data-testid="spot-submit"]').click()
    return responded
  }

  try {
    await page.goto(`${BASE}/spot`, { waitUntil: "networkidle" })

    console.log("\nempty state")
    await check("the Spot nav link is present and active", async () => {
      const link = page.locator('header a[href="/spot"]').first()
      assert.ok(await link.isVisible())
      assert.equal((await link.innerText()).trim(), "Spot")
    })
    await check("the page renders with no entries", async () => {
      assert.equal(await rowCount(), 0)
      assert.match(await page.innerText("body"), /No entries yet/)
    })
    await check("the ticker autocomplete loaded from Coinbase", async () => {
      await page.locator('[data-testid="spot-ticker"]').fill("BT")
      await page.waitForTimeout(300)
      const opts = await page.locator('[data-testid="spot-ticker"] ~ div button').allInnerTexts()
      assert.ok(opts.includes("BTC"), `expected BTC among suggestions, got ${opts.join(",")}`)
      await page.locator('[data-testid="spot-ticker"]').fill("")
      await page.keyboard.press("Escape")
    })
    await page.screenshot({ path: `${SHOTS}/spot-1-empty.png`, fullPage: true })

    console.log("\nDCA: two buys at different prices")
    let res = await addEntry({ ticker: "BTC", amount: 1, price: 100, date: "2026-06-01" })
    assert.equal(res.status(), 200)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 1
    )
    res = await addEntry({ ticker: "BTC", amount: 3, price: 200, date: "2026-07-01" })
    assert.equal(res.status(), 200)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 2
    )

    await check("both entries are listed", async () => {
      assert.equal(await rowCount(), 2)
    })
    await check("average entry is weighted: 4 BTC at $175, not $150", async () => {
      assert.match(await text("spot-avg-entry-BTC"), /^\$175(\.00)?$/)
      assert.match(await text("spot-qty-BTC"), /^4 BTC$/)
    })
    await check("cost basis is $700", async () => {
      assert.match(await text("spot-cost-basis"), /^\$700(\.00)?$/)
    })
    await page.screenshot({ path: `${SHOTS}/spot-2-after-buys.png`, fullPage: true })

    console.log("\npartial sell leaves the average untouched")
    res = await addEntry({
      ticker: "BTC", side: "SELL", amount: 1, price: 500, date: "2026-08-01",
    })
    assert.equal(res.status(), 200)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 3
    )
    await check("3 BTC left, average still $175", async () => {
      assert.match(await text("spot-qty-BTC"), /^3 BTC$/)
      assert.match(await text("spot-avg-entry-BTC"), /^\$175(\.00)?$/)
    })
    await check("realised PnL banks 1 * (500 - 175) = $325", async () => {
      assert.match(await text("spot-realised-pnl"), /^\+\$325(\.00)?$/)
    })

    console.log("\noverselling is rejected before it reaches the DB")
    await page.locator('[data-testid="spot-ticker"]').fill("BTC")
    await page.keyboard.press("Escape")
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.locator('[data-testid="spot-side-SELL"]').click()
    await page.locator('[data-testid="spot-mode-qty"]').click()
    await page.locator('[data-testid="spot-amount"]').fill("99")
    await page.locator('[data-testid="spot-price"]').fill("500")
    await page.locator('[data-testid="spot-submit"]').click()
    await check("the form blocks a sell larger than the position", async () => {
      await page.waitForSelector('[data-testid="spot-error"]')
      assert.match(await text("spot-error"), /Only 3 BTC held/)
      assert.equal(await rowCount(), 3, "no row was written")
    })

    console.log("\nfull sell resets the DCA cycle")
    res = await addEntry({
      ticker: "BTC", side: "SELL", amount: 3, price: 400, date: "2026-08-05",
    })
    assert.equal(res.status(), 200)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 4
    )
    await check("the closed position drops off the per-coin cards", async () => {
      assert.equal(await page.locator('[data-testid="spot-coin-card-BTC"]').count(), 0)
    })
    await check("cost basis returns to $0", async () => {
      assert.match(await text("spot-cost-basis"), /^\$0(\.00)?$/)
    })

    console.log("\nre-buy starts a fresh average")
    res = await addEntry({ ticker: "BTC", amount: 1, price: 1000, date: "2026-08-10" })
    assert.equal(res.status(), 200)
    await page.waitForSelector('[data-testid="spot-coin-card-BTC"]')
    await check("average entry is $1000, not blended with the old cycle", async () => {
      assert.match(await text("spot-avg-entry-BTC"), /^\$1,?000(\.00)?$/)
      assert.match(await text("spot-qty-BTC"), /^1 BTC$/)
    })
    await page.screenshot({ path: `${SHOTS}/spot-3-after-rebuy.png`, fullPage: true })

    console.log("\ncharts render")
    await check("all three charts draw SVG content", async () => {
      const svgs = await page.locator(".recharts-surface").count()
      assert.ok(svgs >= 3, `expected >= 3 chart surfaces, found ${svgs}`)
    })
    await check("the DCA chart plots the average-entry line", async () => {
      assert.ok(
        (await page.locator(".recharts-line, .recharts-area").count()) > 0,
        "no line/area series rendered"
      )
    })

    console.log("\ndelete an entry")
    const before = await rowCount()
    const deleted = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "DELETE"
    )
    await page.locator('[data-testid="spot-delete-entry"]').first().click()
    assert.equal((await deleted).status(), 200)
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="spot-entry-row"]').length === n,
      before - 1
    )
    await check("the row is removed from the table", async () => {
      assert.equal(await rowCount(), before - 1)
    })
    await check("the delete is a soft delete in the DB", async () => {
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM spot_entries
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND deleted_at IS NOT NULL
      `
      assert.equal(rows[0].n, 1, "expected exactly one soft-deleted row")
    })

    console.log("\nreload persists")
    await page.reload({ waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="spot-entry-row"]')
    await check("entries survive a reload", async () => {
      assert.equal(await rowCount(), before - 1)
    })
    await page.screenshot({ path: `${SHOTS}/spot-4-final.png`, fullPage: true })

    console.log("\nisolation")
    await check("the share endpoint never exposes spot data", async () => {
      const res = await fetch(`${BASE}/api/share/nonexistent`)
      const body = await res.text()
      assert.ok(!body.includes("spot"), "share route leaked spot data")
    })

    await check("no uncaught page errors", () => {
      assert.deepEqual(pageErrors, [])
    })
    await check("no failing /api/spot requests", () => {
      assert.deepEqual(netIssues, [])
    })

    console.log(`\n${passed} checks passed\n`)
  } finally {
    await browser.close()
    await teardown()
    console.log(`teardown: removed synthetic user ${TEST_TELEGRAM_ID}`)
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err)
  process.exit(1)
})
