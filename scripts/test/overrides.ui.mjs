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
    SELECT bias, entry, tp1, tp2, sl, risk_pct, rr, rules_ok,
           strategy, timeframe, killzone, exit_reason, mistake, emotion
    FROM trade_overrides
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
   * Opens the Bias cell's editor, acts, and waits for the POST to land. The UI
   * updates optimistically, so waiting on the DOM alone would let a later reload
   * abort the in-flight write and silently lose the value.
   */
  async function editBias(ticker, act) {
    await cell(ticker, "bias").click()
    await page.waitForSelector('[data-testid="override-popup"]')
    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
    )
    await act()
    const res = await responded
    assert.equal(res.status(), 200, `override save returned ${res.status()}`)
    await page.waitForSelector('[data-testid="override-popup"]', { state: "detached" })
  }

  const setBias = (ticker, bias) =>
    editBias(ticker, () => page.locator(`[data-testid="bias-${bias}"]`).click())

  const clearBias = (ticker) =>
    editBias(ticker, () => page.locator('[data-testid="override-clear"]').click())

  // --- the 📋 journal form ---------------------------------------------------
  const journalIcon = (ticker, p = page) =>
    p.locator("tbody tr").filter({ hasText: ticker }).locator('[data-testid="journal-open"]')

  async function openJournal(ticker, p = page) {
    await journalIcon(ticker, p).click()
    await p.waitForSelector('[data-testid="journal-form"]')
  }

  /**
   * Sets a multi-select field to exactly the given tags by toggling only the
   * boxes that disagree — the form has no "clear all", so reaching a target
   * selection means reading what is ticked first.
   */
  async function setTags(field, wanted) {
    const boxes = page.locator(`[data-testid^="journal-${field}-"] input[type="checkbox"]`)
    const n = await boxes.count()
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i)
      const option = await box.evaluate((el) =>
        el.closest("label").getAttribute("data-testid").split("-").slice(2).join("-")
      )
      const shouldBe = wanted.includes(option)
      if ((await box.isChecked()) !== shouldBe) await box.click()
    }
  }

  /**
   * Fills the given fields and saves, waiting for the write to land.
   * An array value means a multi-select field; anything else is a select/input.
   */
  async function fillJournal(ticker, fields) {
    await openJournal(ticker)
    for (const [field, value] of Object.entries(fields)) {
      if (Array.isArray(value)) { await setTags(field, value); continue }
      const el = page.locator(`[data-testid="journal-${field}"]`)
      if ((await el.evaluate((n) => n.tagName)) === "SELECT") await el.selectOption(String(value))
      else await el.fill(String(value))
    }
    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
    )
    await page.locator('[data-testid="journal-save"]').click()
    const res = await responded
    assert.equal(res.status(), 200, `journal save returned ${res.status()}`)
    await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
  }

  /**
   * A field's current value. A checkbox group is a <fieldset>, which has no
   * inputValue(), so it publishes its '|'-joined selection as data-value —
   * the same string the column stores.
   */
  const journalValue = async (field, p = page) => {
    const el = p.locator(`[data-testid="journal-${field}"]`)
    const tag = await el.evaluate((n) => n.tagName)
    return tag === "FIELDSET" ? (await el.getAttribute("data-value")) ?? "" : el.inputValue()
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="bias-cell"]')
    await page.screenshot({ path: `${SHOTS}/o1-initial.png`, fullPage: true })

    console.log("\ninitial render")
    await check("every row has a Bias cell and a journal button", async () => {
      assert.equal(await page.locator('[data-testid="bias-cell"]').count(), TRADES.length)
      assert.equal(await page.locator('[data-testid="journal-open"]').count(), TRADES.length)
    })
    await check("the TP and SL columns are gone from the table", async () => {
      // They moved into the 📋 form when TP grew into TP1/TP2.
      const headers = await page.locator("thead th").allInnerTexts()
      assert.equal(headers.includes("TP"), false, headers.join("|"))
      assert.equal(headers.includes("SL"), false, headers.join("|"))
      assert.ok(headers.includes("Bias"), headers.join("|"))
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
    await check("no row starts out marked as having a journal entry", async () => {
      for (const t of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
        assert.equal(await journalIcon(t).getAttribute("data-filled"), "false", t)
      }
    })

    console.log("\nthe journal form")
    await openJournal("BTCUSDT")
    await page.screenshot({ path: `${SHOTS}/o2-journal-form.png`, fullPage: true })
    await check("the form opens empty for a trade with no entry", async () => {
      for (const f of ["entry", "tp1", "tp2", "sl", "riskPct", "rr"]) {
        assert.equal(await journalValue(f), "", `${f} should start empty`)
      }
      for (const f of ["strategy", "timeframe", "killzone", "rulesOK", "exitReason", "mistake", "emotion"]) {
        assert.equal(await journalValue(f), "", `${f} should start unselected`)
      }
      // Nothing pre-ticked in any of the three checkbox groups.
      assert.equal(
        await page.locator('[data-testid="journal-form"] input[type="checkbox"]:checked').count(),
        0
      )
    })
    await check("R:R says what it needs before any levels are typed", async () => {
      assert.match(await page.locator('[data-testid="journal-rr-readout"]').innerText(), /needs an entry/)
    })
    await check("R:R computes itself as the levels are typed", async () => {
      await page.locator('[data-testid="journal-entry"]').fill("100")
      await page.locator('[data-testid="journal-tp1"]').fill("120")
      await page.locator('[data-testid="journal-sl"]').fill("90")
      // 20 of reward against 10 of risk.
      assert.match(await page.locator('[data-testid="journal-rr-readout"]').innerText(), /R:R 2 from your levels/)
    })
    await check("a hand-typed R:R takes over and says so", async () => {
      await page.locator('[data-testid="journal-rr"]').fill("1.5")
      assert.match(
        await page.locator('[data-testid="journal-rr-readout"]').innerText(),
        /Computed R:R is 2 — clear the field to use it/
      )
      await page.locator('[data-testid="journal-rr"]').fill("")
    })
    await page.keyboard.press("Escape").catch(() => {})
    await page.locator('[data-testid="journal-form"]').evaluate(() => {})
    // Close without saving, so the next block starts from a clean row.
    await page.locator('button[aria-label="Close journal"]').click()
    await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    await check("closing without saving stores nothing", async () => {
      assert.equal(await storedRow("ov-1"), undefined)
    })

    console.log("\nfilling a full journal entry")
    await fillJournal("BTCUSDT", {
      strategy: "orderflow", timeframe: "15m", killzone: "london",
      entry: 100, tp1: 120, tp2: 140, sl: 90, riskPct: 1.5,
      rulesOK: "yes",
      // Several tags each: scaled out at TP1 then stopped out of the runner,
      // two things wrong with the trade, two feelings during it.
      exitReason: ["tp1", "sl"],
      mistake: ["no_stop", "chased_price"],
      emotion: ["fear", "greed"],
    })
    await page.screenshot({ path: `${SHOTS}/o3-journal-filled.png`, fullPage: true })

    await check("the icon marks the trade as journalled", async () => {
      assert.equal(await journalIcon("BTCUSDT").getAttribute("data-filled"), "true")
    })
    await check("every field landed on one row in the database", async () => {
      const row = await storedRow("ov-1")
      assert.equal(row.strategy, "orderflow")
      assert.equal(row.timeframe, "15m")
      assert.equal(row.killzone, "london")
      assert.equal(Number(row.entry), 100)
      assert.equal(Number(row.tp1), 120)
      assert.equal(Number(row.tp2), 140)
      assert.equal(Number(row.sl), 90)
      assert.equal(Number(row.risk_pct), 1.5)
      assert.equal(row.rules_ok, true)
      // The three multi-valued fields land '|'-joined in their one column, in
      // vocabulary order rather than the order the boxes were ticked.
      assert.equal(row.exit_reason, "tp1|sl")
      assert.equal(row.mistake, "no_stop|chased_price")
      assert.equal(row.emotion, "fear|greed")
    })
    await check("an auto-computed R:R is not written to the row", async () => {
      // rr is only stored when the user overrides the arithmetic.
      assert.equal((await storedRow("ov-1")).rr, null)
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
    await check("nothing bled onto the other rows", async () => {
      assert.equal(await journalIcon("ETHUSDT").getAttribute("data-filled"), "false")
      assert.equal(await storedRow("ov-2"), undefined)
    })

    console.log("\nreopening and editing")
    await openJournal("BTCUSDT")
    await check("reopening loads every stored value back into the form", async () => {
      assert.equal(await journalValue("strategy"), "orderflow")
      assert.equal(await journalValue("entry"), "100")
      assert.equal(await journalValue("tp2"), "140")
      assert.equal(await journalValue("riskPct"), "1.5")
      assert.equal(await journalValue("rulesOK"), "yes")
      assert.equal(await journalValue("exitReason"), "tp1|sl")
      assert.equal(await journalValue("mistake"), "no_stop|chased_price")
      assert.equal(await journalValue("emotion"), "fear|greed")
    })
    await check("every tag the user ticked comes back ticked", async () => {
      for (const [field, options] of [
        ["exitReason", ["tp1", "sl"]],
        ["mistake", ["no_stop", "chased_price"]],
        ["emotion", ["fear", "greed"]],
      ]) {
        for (const o of options) {
          assert.equal(
            await page.locator(`[data-testid="journal-${field}-${o}"] input`).isChecked(),
            true, `${field}/${o} should be ticked`
          )
        }
      }
      // And one that was not ticked is not.
      assert.equal(
        await page.locator('[data-testid="journal-mistake-traded_the_news"] input').isChecked(),
        false
      )
    })
    await check("the reopened form recomputes R:R from the stored levels", async () => {
      assert.match(await page.locator('[data-testid="journal-rr-readout"]').innerText(), /R:R 2 /)
    })
    await page.locator('button[aria-label="Close journal"]').click()
    await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })

    await fillJournal("BTCUSDT", { emotion: ["fear"], rr: 3 })
    await check("editing replaces values rather than adding a second row", async () => {
      const rows = await sql`
        SELECT emotion, rr, strategy FROM trade_overrides
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'ov-1'
      `
      assert.equal(rows.length, 1)
      assert.equal(rows[0].emotion, "fear", "unticking greed should leave fear alone")
      assert.equal(Number(rows[0].rr), 3, "the hand-typed R:R should be stored")
      assert.equal(rows[0].strategy, "orderflow", "an untouched field was clobbered")
    })

    console.log("\nthe two break-even mistakes")
    await fillJournal("SOLUSDT", { mistake: ["moved_sl_away_from_be"] })
    await check("moving the stop off break-even is its own tag", async () => {
      assert.equal((await storedRow("ov-3")).mistake, "moved_sl_away_from_be")
    })
    await check("the checkbox list offers it under a readable label", async () => {
      await journalIcon("SOLUSDT").click()
      await page.waitForSelector('[data-testid="journal-form"]')
      const labels = await page
        .locator('[data-testid="journal-mistake"] label')
        .allInnerTexts()
      assert.ok(
        labels.includes("Moved SL away from break-even"),
        `label missing from the list: ${labels.join(" | ")}`
      )
      // The opposite failure must still be offered separately.
      assert.ok(labels.includes("Did not move to break-even"), labels.join(" | "))
      await page.locator('button[aria-label="Close journal"]').click()
      await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    })
    await check("a long mistake label wraps instead of overlapping its neighbour", async () => {
      // This modal renders from inside a table cell that sets whitespace-nowrap,
      // and the rule inherits through the fixed-position overlay — so the
      // longest labels used to run over the next column's checkbox.
      await journalIcon("SOLUSDT").click()
      await page.waitForSelector('[data-testid="journal-form"]')
      const box = await page
        .locator('[data-testid="journal-mistake-entered_against_liquidity"]')
        .evaluate((el) => {
          const span = el.querySelector("span")
          return {
            wrap: getComputedStyle(span).whiteSpace,
            overflow: span.getBoundingClientRect().right - el.getBoundingClientRect().right,
          }
        })
      assert.equal(box.wrap, "normal", "the label inherited whitespace-nowrap")
      assert.ok(box.overflow <= 1, `the label overflows its column by ${box.overflow}px`)
      await page.locator('button[aria-label="Close journal"]').click()
      await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    })
    await check("the removed 'No mistake' tag is gone from the list", async () => {
      await journalIcon("SOLUSDT").click()
      await page.waitForSelector('[data-testid="journal-form"]')
      const labels = await page
        .locator('[data-testid="journal-mistake"] label')
        .allInnerTexts()
      assert.equal(labels.includes("No mistake"), false, labels.join(" | "))
      assert.equal(await page.locator('[data-testid="journal-mistake-none"]').count(), 0)
      // Fifteen real mistakes remain, all of them tickable.
      assert.equal(labels.length, 15, labels.join(" | "))
      await page.locator('button[aria-label="Close journal"]').click()
      await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    })

    console.log("\nticking and unticking")
    await fillJournal("SOLUSDT", { mistake: ["moved_sl_away_from_be", "traded_the_news"] })
    await check("adding a second tag keeps the first", async () => {
      // Stored in vocabulary order, not the order they were ticked.
      assert.equal((await storedRow("ov-3")).mistake, "moved_sl_away_from_be|traded_the_news")
    })
    await fillJournal("SOLUSDT", { mistake: ["traded_the_news"] })
    await check("unticking one tag leaves the other", async () => {
      assert.equal((await storedRow("ov-3")).mistake, "traded_the_news")
      assert.equal(await journalIcon("SOLUSDT").getAttribute("data-filled"), "true")
    })

    console.log("\nclearing")
    await fillJournal("SOLUSDT", { mistake: [] })
    await check("unticking every box deletes the row entirely", async () => {
      // An empty selection is unset, not an empty value: the row goes, exactly
      // as clearing the last single-valued field always did.
      assert.equal(await storedRow("ov-3"), undefined)
      assert.equal(await journalIcon("SOLUSDT").getAttribute("data-filled"), "false")
    })

    console.log("\nbias stays its own column")
    await setBias("BTCUSDT", "sell")
    await check("a manually set bias shows and is marked", async () => {
      assert.match(await cellText("BTCUSDT", "bias"), /sell/i)
      assert.equal(await isOverridden("BTCUSDT", "bias"), true)
      assert.equal((await storedRow("ov-1")).bias, "sell")
    })
    await check("setting a bias leaves the journal fields alone", async () => {
      const row = await storedRow("ov-1")
      assert.equal(row.strategy, "orderflow")
      assert.equal(Number(row.entry), 100)
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
    await clearBias("ETHUSDT")
    await check("clearing a bias falls back to the derived one", async () => {
      assert.match(await cellText("ETHUSDT", "bias"), /buy/i, "should fall back to side=long")
      assert.equal(await isOverridden("ETHUSDT", "bias"), false)
      assert.equal(await storedRow("ov-2"), undefined, "the emptied row should be gone")
    })

    console.log("\nvalidation")
    await check("a negative price is refused before it reaches the DB", async () => {
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", tp1: -5,
      })
      assert.match(res.error ?? "", /at least 0/)
      assert.equal(Number((await storedRow("ov-1")).tp1), 120, "the stored value changed")
    })
    await check("a risk % above 100 is refused", async () => {
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", riskPct: 150,
      })
      assert.match(res.error ?? "", /between 0 and 100/)
    })
    await check("a value outside a single-choice list is refused", async () => {
      for (const [field, bad] of [["strategy", "scalping"], ["killzone", "tokyo"]]) {
        const res = await post("/api/trades/overrides", {
          telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", [field]: bad,
        })
        assert.match(res.error ?? "", new RegExp(`${field} must be one of`), `${field} accepted ${bad}`)
      }
    })
    await check("a bad tag anywhere in a multi-select list is refused", async () => {
      // One unknown tag rejects the whole request rather than being quietly
      // dropped, so a buggy caller finds out.
      for (const [field, bad] of [
        ["emotion", ["furious"]],
        ["emotion", ["calm", "furious"]],
        ["mistake", ["none"]],
        ["exitReason", ["tp1", "tp3"]],
      ]) {
        const res = await post("/api/trades/overrides", {
          telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", [field]: bad,
        })
        assert.match(
          res.error ?? "", new RegExp(`${field} must be a list of`),
          `${field} accepted ${JSON.stringify(bad)}`
        )
      }
    })
    await check("a repeated tag is refused", async () => {
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", emotion: ["calm", "calm"],
      })
      assert.match(res.error ?? "", /emotion must be a list of/)
    })
    await check("a bare string is still accepted as a one-tag list", async () => {
      // A caller written against the single-valued version of this route keeps
      // working — that is what makes the API change non-breaking.
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", exitReason: "be",
      })
      assert.equal(res.ok, true, JSON.stringify(res))
      assert.deepEqual(res.override.exitReason, ["be"])
      assert.equal((await storedRow("ov-1")).exit_reason, "be")
    })
    await check("several exit reasons reach the column the CHECK used to guard", async () => {
      // The one genuinely breaking part of this change: exit_reason carried a
      // CHECK constraint that would have rejected 'tp1|sl' outright.
      const res = await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", exitReason: ["tp1", "sl"],
      })
      assert.equal(res.ok, true, JSON.stringify(res))
      assert.equal((await storedRow("ov-1")).exit_reason, "tp1|sl")
    })
    await check("an empty list clears a multi-select field", async () => {
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", exitReason: [],
      })
      assert.equal((await storedRow("ov-1")).exit_reason, null)
      // The row itself survives — it still holds a strategy, levels and a bias.
      assert.equal((await storedRow("ov-1")).strategy, "orderflow")
      // Put it back for the persistence and export checks below.
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", exitReason: ["tp1", "sl"],
      })
    })
    await check("a legacy single value in the column reads back as a one-tag list", async () => {
      // Every row written before this change holds a bare slug. Write one the
      // way the old code would have, and the app must read it as one tag.
      await sql`
        UPDATE trade_overrides SET mistake = 'chased_price'
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'ov-1'
      `
      const res = await fetch(`${BASE}/api/trades/overrides?telegramId=${TEST_TELEGRAM_ID}`)
      const { overrides } = await res.json()
      assert.deepEqual(overrides[`${EXCHANGE}|ov-1`].mistake, ["chased_price"])
    })
    await check("a value retired from the vocabulary is dropped on read", async () => {
      // 'none' no longer exists. A row still holding it must not surface it as
      // if it were an option the form could show.
      await sql`
        UPDATE trade_overrides SET mistake = 'none|chased_price'
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'ov-1'
      `
      const res = await fetch(`${BASE}/api/trades/overrides?telegramId=${TEST_TELEGRAM_ID}`)
      const { overrides } = await res.json()
      assert.deepEqual(overrides[`${EXCHANGE}|ov-1`].mistake, ["chased_price"])
      // Put the row back the way the form left it for the checks below.
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1",
        mistake: ["no_stop", "chased_price"],
      })
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
      assert.equal(Number(row.tp1), 120, "tp1 was clobbered by an sl-only patch")
      assert.equal(row.strategy, "orderflow", "strategy was clobbered by an sl-only patch")
      assert.equal(row.bias, "sell", "bias was clobbered by an sl-only patch")
      // Put the row back the way the form left it for the checks below.
      await post("/api/trades/overrides", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "ov-1", sl: 90,
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

    await check("the journal survives a fresh load of the app", async () => {
      assert.equal(await journalIcon("BTCUSDT", fresh).getAttribute("data-filled"), "true")
      await openJournal("BTCUSDT", fresh)
      assert.equal(await journalValue("strategy", fresh), "orderflow")
      assert.equal(await journalValue("timeframe", fresh), "15m")
      assert.equal(await journalValue("killzone", fresh), "london")
      assert.equal(await journalValue("entry", fresh), "100")
      assert.equal(await journalValue("tp1", fresh), "120")
      assert.equal(await journalValue("tp2", fresh), "140")
      assert.equal(await journalValue("sl", fresh), "90")
      assert.equal(await journalValue("riskPct", fresh), "1.5")
      assert.equal(await journalValue("rulesOK", fresh), "yes")
      // A multi-tag selection comes back whole, not just its first tag.
      assert.equal(await journalValue("exitReason", fresh), "tp1|sl")
      assert.equal(await journalValue("mistake", fresh), "no_stop|chased_price")
      assert.equal(await journalValue("emotion", fresh), "fear")
      // …and as ticked boxes, not just as a data attribute.
      for (const o of ["tp1", "sl"]) {
        assert.equal(
          await fresh.locator(`[data-testid="journal-exitReason-${o}"] input`).isChecked(),
          true, `exitReason/${o} should come back ticked`
        )
      }
      assert.equal(
        await fresh.locator('[data-testid="journal-exitReason-be"] input').isChecked(),
        false, "an unticked exit reason should stay unticked"
      )
      // The hand-typed R:R came back as the user's, not recomputed away.
      assert.equal(await journalValue("rr", fresh), "3")
      await fresh.locator('button[aria-label="Close journal"]').click()
      await fresh.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    })
    await check("a cleared journal stays cleared after a reload", async () => {
      assert.equal(await journalIcon("SOLUSDT", fresh).getAttribute("data-filled"), "false")
    })
    await check("a cleared bias still reads from the exchange after a reload", async () => {
      assert.match(await cellText("ETHUSDT", "bias", fresh), /buy/i)
      assert.match(await cellText("BTCUSDT", "bias", fresh), /sell/i)
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
    await check("the csv carries every journal column", async () => {
      for (const c of ["strategy","timeframe","killzone","entry","tp1","tp2","sl",
                       "riskPct","rr","rulesOK","exitReason","mistake","emotion"]) {
        assert.ok(header.includes(c), `${c} missing from: ${records[0]}`)
      }
    })
    await check("the csv exports the journal entry the form saved", async () => {
      const btc = rowFields("BTCUSDT")
      assert.equal(btc[header.indexOf("strategy")], "orderflow")
      assert.equal(btc[header.indexOf("timeframe")], "15m")
      assert.equal(btc[header.indexOf("killzone")], "london")
      assert.equal(btc[header.indexOf("entry")], "100")
      assert.equal(btc[header.indexOf("tp1")], "120")
      assert.equal(btc[header.indexOf("tp2")], "140")
      assert.equal(btc[header.indexOf("sl")], "90")
      assert.equal(btc[header.indexOf("riskPct")], "1.5")
      assert.equal(btc[header.indexOf("rr")], "3", "the hand-typed R:R should export")
      assert.equal(btc[header.indexOf("rulesOK")], "yes")
      assert.equal(btc[header.indexOf("emotion")], "fear")
      assert.equal(btc[header.indexOf("bias")], "sell")
    })
    await check("the csv writes several tags into one pipe-joined cell", async () => {
      // Split on "," above, so a comma-joined list would have shifted every
      // column after it — a pipe keeps the row one field per column.
      const btc = rowFields("BTCUSDT")
      assert.equal(btc[header.indexOf("mistake")], "no_stop|chased_price")
      assert.equal(btc[header.indexOf("exitReason")], "tp1|sl")
      assert.equal(btc.length, header.length, "a multi-tag cell split the row")
    })
    await check("no journal cell needed csv quoting", async () => {
      // The reason '|' was chosen over ',': the export pastes into a
      // spreadsheet or an LLM without anything unpicking quotes first.
      const btcRecord = records.slice(1).find((r) => r.includes("BTCUSDT"))
      assert.equal(btcRecord.includes('"'), false, btcRecord)
    })
    await check("a trade with no journal exports blank cells, not 'undefined'", async () => {
      const sol = rowFields("SOLUSDT")
      for (const c of ["strategy","entry","tp2","riskPct","rr","rulesOK",
                       "exitReason","mistake","emotion"]) {
        assert.equal(sol[header.indexOf(c)], "", `${c} should be blank`)
      }
      // tp1 is not blank here: ov-3 carries an exchange-reported tp of 200, and
      // the exchange's single take-profit falls back into TP1.
      assert.equal(sol[header.indexOf("tp1")], "200")
    })
    await check("a derived bias is exported, with side left as the exchange sent it", async () => {
      const eth = rowFields("ETHUSDT")
      assert.equal(eth[header.indexOf("bias")], "buy")
      assert.equal(eth[header.indexOf("side")], "long")
    })
    await check("the app is still usable after exporting", async () => {
      await setBias("SOLUSDT", "buy")
      assert.match(await cellText("SOLUSDT", "bias"), /buy/i)
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
      assert.equal(payload.includes("orderflow"), false, "share payload leaked a journal entry")
      assert.equal(payload.includes("london"), false, "share payload leaked a journal entry")
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
