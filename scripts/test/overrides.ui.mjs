/**
 * Headless UI test for manual TP / SL / Bias.
 *
 * Seeds a synthetic user through the API, drives the real dashboard in Chromium,
 * and asserts that the three cells set, edit, clear and persist values — that an
 * override beats the exchange, that bias falls back to `side`, that `side`
 * itself is never rewritten, and that the CSV export carries the resolved
 * numbers. Screenshots land in scripts/test/screenshots/.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one.
 *
 *   npm run dev              # in another terminal
 *   npm run test:ui:overrides
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
// Distinct from the other UI scripts (…002 soft delete, …003 spot, …004
// journal): each tears down its own user, and the FK cascade would take this
// test's overrides with it.
const TEST_TELEGRAM_ID = "990000000005"
const EXCHANGE = "OKX"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

// ov-1 has no side (like every exchange except Bybit/Bitunix) → bias starts "—".
// ov-2 is on Bybit and arrives long, so its bias is derived as "buy" with
// nothing stored — and it keeps Bybit off the "does not report long/short" list
// that the LvsS notice builds.
// ov-3 already carries an exchange tp, to prove an override still wins.
const SIDED_EXCHANGE = "Bybit"
const TRADES = [
  { id: "ov-1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1, tp: null, sl: null, pnl: 100,
    openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z" },
  { id: "ov-2", exchange: SIDED_EXCHANGE, ticker: "ETHUSDT", positionSize: 2, tp: null, sl: null, pnl: -50,
    side: "long",
    openTime: "2026-08-02T00:00:00.000Z", closeTime: "2026-08-03T00:00:00.000Z" },
  { id: "ov-3", exchange: EXCHANGE, ticker: "SOLUSDT", positionSize: 3, tp: 200, sl: null, pnl: 25,
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
  await sql`DELETE FROM trade_overrides    WHERE telegram_id = ${tid}`
  await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users              WHERE telegram_id = ${tid}`
}

/** The stored override row for a trade, or undefined. */
async function storedRow(tradeId) {
  const rows = await sql`
    SELECT tp, sl, bias FROM trade_overrides
    WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = ${tradeId}
  `
  return rows[0]
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  await post("/api/trades-store", { telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, trades: TRADES })
  console.log(`\nsetup: seeded ${TRADES.length} trades for synthetic user ${TEST_TELEGRAM_ID}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  })

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

  const rowFor = (ticker) => page.locator("tbody tr").filter({ hasText: ticker })
  const cell = (ticker, field, p = page) =>
    p.locator("tbody tr").filter({ hasText: ticker }).locator(`[data-testid="${field}-cell"]`)
  const cellText = (ticker, field, p = page) => cell(ticker, field, p).innerText()
  const isOverridden = async (ticker, field, p = page) =>
    (await cell(ticker, field, p).getAttribute("data-overridden")) === "true"

  /**
   * Opens a cell's editor, acts, and waits for the POST to land. The UI updates
   * optimistically, so waiting on the DOM alone would let a later reload abort
   * the in-flight write and silently lose the value.
   */
  async function edit(ticker, field, act) {
    await cell(ticker, field).click()
    await page.waitForSelector('[data-testid="override-popup"]')
    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
    )
    await act()
    const res = await responded
    assert.equal(res.status(), 200, `override save returned ${res.status()}`)
    await page.waitForSelector('[data-testid="override-popup"]', { state: "detached" })
  }

  const setPrice = (ticker, field, value) =>
    edit(ticker, field, async () => {
      await page.locator('[data-testid="override-input"]').fill(String(value))
      await page.locator('[data-testid="override-save"]').click()
    })

  const setBias = (ticker, bias) =>
    edit(ticker, "bias", () => page.locator(`[data-testid="bias-${bias}"]`).click())

  const clearField = (ticker, field) =>
    edit(ticker, field, () => page.locator('[data-testid="override-clear"]').click())

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="bias-cell"]')
    await page.screenshot({ path: `${SHOTS}/o1-initial.png`, fullPage: true })

    console.log("\ninitial render")
    await check("every row has a Bias, TP and SL cell", async () => {
      for (const field of ["bias", "tp", "sl"]) {
        assert.equal(
          await page.locator(`[data-testid="${field}-cell"]`).count(), TRADES.length,
          `expected one ${field} cell per row`
        )
      }
    })
    await check("the Bias column header is on the table", async () => {
      assert.equal(await page.locator("thead th", { hasText: "Bias" }).count(), 1)
    })
    await check("a trade with no side and no override shows an empty bias", async () => {
      assert.equal((await cellText("BTCUSDT", "bias")).trim(), "—")
      assert.equal(await isOverridden("BTCUSDT", "bias"), false)
    })
    await check("bias is derived from the exchange's side when there is one", async () => {
      // ov-2 came in as side=long, with nothing stored in trade_overrides.
      assert.match(await cellText("ETHUSDT", "bias"), /buy/i)
      assert.equal(await isOverridden("ETHUSDT", "bias"), false)
      assert.equal(await storedRow("ov-2"), undefined, "derivation must not write a row")
    })
    await check("TP and SL start empty when the exchange reported none", async () => {
      assert.equal((await cellText("BTCUSDT", "tp")).trim(), "—")
      assert.equal((await cellText("BTCUSDT", "sl")).trim(), "—")
    })
    await check("an exchange-reported TP is shown unmarked", async () => {
      assert.match(await cellText("SOLUSDT", "tp"), /200/)
      assert.equal(await isOverridden("SOLUSDT", "tp"), false)
    })

    console.log("\nsetting TP and SL by hand")
    await cell("BTCUSDT", "tp").click()
    await page.waitForSelector('[data-testid="override-popup"]')
    await check("the editor opens empty for a cell with no override", async () => {
      assert.equal(await page.locator('[data-testid="override-input"]').inputValue(), "")
    })
    await page.keyboard.press("Escape")
    await page.waitForSelector('[data-testid="override-popup"]', { state: "detached" })

    await setPrice("BTCUSDT", "tp", 70000)
    await setPrice("BTCUSDT", "sl", 65000.5)
    await page.screenshot({ path: `${SHOTS}/o2-tp-sl-set.png`, fullPage: true })

    await check("the cells show the values and mark them as the user's", async () => {
      assert.match(await cellText("BTCUSDT", "tp"), /70,000/)
      assert.match(await cellText("BTCUSDT", "sl"), /65,000\.5/)
      assert.equal(await isOverridden("BTCUSDT", "tp"), true)
      assert.equal(await isOverridden("BTCUSDT", "sl"), true)
    })
    await check("both live on one row rather than two", async () => {
      const rows = await sql`
        SELECT tp, sl FROM trade_overrides
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'ov-1'
      `
      assert.equal(rows.length, 1)
      assert.equal(Number(rows[0].tp), 70000)
      assert.equal(Number(rows[0].sl), 65000.5)
    })
    await check("nothing bled onto the other rows", async () => {
      assert.equal((await cellText("ETHUSDT", "tp")).trim(), "—")
      assert.equal(await storedRow("ov-2"), undefined)
    })
    await check("cached_trades was not touched", async () => {
      // The whole point of the separate table: a sync rewrites cached_trades.tp
      // from EXCLUDED, so a value stored there would not survive one.
      const rows = await sql`
        SELECT tp, sl FROM cached_trades
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND id = 'ov-1'
      `
      assert.equal(rows[0].tp, null)
      assert.equal(rows[0].sl, null)
    })

    console.log("\nediting an existing value")
    await cell("BTCUSDT", "tp").click()
    await page.waitForSelector('[data-testid="override-popup"]')
    await check("reopening loads the stored value back into the editor", async () => {
      assert.equal(await page.locator('[data-testid="override-input"]').inputValue(), "70000")
    })
    await page.keyboard.press("Escape")
    await page.waitForSelector('[data-testid="override-popup"]', { state: "detached" })

    await setPrice("BTCUSDT", "tp", 72500)
    await check("the edit replaces the value rather than adding a second row", async () => {
      const rows = await sql`
        SELECT tp FROM trade_overrides
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'ov-1'
      `
      assert.equal(rows.length, 1)
      assert.equal(Number(rows[0].tp), 72500)
    })

    console.log("\nbias")
    await setBias("BTCUSDT", "sell")
    await check("a manually set bias shows and is marked", async () => {
      assert.match(await cellText("BTCUSDT", "bias"), /sell/i)
      assert.equal(await isOverridden("BTCUSDT", "bias"), true)
      assert.equal((await storedRow("ov-1")).bias, "sell")
    })
    await setBias("ETHUSDT", "sell")
    await check("a manual bias overrides the one derived from side", async () => {
      assert.match(await cellText("ETHUSDT", "bias"), /sell/i)
      assert.equal(await isOverridden("ETHUSDT", "bias"), true)
    })
    await check("side itself is left alone, so the LVS split still reads it", async () => {
      const rows = await sql`
        SELECT side FROM cached_trades
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND id = 'ov-2'
      `
      assert.equal(rows[0].side, "long", "the bias override rewrote cached_trades.side")
    })
    await page.screenshot({ path: `${SHOTS}/o3-bias-set.png`, fullPage: true })

    console.log("\noverride beats the exchange")
    await setPrice("SOLUSDT", "tp", 250)
    await check("a user's TP wins over the one the exchange reported", async () => {
      assert.match(await cellText("SOLUSDT", "tp"), /250/)
      assert.equal(await isOverridden("SOLUSDT", "tp"), true)
      // The exchange's own 200 is untouched underneath.
      const rows = await sql`
        SELECT tp FROM cached_trades
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND id = 'ov-3'
      `
      assert.equal(Number(rows[0].tp), 200)
    })
    await clearField("SOLUSDT", "tp")
    await check("clearing hands the cell back to the exchange value", async () => {
      assert.match(await cellText("SOLUSDT", "tp"), /200/)
      assert.equal(await isOverridden("SOLUSDT", "tp"), false)
    })
    await check("clearing the only override deletes the row", async () => {
      assert.equal(await storedRow("ov-3"), undefined)
    })

    console.log("\nclearing one field of several")
    await clearField("ETHUSDT", "bias")
    await check("clearing a bias falls back to the derived one", async () => {
      assert.match(await cellText("ETHUSDT", "bias"), /buy/i, "should fall back to side=long")
      assert.equal(await isOverridden("ETHUSDT", "bias"), false)
    })
    await clearField("BTCUSDT", "sl")
    await check("clearing one field leaves the others on the row", async () => {
      const row = await storedRow("ov-1")
      assert.equal(row.sl, null)
      assert.equal(Number(row.tp), 72500)
      assert.equal(row.bias, "sell")
    })

    console.log("\nvalidation")
    await check("a negative price is refused before it reaches the DB", async () => {
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", tp: -5,
      })
      assert.match(res.error ?? "", /non-negative/)
      assert.equal(Number((await storedRow("ov-1")).tp), 72500, "the stored value changed")
    })
    await check("a bias outside buy/sell is refused", async () => {
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", bias: "long",
      })
      assert.match(res.error ?? "", /buy, sell or null/)
    })
    await check("a patch only touches the field it carries", async () => {
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", sl: 60000,
      })
      const row = await storedRow("ov-1")
      assert.equal(Number(row.sl), 60000)
      assert.equal(Number(row.tp), 72500, "tp was clobbered by an sl-only patch")
      assert.equal(row.bias, "sell", "bias was clobbered by an sl-only patch")
      // Put the row back the way the UI left it for the checks below.
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", sl: null,
      })
    })

    // At this point: ov-1 (OKX) has a manual bias of sell, ov-2 (Bybit) has none
    // stored but arrived side=long, and ov-3 (OKX) has neither.
    console.log("\nLvsS counts the manual bias")
    const lvs = await context.newPage()
    lvs.on("pageerror", (e) => pageErrors.push(`[lvs] ${e.stack ?? String(e)}`))
    await lvs.goto(`${BASE}/lvs`, { waitUntil: "networkidle" })
    // The manual note only renders once the overrides map has landed, so waiting
    // on it means the cards below are settled rather than mid-fetch.
    await lvs.waitForSelector('[data-testid="lvs-manual-note"]')
    await lvs.screenshot({ path: `${SHOTS}/o5-lvs.png`, fullPage: true })

    const lvsCount = async (side) =>
      Number(await lvs.locator(`[data-testid="lvs-${side}-count"]`).innerText())

    await check("a hand-set bias puts the trade in a bucket", async () => {
      // ov-1 is on OKX, which reports no side at all — without the override it
      // would sit in the excluded pile, as it did before this feature.
      assert.equal(await lvsCount("short"), 1)
      assert.match(await lvs.locator('[data-testid="lvs-short"]').innerText(), /\+\$100/)
    })
    await check("an exchange-reported side still counts on its own", async () => {
      assert.equal(await lvsCount("long"), 1)
      assert.match(await lvs.locator('[data-testid="lvs-long"]').innerText(), /-\$50/)
    })
    // The Long bucket here holds one losing trade and the Short bucket one
    // winning trade, so "best" is a loss and "worst" is a profit — exactly the
    // two cases the hardcoded +/green and bare/red used to render wrong.
    await check("a bucket whose best trade is a loss does not render +-$50.00", async () => {
      const best = lvs.locator('[data-testid="lvs-long-best"]')
      assert.equal((await best.innerText()).trim(), "-$50.00")
      const cls = await best.getAttribute("class")
      assert.match(cls, /text-red-500/, `a losing best trade rendered green: ${cls}`)
    })
    await check("a bucket whose worst trade is a profit keeps its + and green", async () => {
      const worst = lvs.locator('[data-testid="lvs-short-worst"]')
      assert.equal((await worst.innerText()).trim(), "+$100.00")
      const cls = await worst.getAttribute("class")
      assert.match(cls, /text-emerald-500/, `a winning worst trade rendered red: ${cls}`)
    })
    await check("a genuinely winning best trade still reads as a gain", async () => {
      assert.equal((await lvs.locator('[data-testid="lvs-short-best"]').innerText()).trim(), "+$100.00")
    })

    await check("the manual note reports how many came from a hand-set bias", async () => {
      const note = await lvs.locator('[data-testid="lvs-manual-note"]').innerText()
      assert.match(note, /1 trade/, note)
    })
    await check("the notice names the exchange that does not report long/short", async () => {
      const note = await lvs.locator('[data-testid="lvs-unknown-note"]').innerText()
      assert.match(note, /OKX/, note)
      assert.match(note, /does not report/, note)
      assert.match(note, /only a Bias you set by hand is counted/, note)
      // Bybit does report one, so it must not be named as an exchange that does not.
      assert.equal(
        /Bybit does not report|Bybit, OKX do not report|OKX, Bybit do not report/.test(note),
        false,
        `Bybit was wrongly named as not reporting a side: ${note}`
      )
    })
    await check("the notice says how many trades still have no bias", async () => {
      const note = await lvs.locator('[data-testid="lvs-unknown-note"]').innerText()
      assert.match(note, /1 trade has no bias yet/, note)
      // OKX is already named as the exchange that reports nothing, so repeating
      // it as the source of the unbiased trade would just be noise.
      assert.equal((note.match(/OKX/g) ?? []).length, 1, `OKX named twice: ${note}`)
    })

    console.log("\nfilling the last bias empties the excluded pile")
    await post("/api/trades/overrides", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-3", bias: "buy",
    })
    const lvs2 = await context.newPage()
    lvs2.on("pageerror", (e) => pageErrors.push(`[lvs2] ${e.stack ?? String(e)}`))
    await lvs2.goto(`${BASE}/lvs`, { waitUntil: "networkidle" })
    await lvs2.waitForSelector('[data-testid="lvs-manual-note"]')

    await check("the newly biased trade joins its bucket", async () => {
      const long = Number(await lvs2.locator('[data-testid="lvs-long-count"]').innerText())
      assert.equal(long, 2, "ov-3 should have joined the long bucket")
      // -50 (ov-2) + 25 (ov-3) = -25
      assert.match(await lvs2.locator('[data-testid="lvs-long"]').innerText(), /-\$25/)
    })
    await check("the excluded-trades notice disappears once nothing is unbiased", async () => {
      assert.equal(await lvs2.locator('[data-testid="lvs-unknown-note"]').count(), 0)
    })
    await check("the manual note still explains that two counts are hand-set", async () => {
      assert.match(await lvs2.locator('[data-testid="lvs-manual-note"]').innerText(), /2 trades/)
    })
    await lvs2.screenshot({ path: `${SHOTS}/o6-lvs-complete.png`, fullPage: true })
    await lvs.close()
    await lvs2.close()

    // Put ov-3 back the way the dashboard checks below expect it.
    await post("/api/trades/overrides", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-3", bias: null,
    })

    // NOTE ON ORDER: the cold-load check must run BEFORE the export block —
    // once a download has fired in this context Chromium does not hydrate the
    // next page opened in it. Same harness artifact as journal.ui.mjs.
    console.log("\npersistence")
    // Cold-load in a new tab rather than reloading: an in-page reload races with
    // the wallet SDK's own navigation and gets ERR_ABORTED.
    const fresh = await context.newPage()
    fresh.on("pageerror", (e) => pageErrors.push(`[fresh] ${e.stack ?? String(e)}`))
    await fresh.goto(BASE, { waitUntil: "networkidle" })
    await fresh.waitForSelector('[data-testid="bias-cell"]')
    await fresh.screenshot({ path: `${SHOTS}/o4-fresh-load.png`, fullPage: true })

    await check("overrides survive a fresh load of the app", async () => {
      assert.match(await cellText("BTCUSDT", "tp", fresh), /72,500/)
      assert.equal(await isOverridden("BTCUSDT", "tp", fresh), true)
      assert.match(await cellText("BTCUSDT", "bias", fresh), /sell/i)
      // The one we cleared must come back cleared.
      assert.equal((await cellText("BTCUSDT", "sl", fresh)).trim(), "—")
      assert.equal(await isOverridden("BTCUSDT", "sl", fresh), false)
    })
    await check("a cleared override still reads from the exchange after a reload", async () => {
      assert.match(await cellText("SOLUSDT", "tp", fresh), /200/)
      assert.match(await cellText("ETHUSDT", "bias", fresh), /buy/i)
    })
    await fresh.close()

    console.log("\nexport")
    const download = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-testid="export-trades"]').click(),
    ]).then(([d]) => d)
    const csv = await download.createReadStream().then(async (s) => {
      let out = ""
      for await (const chunk of s) out += chunk
      return out
    })

    const records = csv.replace(/^﻿/, "").trim().split("\r\n")
    const header = records[0].split(",")
    const rowFields = (ticker) =>
      records.slice(1).map((r) => r.split(",")).find((f) => f[header.indexOf("ticker")] === ticker)

    await check("the csv gained a bias column next to side", async () => {
      assert.ok(header.includes("bias"), records[0])
      assert.equal(header.indexOf("bias"), header.indexOf("side") + 1)
    })
    await check("the csv exports the overridden numbers, not the exchange's", async () => {
      const btc = rowFields("BTCUSDT")
      assert.equal(btc[header.indexOf("tp")], "72500")
      assert.equal(btc[header.indexOf("sl")], "")
      assert.equal(btc[header.indexOf("bias")], "sell")
    })
    await check("a derived bias is exported, with side left as the exchange sent it", async () => {
      const eth = rowFields("ETHUSDT")
      assert.equal(eth[header.indexOf("bias")], "buy")
      assert.equal(eth[header.indexOf("side")], "long")
    })
    await check("the app is still usable after exporting", async () => {
      await setPrice("ETHUSDT", "sl", 1500)
      assert.match(await cellText("ETHUSDT", "sl"), /1,500/)
    })

    console.log("\nisolation")
    await check("a share link never exposes an override", async () => {
      // Overrides are the user's own annotations. The share page renders
      // TradesTable without them, but the payload must not carry them either.
      const token = "bb".repeat(24)
      await sql`
        UPDATE users SET share_token = ${token}
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
      `
      const res = await fetch(`${BASE}/api/share/${token}`)
      const payload = JSON.stringify(await res.json())
      assert.ok(payload.includes("BTCUSDT"), "share payload should still carry trades")
      assert.equal(payload.includes("72500"), false, "share payload leaked an override")
    })

    console.log("\nhygiene")
    await check("no uncaught JS errors in the browser", () => {
      assert.deepEqual(pageErrors, [])
    })
    await check("no failing app requests", () => {
      const appFailures = netIssues.filter((n) => n.includes("localhost") && !n.includes("ERR_ABORTED"))
      assert.deepEqual(appFailures, [])
    })
  } catch (err) {
    await page.screenshot({ path: `${SHOTS}/o-failure.png`, fullPage: true }).catch(() => {})
    console.error("\nbrowser errors:", pageErrors)
    console.error("network issues:", netIssues)
    console.error("rows in DOM:", await page.locator("tbody tr").count().catch(() => "?"))
    console.error("bias cells in DOM:", await page.locator('[data-testid="bias-cell"]').count().catch(() => "?"))
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
