/**
 * Headless UI test for the per-trade journal and the CSV export.
 *
 * Seeds a synthetic user through the API, drives the real dashboard in Chromium,
 * and asserts the one Notes field inside the 📋 journal form writes, edits,
 * clears and persists a note — that a note migrated from the old three
 * before/during/after popups loads into it — and that the export button produces
 * a CSV carrying it in a single `notes` column.
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
import { signIn, signInBrowser } from "./helpers/session.mjs"
import { gotoApp, reloadApp } from "./helpers/nav.mjs"

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

// Seeding goes through the API, which now requires a session.
let cookie = ""

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM public.trade_overrides    WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.trade_notes        WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users              WHERE telegram_id = ${tid}`
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  cookie = await signIn(BASE, TEST_TELEGRAM_ID, "ui-test")
  await post("/api/trades-store", { exchange: EXCHANGE, trades: TRADES })
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
  // The cookie, not localStorage, is what the server trusts now.
  await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "ui-test")
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

  const rowFor = (ticker, p = page) => p.locator("tbody tr").filter({ hasText: ticker })
  const journalIcon = (ticker, p = page) => rowFor(ticker, p).locator('[data-testid="journal-open"]')
  const filled = async (ticker, p = page) =>
    (await journalIcon(ticker, p).getAttribute("data-filled")) === "true"
  const notesBox = (p = page) => p.locator('[data-testid="journal-notes"]')
  const storedNotes = async (tradeId) => {
    const rows = await sql`
      SELECT notes FROM public.trade_overrides
      WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = ${tradeId}
    `
    return rows.length === 0 ? undefined : rows[0].notes
  }

  async function openJournal(ticker, p = page) {
    await journalIcon(ticker, p).click()
    await p.waitForSelector('[data-testid="journal-form"]')
  }
  async function closeJournal(p = page) {
    await p.locator('button[aria-label="Close journal"]').click()
    await p.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
  }

  /**
   * Opens the journal, types the note, saves, and waits for the POST to land.
   * The UI updates optimistically, so waiting on the DOM alone would let a
   * later reload abort the in-flight write and silently lose the note.
   */
  async function writeNote(ticker, text) {
    await openJournal(ticker)
    await notesBox().fill(text)
    const responded = page.waitForResponse(
      (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
    )
    await page.locator('[data-testid="journal-save"]').click()
    const res = await responded
    assert.equal(res.status(), 200, `journal save returned ${res.status()}`)
    await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
  }

  try {
    await gotoApp(page, BASE)
    await page.waitForSelector('[data-testid="journal-open"]')
    await page.screenshot({ path: `${SHOTS}/j1-initial.png`, fullPage: true })

    console.log("\ninitial render")
    await check("the three per-phase note icons are gone", async () => {
      for (const phase of ["before", "during", "after"]) {
        assert.equal(await page.locator(`[data-testid="note-${phase}"]`).count(), 0, phase)
      }
      assert.equal(await page.locator('[data-testid="note-popup"]').count(), 0)
    })
    await check("every row has exactly one journal button", async () => {
      assert.equal(await page.locator('[data-testid="journal-open"]').count(), TRADES.length)
    })
    await check("the page never asks for the removed notes endpoint", async () => {
      assert.equal(apiCalls.some((c) => c.includes("/api/trades/notes")), false, apiCalls.join("\n"))
    })
    await check("no row starts out marked as journalled", async () => {
      assert.equal(await filled("BTCUSDT"), false)
      assert.equal(await filled("ETHUSDT"), false)
    })

    console.log("\nthe notes field")
    await openJournal("BTCUSDT")
    await page.locator('[data-testid="journal-form"]').screenshot({ path: `${SHOTS}/j2-form-notes.png` })
    await check("the journal form has one notes field, empty for a new trade", async () => {
      assert.equal(await page.locator('[data-testid="journal-form"] textarea').count(), 1)
      assert.equal(await notesBox().inputValue(), "")
    })
    await check("a long line wraps inside the field instead of running off", async () => {
      // The form renders from a table cell that sets whitespace-nowrap, and a
      // textarea obeys white-space too.
      await notesBox().fill("word ".repeat(200))
      const box = await notesBox().evaluate((el) => ({
        ws: getComputedStyle(el).whiteSpace,
        overflowX: el.scrollWidth - el.clientWidth,
      }))
      assert.equal(box.ws, "pre-wrap")
      assert.ok(box.overflowX <= 1, `the note scrolls sideways by ${box.overflowX}px`)
    })
    await closeJournal()
    await check("closing without saving stores nothing", async () => {
      assert.equal(await storedNotes("journal-1"), undefined)
    })

    console.log("\nwrite a note")
    await writeNote("BTCUSDT", "Broke the range high on volume")
    await check("the button marks the trade as journalled", async () => {
      assert.equal(await filled("BTCUSDT"), true)
    })
    await check("the note is the button's tooltip", async () => {
      assert.equal(await journalIcon("BTCUSDT").getAttribute("title"), "Broke the range high on volume")
    })
    await check("the note landed in trade_overrides, not trade_notes", async () => {
      assert.equal(await storedNotes("journal-1"), "Broke the range high on volume")
      const legacy = await sql`
        SELECT 1 FROM public.trade_notes WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}`
      assert.equal(legacy.length, 0)
    })
    await check("the note does not bleed onto the other trade's row", async () => {
      assert.equal(await filled("ETHUSDT"), false)
    })

    console.log("\nedit an existing note")
    await openJournal("BTCUSDT")
    await check("reopening loads the saved text back into the field", async () => {
      assert.equal(await notesBox().inputValue(), "Broke the range high on volume")
    })
    await closeJournal()
    await writeNote("BTCUSDT", NASTY_NOTE)
    await check("the edit replaces the note rather than adding a second row", async () => {
      const rows = await sql`
        SELECT notes FROM public.trade_overrides
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'journal-1'
      `
      assert.equal(rows.length, 1)
      assert.equal(rows[0].notes, NASTY_NOTE, "a multiline note should survive verbatim")
    })

    console.log("\nthe note alongside the rest of the journal")
    await openJournal("BTCUSDT")
    await page.locator('[data-testid="journal-strategy"]').selectOption("pa")
    await page.locator('[data-testid="journal-entryOrder"]').selectOption("market")
    {
      const responded = page.waitForResponse(
        (r) => r.url().includes("/api/trades/overrides") && r.request().method() === "POST"
      )
      await page.locator('[data-testid="journal-save"]').click()
      assert.equal((await responded).status(), 200)
      await page.waitForSelector('[data-testid="journal-form"]', { state: "detached" })
    }
    await check("saving other fields leaves the note alone", async () => {
      const rows = await sql`
        SELECT notes, strategy, entry_order FROM public.trade_overrides
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND trade_id = 'journal-1'
      `
      assert.equal(rows[0].notes, NASTY_NOTE)
      assert.equal(rows[0].strategy, "pa")
      assert.equal(rows[0].entry_order, "market")
    })

    console.log("\nclearing a note")
    await writeNote("ETHUSDT", "only a note")
    await check("a notes-only entry is a real journal entry", async () => {
      assert.equal(await storedNotes("journal-2"), "only a note")
      assert.equal(await filled("ETHUSDT"), true)
    })
    await writeNote("ETHUSDT", "   ")
    await check("saving a blank note unmarks the row and deletes it", async () => {
      assert.equal(await filled("ETHUSDT"), false)
      assert.equal(await storedNotes("journal-2"), undefined)
    })

    console.log("\nlegacy data")
    // Exactly what 20260929000001 writes for a trade that had before and after
    // notes: one field, each phase under its label.
    const MIGRATED = "Before:\nplanned the breakout\n\nAfter:\nexited early"
    await sql`
      INSERT INTO public.trade_overrides (telegram_id, exchange, trade_id, notes)
      VALUES (${BigInt(TEST_TELEGRAM_ID)}, ${EXCHANGE}, 'journal-2', ${MIGRATED})
    `

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
    await gotoApp(fresh, BASE)
    await fresh.waitForSelector('[data-testid="journal-open"][data-filled="true"]')
    await fresh.screenshot({ path: `${SHOTS}/j5-fresh-load.png`, fullPage: true })

    await check("the note survives a fresh load of the app", async () => {
      await openJournal("BTCUSDT", fresh)
      assert.equal(await notesBox(fresh).inputValue(), NASTY_NOTE)
      await closeJournal(fresh)
    })
    await check("a migrated before/after note loads into the one field", async () => {
      assert.equal(await filled("ETHUSDT", fresh), true)
      await openJournal("ETHUSDT", fresh)
      assert.equal(await notesBox(fresh).inputValue(), MIGRATED)
      await fresh.locator('[data-testid="journal-form"]').screenshot({ path: `${SHOTS}/j6-migrated-note.png` })
      await closeJournal(fresh)
    })
    await fresh.close()

    console.log("\nexport")
    // The export serialises whatever overrides state `page` holds, and `page`
    // never saw the migrated note written straight to the DB. Assert BTC's note
    // is loaded, then export.
    await journalIcon("BTCUSDT").and(page.locator('[data-filled="true"]'))
      .waitFor({ state: "attached", timeout: 30_000 })

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
    await check("the csv header carries one notes column and no per-phase ones", async () => {
      const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0].split(",")
      assert.ok(header.includes("notes"), header.join(","))
      for (const gone of ["noteBefore", "noteDuring", "noteAfter"]) {
        assert.equal(header.includes(gone), false, `${gone} is still exported`)
      }
      assert.ok(header.includes("entryOrder"), header.join(","))
    })
    await check("the csv contains both trades and the note written above", async () => {
      assert.ok(csv.includes("BTCUSDT"), "BTCUSDT missing")
      assert.ok(csv.includes("ETHUSDT"), "ETHUSDT missing")
      assert.ok(csv.includes("revenge-traded"), "note missing")
      // The nasty note's inner quotes must be doubled, not left raw.
      assert.ok(csv.includes('""too big""'), "quotes were not escaped")
    })
    await check("the multiline note stayed inside one quoted field", async () => {
      // 1 header + 2 trade records. A broken escape would split the note's
      // newline into a third record.
      const records = csv.replace(/^\uFEFF/, "").split(/\r\n(?=[^"]*(?:"[^"]*"[^"]*)*$)/).filter(Boolean)
      assert.equal(records.length, 3, `expected 3 records, got ${records.length}`)
    })
    await check("the app is still usable after exporting", async () => {
      // downloadCsv injects and removes an anchor and revokes a blob URL; none
      // of that may leave the page in a state where the journal stops working.
      await writeNote("ETHUSDT", "Exported, then kept journalling")
      assert.equal(await storedNotes("journal-2"), "Exported, then kept journalling")
    })

    console.log("\nisolation")
    await check("a share link never exposes the note", async () => {
      // Notes are private commentary. The share page renders TradesTable without
      // overrides, so no journal column — but the payload must not carry them
      // either, or a future UI change would leak them silently.
      // The route only accepts 48 lowercase hex chars, so a readable label
      // would be rejected as an invalid token before it ever reads a trade.
      const token = "aa".repeat(24)
      await sql`
        UPDATE public.users SET share_token = ${token}
        WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
      `
      const res = await fetch(`${BASE}/api/share/${token}`)
      const payload = JSON.stringify(await res.json())
      assert.ok(payload.includes("BTCUSDT"), "share payload should still carry trades")
      assert.equal(payload.includes("revenge-traded"), false, "share payload leaked a note")
      assert.equal(payload.includes("kept journalling"), false, "share payload leaked a note")
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
    console.error("journal buttons in DOM:", await page.locator('[data-testid="journal-open"]').count().catch(() => "?"))
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
