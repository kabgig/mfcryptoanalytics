/**
 * Headless UI test for the Spot CSV export.
 *
 * Drives the real /spot page in Chromium: checks the Export button is disabled
 * with no entries, seeds a DCA history (two buys, a partial sell, a sell to
 * flat, a re-buy, plus a soft-deleted row and an ETH buy), clicks Export and
 * asserts on the downloaded CSV itself — header, row set, and the derived
 * position / PnL / cycle columns — against the same numbers the page shows.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:spot-export
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
const TEST_TELEGRAM_ID = "990000000007"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const EXPECTED_HEADER = [
  "tradedAt", "ticker", "side", "qty", "price", "total",
  "qtyApplied", "oversold", "positionQty", "costBasis", "avgEntryBefore", "avgEntryAfter",
  "realisedPnl", "realisedPnlPct", "cumRealisedPnl",
  "cycle", "priceVsAvgPct", "daysSincePrevEntry", "currentPrice", "changeSinceEntryPct",
]

const sql = neon(process.env.DATABASE_URL)

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM public.spot_entries WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users        WHERE telegram_id = ${tid}`
}

async function seed() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`
    INSERT INTO public.users (telegram_id, telegram_name)
    VALUES (${tid}, ${"ui-test-spot-export"}) ON CONFLICT (telegram_id) DO NOTHING
  `
  const rows = [
    ["BTC", "BUY", 1, 100, "2026-06-01T12:00:00Z", null],
    ["BTC", "BUY", 3, 200, "2026-07-01T12:00:00Z", null],
    ["BTC", "SELL", 1, 500, "2026-08-01T12:00:00Z", null],
    ["BTC", "SELL", 3, 150, "2026-08-11T12:00:00Z", null],
    ["BTC", "BUY", 2, 120, "2026-09-01T12:00:00Z", null],
    ["ETH", "BUY", 0.5, 3000, "2026-07-15T12:00:00Z", null],
    // Soft-deleted: must not appear in the table or the export.
    ["BTC", "BUY", 99, 1, "2026-06-15T12:00:00Z", new Date().toISOString()],
  ]
  for (const [ticker, side, qty, price, at, deleted] of rows) {
    await sql`
      INSERT INTO public.spot_entries (telegram_id, ticker, side, qty, price, traded_at, deleted_at)
      VALUES (${tid}, ${ticker}, ${side}, ${qty}, ${price}, ${at}, ${deleted})
    `
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  console.log(`\nsetup: synthetic user ${TEST_TELEGRAM_ID}, no entries`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true })
  await context.addInitScript((id) => {
    localStorage.setItem(
      "mfca-user-store",
      JSON.stringify({
        state: {
          userId: null,
          walletAddress: null,
          telegramId: id,
          telegramName: "ui-test-spot-export",
          role: "USER",
          apiKeys: {},
          originalAdmin: null,
        },
        version: 0,
      })
    )
  }, TEST_TELEGRAM_ID)

  const page = await context.newPage()
  await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "spot-export-ui")
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))

  const exportBtn = page.locator('[data-testid="export-spot"]')
  const rowCount = () => page.locator('[data-testid="spot-entry-row"]').count()

  try {
    await gotoApp(page, `${BASE}/spot`)

    console.log("\nempty state")
    await check("the Export button is present but disabled with no entries", async () => {
      assert.equal(await rowCount(), 0)
      assert.ok(await exportBtn.isVisible())
      assert.equal(await exportBtn.isDisabled(), true)
    })

    console.log("\nwith entries")
    await seed()
    // Prices load after entries; wait for them so the current-price column is
    // compared against exactly what the page holds.
    const pricesRes = page.waitForResponse((r) => r.url().includes("/api/spot/prices"), {
      timeout: 120_000,
    })
    await reloadApp(page)
    await page.waitForSelector('[data-testid="spot-entry-row"]')
    const prices = await (await pricesRes).json()

    await check("the table lists the 6 live entries and the button is enabled", async () => {
      assert.equal(await rowCount(), 6)
      assert.equal(await exportBtn.isDisabled(), false)
    })
    await page.screenshot({ path: `${SHOTS}/spot-export-1-ready.png`, fullPage: true })

    const download = await Promise.all([page.waitForEvent("download"), exportBtn.click()]).then(
      ([d]) => d
    )
    const raw = await download.createReadStream().then(async (s) => {
      let out = ""
      for await (const chunk of s) out += chunk
      return out
    })

    await check("the download is a date-stamped spot csv", async () => {
      assert.match(download.suggestedFilename(), /^spot-\d{4}-\d{2}-\d{2}\.csv$/)
    })
    await check("the file starts with a UTF-8 BOM and ends with CRLF", async () => {
      assert.ok(raw.startsWith("﻿"), "missing BOM")
      assert.ok(raw.endsWith("\r\n"), "missing trailing CRLF")
    })

    const lines = raw.replace(/^﻿/, "").split("\r\n").slice(0, -1)
    const header = lines[0].split(",")
    const recs = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])))

    await check("the header is exactly the documented columns", async () => {
      assert.deepEqual(header, EXPECTED_HEADER)
    })
    await check("one record per live entry — the soft-deleted row is absent", async () => {
      assert.equal(recs.length, 6)
      assert.ok(!recs.some((r) => r.qty === "99"), "soft-deleted entry was exported")
    })
    await check("records are newest first", async () => {
      const dates = recs.map((r) => r.tradedAt)
      assert.deepEqual(dates, [...dates].sort().reverse())
    })

    const btc = recs.filter((r) => r.ticker === "BTC")
    const [rebuy, flatSell, partialSell] = btc
    await check("the partial sell banks $325 at a $175 average", async () => {
      assert.equal(partialSell.side, "SELL")
      assert.equal(partialSell.avgEntryBefore, "175")
      assert.equal(partialSell.realisedPnl, "325")
      assert.equal(partialSell.positionQty, "3")
      assert.equal(partialSell.oversold, "no")
    })
    await check("the sell to flat closes cycle 1 at cumulative +$250", async () => {
      assert.equal(flatSell.realisedPnl, "-75")
      assert.equal(flatSell.cumRealisedPnl, "250")
      assert.equal(flatSell.positionQty, "0")
      assert.equal(flatSell.avgEntryAfter, "")
      assert.equal(flatSell.cycle, "1")
    })
    await check("the re-buy opens cycle 2 with a fresh $120 average", async () => {
      assert.equal(rebuy.cycle, "2")
      assert.equal(rebuy.avgEntryBefore, "")
      assert.equal(rebuy.avgEntryAfter, "120")
      assert.equal(rebuy.daysSincePrevEntry, "21")
    })
    await check("the export's open position matches the summary on screen", async () => {
      const onScreen = await page.locator('[data-testid="spot-avg-entry-BTC"]').innerText()
      assert.match(onScreen, /^\$120(\.00)?$/)
      assert.match(await page.locator('[data-testid="spot-qty-BTC"]').innerText(), /^2 BTC$/)
      assert.equal(rebuy.positionQty, "2")
    })
    await check("currentPrice is the price the page loaded, or blank without one", async () => {
      for (const r of recs) {
        const p = prices.current?.[r.ticker]
        assert.equal(r.currentPrice, p == null ? "" : String(p), `${r.ticker} currentPrice`)
        assert.equal(r.changeSinceEntryPct === "", p == null, `${r.ticker} changeSinceEntryPct`)
      }
    })

    console.log("\nafter export")
    await check("the page is still usable — rows and button intact", async () => {
      assert.equal(await rowCount(), 6)
      assert.equal(await exportBtn.isDisabled(), false)
    })
    await check("no uncaught page errors", () => {
      assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join("\n---\n")}`)
    })
    await page.screenshot({ path: `${SHOTS}/spot-export-2-after.png`, fullPage: true })

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
