/**
 * Headless UI test for the per-trade journal and the CSV export.
 *
 * Seeds a synthetic user through the API, drives the real dashboard in Chromium,
 * and asserts the ‹ ● › icons write, edit, clear and persist notes — then that
 * the export button produces a CSV carrying those notes.
 * Screenshots land in scripts/test/screenshots/.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one.
 *
 *   npm run dev            # in another terminal
 *   npm run test:ui:journal
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
// Distinct from softDelete.ui.mjs (…002) and spot.ui.mjs (…003): those scripts
// tear down their user, and the FK cascade would take this test's notes with it.
const TEST_TELEGRAM_ID = "990000000004"
const EXCHANGE = "OKX"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

const TRADES = [
  { id: "journal-1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1, tp: 70000, sl: null, pnl: 100,
    openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z" },
  { id: "journal-2", exchange: EXCHANGE, ticker: "ETHUSDT", positionSize: 2, tp: null, sl: null, pnl: -50,
    openTime: "2026-08-02T00:00:00.000Z", closeTime: "2026-08-03T00:00:00.000Z" },
]

// Deliberately hostile: every character the CSV writer has to escape.
const NASTY_NOTE = 'Entry at 3.5, "too big" a size\nStopped out; revenge-traded'

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
  await sql`DELETE FROM trade_notes        WHERE telegram_id = ${tid}`
  await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users              WHERE telegram_id = ${tid}`
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  await post("/api/trades-store", { telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, trades: TRADES })
  console.log(`\nsetup: seeded ${TRADES.length} trades for synthetic user ${TEST_TELEGRAM_ID}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
  const icon = (ticker, phase) => rowFor(ticker).locator(`[data-testid="note-${phase}"]`)
  const filled = async (ticker, phase) =>
    (await icon(ticker, phase).getAttribute("data-filled")) === "true"

  /**
   * Opens a phase's editor, types, saves, and waits for the POST to land.
   * The UI updates optimistically, so waiting on the DOM alone would let a
   * later reload abort the in-flight write and silently lose the note.
   */
  async function writeNote(ticker, phase, text) {
    await icon(ticker, phase).click()
    await page.waitForSelector('[data-testid="note-popup"]')
    await page.locator('[data-testid="note-textarea"]').fill(text)
    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/trades/notes") && r.request().method() === "POST"
    )
    await page.locator('[data-testid="note-save"]').click()
    const res = await responded
    assert.equal(res.status(), 200, `note save returned ${res.status()}`)
    await page.waitForSelector('[data-testid="note-popup"]', { state: "detached" })
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="note-before"]')
    await page.screenshot({ path: `${SHOTS}/j1-initial.png`, fullPage: true })

    console.log("\ninitial render")
    await check("every row shows all three journal icons", async () => {
      for (const phase of ["before", "during", "after"]) {
        assert.equal(
          await page.locator(`[data-testid="note-${phase}"]`).count(), TRADES.length,
          `expected one ${phase} icon per row`
        )
      }
    })
    await check("icons are visible without hovering", async () => {
      assert.ok(await icon("BTCUSDT", "before").isVisible())
    })
    await check("no icon starts out marked as having a note", async () => {
      for (const phase of ["before", "during", "after"]) {
        assert.equal(await filled("BTCUSDT", phase), false, `${phase} started filled`)
      }
    })

    console.log("\nwrite a note")
    await icon("BTCUSDT", "before").click()
    await page.waitForSelector('[data-testid="note-popup"]')
    await page.screenshot({ path: `${SHOTS}/j2-editor-open.png`, fullPage: true })
    await check("the editor opens empty for a trade with no note", async () => {
      assert.equal(await page.locator('[data-testid="note-textarea"]').inputValue(), "")
    })
    await page.keyboard.press("Escape")
    await page.waitForSelector('[data-testid="note-popup"]', { state: "detached" })

    await writeNote("BTCUSDT", "before", "Broke the range high on volume")
    await check("the icon marks the phase as written up", async () => {
      assert.equal(await filled("BTCUSDT", "before"), true)
    })
    await check("the other two phases stay unmarked", async () => {
      assert.equal(await filled("BTCUSDT", "during"), false)
      assert.equal(await filled("BTCUSDT", "after"), false)
    })
    await check("the note does not bleed onto the other trade's row", async () => {
      assert.equal(await filled("ETHUSDT", "before"), false)
    })

    console.log("\nedit an existing note")
    await icon("BTCUSDT", "before").click()
    await page.waitForSelector('[data-testid="note-popup"]')
    await check("reopening loads the saved text back into the editor", async () => {
      assert.equal(
        await page.locator('[data-testid="note-textarea"]').inputValue(),
        "Broke the range high on volume"
      )
    })
    await page.keyboard.press("Escape")
    await page.waitForSelector('[data-testid="note-popup"]', { state: "detached" })

    await writeNote("BTCUSDT", "before", "Broke the range high on volume — sized up too fast")
    await check("the edit replaces the note rather than adding a second one", async () => {
      const rows = await sql`
        SELECT phase, body FROM trade_notes
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'journal-1'
      `
      assert.equal(rows.length, 1)
      assert.match(rows[0].body, /sized up too fast/)
    })

    console.log("\nall three phases, including multiline and punctuation")
    await writeNote("BTCUSDT", "during", "Held through the retest")
    await writeNote("BTCUSDT", "after", NASTY_NOTE)
    await page.screenshot({ path: `${SHOTS}/j3-notes-written.png`, fullPage: true })
    await check("all three icons are marked", async () => {
      for (const phase of ["before", "during", "after"]) {
        assert.equal(await filled("BTCUSDT", phase), true, `${phase} not marked`)
      }
    })
    await check("the DB holds exactly one row per phase", async () => {
      const rows = await sql`
        SELECT phase FROM trade_notes
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'journal-1'
        ORDER BY phase
      `
      assert.deepEqual(rows.map((r) => r.phase), ["after", "before", "during"])
    })
    await check("a multiline note survives the round trip verbatim", async () => {
      const rows = await sql`
        SELECT body FROM trade_notes
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
          AND trade_id = 'journal-1' AND phase = 'after'
      `
      assert.equal(rows[0].body, NASTY_NOTE)
    })

    console.log("\nclearing a note")
    await writeNote("BTCUSDT", "during", "")
    await check("saving an empty note unmarks the icon", async () => {
      assert.equal(await filled("BTCUSDT", "during"), false)
    })
    await check("clearing deletes the row rather than storing a blank", async () => {
      const rows = await sql`
        SELECT 1 FROM trade_notes
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
          AND trade_id = 'journal-1' AND phase = 'during'
      `
      assert.equal(rows.length, 0)
    })

    // NOTE ON ORDER: this cold-load check must run BEFORE the export block.
    // Once a download has fired in this browser context, Chromium does not
    // hydrate the next page opened in it — the store never rehydrates and the
    // app renders its logged-out landing page. That is a harness artifact, not
    // app behaviour, so the export's real-world equivalent ("keep using the app
    // after exporting") is covered by the in-page check at the end of the export
    // block instead.
    console.log("\npersistence")
    // Cold-load in a new tab rather than reloading: an in-page reload races with
    // the wallet SDK's own navigation and gets ERR_ABORTED.
    const fresh = await context.newPage()
    fresh.on("pageerror", (e) => pageErrors.push(`[fresh] ${e.stack ?? String(e)}`))
    await fresh.goto(BASE, { waitUntil: "networkidle" })
    await fresh.waitForSelector('[data-testid="note-before"]')
    await fresh.screenshot({ path: `${SHOTS}/j5-fresh-load.png`, fullPage: true })

    await check("notes survive a fresh load of the app", async () => {
      const row = fresh.locator("tbody tr").filter({ hasText: "BTCUSDT" })
      assert.equal(await row.locator('[data-testid="note-before"]').getAttribute("data-filled"), "true")
      assert.equal(await row.locator('[data-testid="note-after"]').getAttribute("data-filled"), "true")
      // The one we cleared must come back cleared.
      assert.equal(await row.locator('[data-testid="note-during"]').getAttribute("data-filled"), "false")
    })
    await check("the reloaded editor still holds the text", async () => {
      const row = fresh.locator("tbody tr").filter({ hasText: "BTCUSDT" })
      await row.locator('[data-testid="note-before"]').click()
      await fresh.waitForSelector('[data-testid="note-textarea"]')
      assert.match(
        await fresh.locator('[data-testid="note-textarea"]').inputValue(),
        /sized up too fast/
      )
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
    await page.screenshot({ path: `${SHOTS}/j4-after-export.png`, fullPage: true })

    await check("the download is a date-stamped csv", async () => {
      assert.match(download.suggestedFilename(), /^trades-\d{4}-\d{2}-\d{2}\.csv$/)
    })
    await check("the csv header carries the three note columns", async () => {
      const header = csv.replace(/^﻿/, "").split("\r\n")[0]
      assert.ok(header.includes("noteBefore,noteDuring,noteAfter"), header)
    })
    await check("the csv contains both trades and the notes written above", async () => {
      assert.ok(csv.includes("BTCUSDT"), "BTCUSDT missing")
      assert.ok(csv.includes("ETHUSDT"), "ETHUSDT missing")
      assert.ok(csv.includes("sized up too fast"), "before-note missing")
      // The nasty note's inner quotes must be doubled, not left raw.
      assert.ok(csv.includes('""too big""'), "quotes were not escaped")
    })
    await check("the multiline note stayed inside one quoted field", async () => {
      // 1 header + 2 trade records. A broken escape would split the note's
      // newline into a third record.
      const records = csv.replace(/^﻿/, "").split(/\r\n(?=[^"]*(?:"[^"]*"[^"]*)*$)/).filter(Boolean)
      assert.equal(records.length, 3, `expected 3 records, got ${records.length}`)
    })
    await check("the app is still usable after exporting", async () => {
      // downloadCsv injects and removes an anchor and revokes a blob URL; none
      // of that may leave the page in a state where the journal stops working.
      await writeNote("ETHUSDT", "after", "Exported, then kept journalling")
      assert.equal(await filled("ETHUSDT", "after"), true)
    })

    console.log("\nisolation")
    await check("a share link never exposes the journal", async () => {
      // Notes are private commentary. The share page renders TradesTable without
      // onSaveNote, so no journal column — but the payload must not carry them
      // either, or a future UI change would leak them silently.
      // The route only accepts 48 lowercase hex chars, so a readable label
      // would be rejected as an invalid token before it ever reads a trade.
      const token = "aa".repeat(24)
      await sql`
        UPDATE users SET share_token = ${token}
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
      `
      const res = await fetch(`${BASE}/api/share/${token}`)
      const payload = JSON.stringify(await res.json())
      assert.ok(payload.includes("BTCUSDT"), "share payload should still carry trades")
      assert.equal(payload.includes("sized up too fast"), false, "share payload leaked a note")
      assert.equal(payload.includes("revenge-traded"), false, "share payload leaked a note")
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
    await page.screenshot({ path: `${SHOTS}/j-failure.png`, fullPage: true }).catch(() => {})
    console.error("\nbrowser errors:", pageErrors)
    console.error("network issues:", netIssues)
    console.error("rows in DOM:", await page.locator("tbody tr").count().catch(() => "?"))
    console.error("journal icons in DOM:", await page.locator('[data-testid="note-before"]').count().catch(() => "?"))
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
