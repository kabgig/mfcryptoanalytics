/**
 * Headless UI test for the stale-snapshot race on the dashboard.
 *
 * HomeView loads its notes and overrides maps once on mount. Every save in
 * between is optimistic and per-key, so a response still in flight when the
 * user saves used to replace the whole map and silently undo a write that had
 * already reached Postgres — the row reverted on screen and exported blank.
 *
 * In the wild the window is opened by a cold serverless start; locally it was
 * `next dev` compiling /api/trades/overrides, measured at 9.7s inside a 12.3s
 * request. That is why it surfaced as an intermittent failure of
 * test:ui:overrides (2 of 3 cold starts) rather than a reproducible one.
 *
 * This test does not wait for luck: it intercepts the two mount GETs, lets the
 * server answer immediately so the body is genuinely the pre-edit snapshot, and
 * then holds that body back until after the edits have been made.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block.
 *
 *   npm run dev              # in another terminal
 *   npm run test:ui:stale
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
// …006: distinct from every other UI script, each of which tears down its own
// user and would take this one's rows with it through the FK cascade.
const TEST_TELEGRAM_ID = "990000000006"
const EXCHANGE = "OKX"

const sql = neon(process.env.DATABASE_URL)

const TRADES = [
  { id: "sn-1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1, tp: null, sl: null, pnl: 100,
    openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z" },
  { id: "sn-2", exchange: EXCHANGE, ticker: "ETHUSDT", positionSize: 2, tp: null, sl: null, pnl: -50,
    openTime: "2026-08-02T00:00:00.000Z", closeTime: "2026-08-03T00:00:00.000Z" },
]

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

let cookie = ""
const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  }).then((r) => r.json())

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM public.trade_overrides WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.trade_notes     WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.cached_trades   WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.user_sessions
              WHERE user_id IN (SELECT id FROM public.users WHERE telegram_id = ${tid})`
  await sql`DELETE FROM public.users           WHERE telegram_id = ${tid}`
}

const storedRow = async (id) => {
  const rows = await sql`
    SELECT * FROM public.trade_overrides
    WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = ${id}`
  return rows[0]
}

async function main() {
  await teardown()
  cookie = await signIn(BASE, TEST_TELEGRAM_ID, "ui-test")
  await post("/api/trades-store", { exchange: EXCHANGE, trades: TRADES })
  console.log(`\nsetup: seeded ${TRADES.length} trades for synthetic user ${TEST_TELEGRAM_ID}`)

  // sn-2 is written before the browser ever starts, so it is in every snapshot
  // the page fetches. It is the control: proof the merge still applies the
  // server's data to the keys the user has not touched.
  await post("/api/trades/overrides", { exchange: EXCHANGE, id: "sn-2", bias: "sell" })

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

  /**
   * Holds the mount GETs of the two maps back until `release` resolves.
   *
   * route.fetch() first, deliberately: the server answers at intercept time, so
   * the body captured really is the state before the edits below. Delaying
   * route.continue() instead would send the request *after* the edits and get a
   * fresh, harmless response — the first version of this probe made exactly
   * that mistake and reported no bug.
   */
  async function holdSnapshots(page, release) {
    const captured = []
    await page.route("**/api/trades/{overrides,notes,deleted}", async (route) => {
      // /deleted is a POST — it takes a body — so it is matched by path, not
      // by verb, unlike the two GET loaders.
      const isLoader =
        route.request().method() === "GET" ||
        new URL(route.request().url()).pathname === "/api/trades/deleted"
      if (!isLoader) return route.continue()
      const res = await route.fetch()
      const body = await res.text()
      captured.push(body)
      await release
      return route.fulfill({ response: res, body })
    })
    return captured
  }

  const rowFor = (p, ticker) => p.locator("tbody tr").filter({ hasText: ticker })
  const journalIcon = (p, ticker) => rowFor(p, ticker).locator('[data-testid="journal-open"]')
  const biasCell = (p, ticker) => rowFor(p, ticker).locator('[data-testid="bias-cell"]')

  async function saveJournal(p, ticker, strategy) {
    await journalIcon(p, ticker).click()
    await p.waitForSelector('[data-testid="journal-form"]')
    await p.locator('[data-testid="journal-strategy"]').selectOption(strategy)
    const responded = p.waitForResponse(
      (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
    )
    await p.locator('[data-testid="journal-save"]').click()
    assert.equal((await responded).status(), 200, "journal save did not return 200")
    await p.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
  }

  async function saveNote(p, ticker, phase, text) {
    await rowFor(p, ticker).locator(`[data-testid="note-${phase}"]`).click()
    await p.waitForSelector('[data-testid="note-popup"]')
    await p.locator('[data-testid="note-textarea"]').fill(text)
    const responded = p.waitForResponse(
      (r) => r.url().includes("/api/trades/notes") && r.request().method() === "POST"
    )
    await p.locator('[data-testid="note-save"]').click()
    assert.equal((await responded).status(), 200, "note save did not return 200")
    await p.waitForSelector('[data-testid="note-popup"]', { state: "detached" })
  }

  async function csvRow(p, ticker) {
    const dl = await Promise.all([
      p.waitForEvent("download"),
      p.locator('[data-testid="export-trades"]').click(),
    ]).then(([d]) => d)
    let csv = ""
    for await (const chunk of await dl.createReadStream()) csv += chunk
    const records = csv.replace(/^﻿/, "").trim().split("\r\n")
    const header = records[0].split(",")
    const fields = records.slice(1)
      .map((r) => r.split(","))
      .find((f) => f[header.indexOf("ticker")] === ticker)
    assert.ok(fields, `no ${ticker} row in the export`)
    return (column) => fields[header.indexOf(column)]
  }

  try {
    // --- 1. a write made while the snapshot is in flight ---------------------
    console.log("\na write that races the mount fetch")
    let releaseFirst
    const first = await context.newPage()
    const captured = await holdSnapshots(first, new Promise((r) => { releaseFirst = r }))
    await signInBrowser(first, BASE, TEST_TELEGRAM_ID, "ui-test")
    const errors = []
    first.on("pageerror", (e) => errors.push(e.stack ?? String(e)))

    await gotoApp(first, BASE)
    await first.waitForSelector('[data-testid="bias-cell"]')

    await saveJournal(first, "BTCUSDT", "orderflow")
    await saveNote(first, "BTCUSDT", "before", "planned the entry")

    await check("the write reached the database before the snapshot landed", async () => {
      assert.equal((await storedRow("sn-1")).strategy, "orderflow")
    })

    // Let the pre-edit snapshot through, and give React time to apply it.
    releaseFirst()
    await first.waitForTimeout(2500)

    await check("both held responses really were the pre-edit snapshot", async () => {
      // If this fails the test is not exercising the race at all.
      assert.equal(captured.length >= 2, true, `captured ${captured.length} snapshots`)
      assert.equal(
        captured.some((b) => b.includes("orderflow")), false,
        "a captured snapshot already contained the edit"
      )
    })
    await check("a journal entry survives the stale snapshot", async () => {
      assert.equal(await journalIcon(first, "BTCUSDT").getAttribute("data-filled"), "true")
    })
    await check("the note survives the stale snapshot", async () => {
      assert.equal(
        await rowFor(first, "BTCUSDT").locator('[data-testid="note-before"]').getAttribute("data-filled"),
        "true"
      )
    })
    await check("the export carries the journal entry, not a blank cell", async () => {
      const btc = await csvRow(first, "BTCUSDT")
      assert.equal(btc("strategy"), "orderflow")
      assert.equal(btc("noteBefore"), "planned the entry")
    })
    await check("an untouched trade still takes its value from the snapshot", async () => {
      // The merge must not turn into "ignore the server" — sn-2 was never
      // edited in the browser, so the snapshot is the only source it has.
      assert.match(await biasCell(first, "ETHUSDT").innerText(), /sell/i)
    })
    await check("nothing threw in the page", async () => {
      assert.deepEqual(errors, [])
    })
    await first.close()

    // --- 2. a clear made while the snapshot is in flight ---------------------
    // The case a plain { ...server, ...local } spread gets wrong: a cleared
    // entry is absent from local state, so a stale server copy would revive it.
    console.log("\na clear that races the mount fetch")
    let releaseSecond
    const second = await context.newPage()
    const captured2 = await holdSnapshots(second, new Promise((r) => { releaseSecond = r }))
    await gotoApp(second, BASE)
    await second.waitForSelector('[data-testid="bias-cell"]')

    await check("the snapshot this page is holding still contains the entry", async () => {
      assert.equal(captured2.some((b) => b.includes("orderflow")), true)
    })

    // Clearing the only field set on sn-1 deletes the row outright.
    await saveJournal(second, "BTCUSDT", "")
    await check("the clear reached the database", async () => {
      assert.equal(await storedRow("sn-1"), undefined)
    })

    releaseSecond()
    await second.waitForTimeout(2500)

    await check("a cleared journal is not resurrected by the stale snapshot", async () => {
      assert.equal(await journalIcon(second, "BTCUSDT").getAttribute("data-filled"), "false")
    })
    await check("the export shows the cleared entry as blank", async () => {
      const btc = await csvRow(second, "BTCUSDT")
      assert.equal(btc("strategy"), "")
    })
    await check("the untouched trade is still there after a clear", async () => {
      assert.match(await biasCell(second, "ETHUSDT").innerText(), /sell/i)
    })
    await second.close()

    // --- 3. a delete that races the soft-deleted list -----------------------
    // deletedTrades is the list form of the same race: the loader replaces it
    // wholesale, while handleDelete adds to it optimistically. The delete
    // button renders as soon as the main table does, which is routinely before
    // /api/trades/deleted answers.
    console.log("\na delete that races the mount fetch")
    let releaseThird
    const third = await context.newPage()
    await holdSnapshots(third, new Promise((r) => { releaseThird = r }))
    await gotoApp(third, BASE)
    await third.waitForSelector('[data-testid="bias-cell"]')

    const deleted = third.waitForResponse(
      (r) => r.url().includes("/api/trades/delete") && r.request().method() === "POST"
    )
    await rowFor(third, "ETHUSDT").locator('[data-testid="delete-trade"]').click()
    assert.equal((await deleted).status(), 200, "delete did not return 200")

    await check("the delete reached the database", async () => {
      const rows = await sql`
        SELECT deleted_at FROM public.cached_trades
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND id = 'sn-2'`
      assert.notEqual(rows[0].deleted_at, null)
    })

    releaseThird()
    await third.waitForTimeout(2500)

    await check("the deleted trade is still counted after the stale snapshot", async () => {
      assert.match(
        await third.locator('[data-testid="toggle-deleted"]').innerText(),
        /Show deleted \(1\)/
      )
    })
    await check("the row itself is still gone from the table", async () => {
      assert.equal(await third.locator('tr:has-text("ETHUSDT")').count(), 0)
    })
    await third.close()

    console.log(`\n✓ ${passed} checks passed`)
  } finally {
    await browser.close().catch(() => {})
    await teardown()
    console.log("teardown: synthetic user removed")
  }
}

main().catch((err) => {
  console.error("\n✗ UI test failed:\n", err)
  process.exit(1)
})
