/**
 * Headless UI smoke test for the Spot DCA tracker.
 *
 * Drives the real /spot page in Chromium: adds buys through the form, checks the
 * summary maths, sells the position to zero to prove the average entry resets,
 * re-buys to prove a fresh cycle starts, and deletes an entry. Also drives the
 * "any two of coins / $ spent / price" amount fields and checks the derived
 * value both on screen and in the stored row, and adds XDC — a coin Coinbase
 * does not list — to prove the Kraken fallback prices it end to end.
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
import { signInBrowser } from "./helpers/session.mjs"
import { gotoApp, reloadApp } from "./helpers/nav.mjs"

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

// XDC price rows are only removed if this run created them (see main()).
let xdcCachedBefore = true

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  if (!xdcCachedBefore) await sql`DELETE FROM public.spot_price_history WHERE ticker = 'XDC'`
  await sql`DELETE FROM public.spot_entries WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users        WHERE telegram_id = ${tid}`
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  xdcCachedBefore =
    (await sql`SELECT COUNT(*)::int AS n FROM public.spot_price_history WHERE ticker = 'XDC'`)[0].n > 0
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
  // The cookie, not localStorage, is what the server trusts now.
  await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "spot-ui")
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))
  const netIssues = []
  page.on("response", (r) => {
    const u = r.url()
    if (r.status() >= 400 && u.includes("/api/spot")) netIssues.push(`HTTP ${r.status()} ${u}`)
  })

  const text = (tid) => page.locator(`[data-testid="${tid}"]`).innerText()
  const rowCount = () => page.locator('[data-testid="spot-entry-row"]').count()

  const AMOUNT_TESTID = { coins: "spot-coins", usd: "spot-usd", price: "spot-price" }
  const amountInput = (f) => page.locator(`[data-testid="${AMOUNT_TESTID[f]}"]`)
  /** Which amount field the form currently computes, or null. */
  const derivedNow = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-derived="true"]')
      return el ? el.getAttribute("data-testid") : null
    })

  /** Sets ticker/side, then types `amounts` ([field, value] pairs) in order. */
  async function fillForm({ ticker, side = "BUY", amounts, date }) {
    await page.locator('[data-testid="spot-ticker"]').fill(ticker)
    // The autocomplete panel overlays the fields below it; dismiss it first.
    await page.keyboard.press("Escape")
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.locator(`[data-testid="spot-side-${side}"]`).click()
    for (const [f, v] of amounts) await amountInput(f).fill(String(v))
    if (date) await page.locator('[data-testid="spot-date"]').fill(date)
  }

  /** Fills the form and submits, waiting for the POST to actually land. */
  async function addEntry({ ticker, side = "BUY", coins, price, date, amounts }) {
    await fillForm({
      ticker,
      side,
      date,
      amounts: amounts ?? [["coins", coins], ["price", price]],
    })

    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "POST"
    )
    await page.locator('[data-testid="spot-submit"]').click()
    return responded
  }

  try {
    await gotoApp(page, `${BASE}/spot`)

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
    let res = await addEntry({ ticker: "BTC", coins: 1, price: 100, date: "2026-06-01" })
    assert.equal(res.status(), 200)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 1
    )
    res = await addEntry({ ticker: "BTC", coins: 3, price: 200, date: "2026-07-01" })
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
      ticker: "BTC", side: "SELL", coins: 1, price: 500, date: "2026-08-01",
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
    await fillForm({ ticker: "BTC", side: "SELL", amounts: [["coins", 99], ["price", 500]] })
    await page.locator('[data-testid="spot-submit"]').click()
    await check("the form blocks a sell larger than the position", async () => {
      await page.waitForSelector('[data-testid="spot-error"]')
      assert.match(await text("spot-error"), /Only 3 BTC held/)
      assert.equal(await rowCount(), 3, "no row was written")
    })

    console.log("\nfull sell resets the DCA cycle")
    res = await addEntry({
      ticker: "BTC", side: "SELL", coins: 3, price: 400, date: "2026-08-05",
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
    res = await addEntry({ ticker: "BTC", coins: 1, price: 1000, date: "2026-08-10" })
    assert.equal(res.status(), 200)
    await page.waitForSelector('[data-testid="spot-coin-card-BTC"]')
    await check("average entry is $1000, not blended with the old cycle", async () => {
      assert.match(await text("spot-avg-entry-BTC"), /^\$1,?000(\.00)?$/)
      assert.match(await text("spot-qty-BTC"), /^1 BTC$/)
    })
    await page.screenshot({ path: `${SHOTS}/spot-3-after-rebuy.png`, fullPage: true })

    console.log("\nany two of coins / $ spent / price derive the third")
    await fillForm({ ticker: "ETH", amounts: [["coins", 250], ["usd", 500]] })
    await check("coins + $ spent fill the price field", async () => {
      assert.equal(await derivedNow(), "spot-price")
      assert.equal(await amountInput("price").inputValue(), "2")
    })
    await check("overriding the derived price makes coins the derived field", async () => {
      await amountInput("price").fill("4")
      assert.equal(await derivedNow(), "spot-coins")
      assert.equal(await amountInput("coins").inputValue(), "125")
    })
    await check("clearing a typed field blanks the derived one", async () => {
      await amountInput("usd").fill("")
      assert.equal(await derivedNow(), "spot-coins")
      assert.equal(await amountInput("coins").inputValue(), "")
    })

    const ethRow = async () =>
      (
        await sql`
          SELECT qty::float8 AS qty, price::float8 AS price FROM public.spot_entries
          WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'ETH'
            AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 1
        `
      )[0]

    // Re-typing coins then $ makes price derived again; its stale typed "4"
    // must be ignored in favour of the computed $2.
    res = await addEntry({
      ticker: "ETH", amounts: [["coins", 250], ["usd", 500]], date: "2026-08-12",
    })
    assert.equal(res.status(), 200)
    await check("coins + $ spent store qty 250 at the derived price $2", async () => {
      const row = await ethRow()
      assert.equal(row.qty, 250)
      assert.equal(row.price, 2)
    })
    await check("a successful add clears all three amount fields", async () => {
      for (const f of ["coins", "usd", "price"]) assert.equal(await amountInput(f).inputValue(), "")
      assert.equal(await derivedNow(), null)
    })

    res = await addEntry({
      ticker: "ETH", amounts: [["usd", 300], ["price", 3]], date: "2026-08-13",
    })
    assert.equal(res.status(), 200)
    await check("$ spent + price store the derived qty 100", async () => {
      const row = await ethRow()
      assert.equal(row.qty, 100)
      assert.equal(row.price, 3)
    })

    await fillForm({ ticker: "ETH", amounts: [["usd", 300]] })
    await page.locator('[data-testid="spot-submit"]').click()
    await check("a single amount field is rejected with a clear message", async () => {
      await page.waitForSelector('[data-testid="spot-error"]')
      assert.match(await text("spot-error"), /Fill any two of coins, \$ spent and price/)
      const n = await sql`
        SELECT COUNT(*)::int AS n FROM public.spot_entries
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'ETH'
      `
      assert.equal(n[0].n, 2, "no row was written")
    })
    await amountInput("usd").fill("")
    await page.screenshot({ path: `${SHOTS}/spot-3b-any-two.png`, fullPage: true })

    console.log("\nXDC is priced through the Kraken fallback")
    await check("XDC is offered by the ticker autocomplete", async () => {
      await page.locator('[data-testid="spot-ticker"]').fill("XD")
      await page.waitForTimeout(300)
      const opts = await page.locator('[data-testid="spot-ticker"] ~ div button').allInnerTexts()
      assert.ok(opts.includes("XDC"), `expected XDC among suggestions, got ${opts.join(",")}`)
      await page.locator('[data-testid="spot-ticker"]').fill("")
      await page.keyboard.press("Escape")
    })
    res = await addEntry({
      ticker: "XDC", amounts: [["coins", 1000], ["usd", 30]], date: "2026-09-20",
    })
    await check("an XDC buy is accepted and stored", async () => {
      assert.equal(res.status(), 200)
      const rows = await sql`
        SELECT qty::float8 AS qty, price::float8 AS price FROM public.spot_entries
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'XDC'
      `
      assert.equal(rows.length, 1)
      assert.equal(rows[0].qty, 1000)
      assert.equal(rows[0].price, 0.03)
    })
    await check("the XDC card shows a live market price, not 'no feed'", async () => {
      const card = page.locator('[data-testid="spot-coin-card-XDC"]')
      await card.waitFor()
      await page.waitForFunction(
        () => /Market\s+\$0\.\d+/.test(
          document.querySelector('[data-testid="spot-coin-card-XDC"]')?.innerText ?? ""
        ),
        null,
        { timeout: 30000 }
      )
      assert.doesNotMatch(await page.innerText("body"), /No price feed for[^\n]*XDC/)
    })
    await check("XDC daily closes were backfilled into the price cache", async () => {
      const rows = await sql`
        SELECT MIN(day)::text AS first, COUNT(*)::int AS n
        FROM public.spot_price_history WHERE ticker = 'XDC'
      `
      assert.ok(rows[0].n >= 1, "no XDC closes cached")
      // Only checkable when this run started the XDC cache from empty.
      if (!xdcCachedBefore) assert.equal(rows[0].first, "2026-09-20")
    })
    await page.screenshot({ path: `${SHOTS}/spot-3c-xdc.png`, fullPage: true })

    console.log("\na backdated sell is checked against holdings on its date")
    const btcSells = async () =>
      (
        await sql`
          SELECT COUNT(*)::int AS n FROM public.spot_entries
          WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'BTC' AND side = 'SELL'
        `
      )[0].n
    const sellsBefore = await btcSells()
    // 1 BTC is held today, but nothing was held on 2026-05-01 (first buy 06-01).
    await fillForm({
      ticker: "BTC", side: "SELL", amounts: [["coins", 1], ["price", 100]], date: "2026-05-01",
    })
    await page.locator('[data-testid="spot-submit"]').click()
    await check("a sell dated before the first buy is blocked", async () => {
      await page.waitForSelector('[data-testid="spot-error"]')
      assert.match(await text("spot-error"), /Only 0 BTC held on 2026-05-01/)
      assert.equal(await btcSells(), sellsBefore, "no row was written")
    })
    for (const f of ["coins", "price"]) await amountInput(f).fill("")

    console.log("\nedit an entry")
    const rowOn = (d) => page.locator('[data-testid="spot-entry-row"]', { hasText: d })
    const formMode = () => page.locator('[data-testid="spot-form"]').getAttribute("data-mode")
    const flags = () => page.locator('[data-testid="spot-oversold"]')
    const rowsBeforeEdit = await rowCount()
    const julyBuyId = String(
      (
        await sql`
          SELECT id FROM public.spot_entries
          WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'BTC'
            AND traded_at::date = '2026-07-01'
        `
      )[0].id
    )
    const dbRow = async (id) =>
      (
        await sql`
          SELECT qty::float8 AS qty, price::float8 AS price FROM public.spot_entries
          WHERE id = ${BigInt(id)}
        `
      )[0]

    await check("every row has an edit button", async () => {
      assert.equal(await page.locator('[data-testid="spot-edit-entry"]').count(), await rowCount())
    })
    await check("no sell is flagged while the ledger is consistent", async () => {
      assert.equal(await flags().count(), 0)
    })

    await rowOn("2026-07-01").locator('[data-testid="spot-edit-entry"]').click()
    await check("edit loads the entry into the form with ticker, side and date locked", async () => {
      assert.equal(await formMode(), "edit")
      assert.equal(await rowOn("2026-07-01").getAttribute("data-editing"), "true")
      const tickerInput = page.locator('[data-testid="spot-ticker"]')
      assert.equal(await tickerInput.inputValue(), "BTC")
      assert.ok(await tickerInput.isDisabled())
      assert.ok(await page.locator('[data-testid="spot-side-BUY"]').isDisabled())
      const dateInput = page.locator('[data-testid="spot-date"]')
      assert.equal(await dateInput.inputValue(), "2026-07-01")
      assert.ok(await dateInput.isDisabled())
      assert.equal(await amountInput("coins").inputValue(), "3")
      assert.equal(await amountInput("price").inputValue(), "200")
      assert.equal(await derivedNow(), "spot-usd")
      assert.equal(await amountInput("usd").inputValue(), "600")
      assert.match(await text("spot-submit"), /Save/)
    })
    await page.screenshot({ path: `${SHOTS}/spot-5-editing.png`, fullPage: true })

    await page.locator('[data-testid="spot-cancel-edit"]').click()
    await check("cancel returns to an empty add form and writes nothing", async () => {
      assert.equal(await formMode(), "add")
      assert.equal(await amountInput("coins").inputValue(), "")
      assert.equal(await page.locator('[data-testid="spot-ticker"]').isDisabled(), false)
      assert.equal((await dbRow(julyBuyId)).qty, 3)
    })

    // Lowering the Jul buy 3 → 2 strands the Aug 5 sell of 3 (only 2 held then).
    await rowOn("2026-07-01").locator('[data-testid="spot-edit-entry"]').click()
    await amountInput("coins").fill("2")
    const put = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "PUT"
    )
    await page.locator('[data-testid="spot-submit"]').click()
    await check("saving a lowered buy updates the DB row in place", async () => {
      assert.equal((await put).status(), 200)
      await page.waitForFunction(
        () => document.querySelector('[data-testid="spot-form"]')?.getAttribute("data-mode") === "add"
      )
      const r = await dbRow(julyBuyId)
      assert.equal(r.qty, 2)
      assert.equal(r.price, 200)
      assert.equal(await rowCount(), rowsBeforeEdit, "no row added or removed")
      assert.match(await rowOn("2026-07-01").innerText(), /\$400/)
    })
    await check("the sell it stranded is flagged with what was held", async () => {
      await page.waitForSelector('[data-testid="spot-oversold"]')
      assert.equal(await flags().count(), 1)
      assert.match(
        await rowOn("2026-08-05").locator('[data-testid="spot-oversold"]').innerText(),
        /only 2 held/
      )
    })
    await page.screenshot({ path: `${SHOTS}/spot-6-flagged.png`, fullPage: true })

    const aug5SellId = String(
      (
        await sql`
          SELECT id FROM public.spot_entries
          WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND ticker = 'BTC'
            AND traded_at::date = '2026-08-05'
        `
      )[0].id
    )
    await rowOn("2026-08-05").locator('[data-testid="spot-edit-entry"]').click()
    await amountInput("coins").fill("5")
    await page.locator('[data-testid="spot-submit"]').click()
    await check("enlarging a sell past what was held is blocked in the form", async () => {
      await page.waitForSelector('[data-testid="spot-error"]')
      assert.match(await text("spot-error"), /Only 2 BTC held on 2026-08-05/)
      assert.equal((await dbRow(aug5SellId)).qty, 3)
      assert.equal(await formMode(), "edit", "the form stays open to fix it")
    })

    await amountInput("coins").fill("2")
    const put2 = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "PUT"
    )
    await page.locator('[data-testid="spot-submit"]').click()
    await check("shrinking the stranded sell clears the flag", async () => {
      assert.equal((await put2).status(), 200)
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="spot-oversold"]').length === 0
      )
      assert.equal((await dbRow(aug5SellId)).qty, 2)
    })
    await check("the fresh-cycle average after the edits is still $1000", async () => {
      assert.match(await text("spot-avg-entry-BTC"), /^\$1,?000(\.00)?$/)
      assert.match(await text("spot-qty-BTC"), /^1 BTC$/)
    })

    await reloadApp(page)
    await page.waitForSelector('[data-testid="spot-entry-row"]')
    await check("edits survive a reload", async () => {
      assert.match(await rowOn("2026-07-01").innerText(), /\$400/)
      assert.equal(await flags().count(), 0)
    })

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
        SELECT COUNT(*)::int AS n FROM public.spot_entries
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND deleted_at IS NOT NULL
      `
      assert.equal(rows[0].n, 1, "expected exactly one soft-deleted row")
    })

    console.log("\nreload persists")
    await reloadApp(page)
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
      assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join("\n---\n")}`)
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
