/**
 * Headless UI test for the spot journal popup.
 *
 * Drives the real /spot page in Chromium: one journal icon per row, the popup's
 * Planned / Why / Feeling / Note fields, save (button and ⌘↵), cancel, reload,
 * the 3-line scrolling note, and the neighbouring flows the journal must not
 * disturb — editing amounts, the export's ledger CSV and delete. Every assertion is on
 * the DOM or the stored row, not on a screenshot.
 *
 * SAFETY: every read and write is scoped to TEST_TELEGRAM_ID, a synthetic user
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:spot-journal
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"
import { unzipSync } from "fflate"
import { signInBrowser } from "./helpers/session.mjs"
import { gotoApp, reloadApp } from "./helpers/nav.mjs"

// Playwright is installed globally, not as a project dependency.
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000000008"
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
  await sql`DELETE FROM public.spot_entries WHERE telegram_id = ${tid}`
  await sql`DELETE FROM public.users        WHERE telegram_id = ${tid}`
}

async function seed() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`
    INSERT INTO public.users (telegram_id, telegram_name)
    VALUES (${tid}, ${"ui-test-spot-journal"}) ON CONFLICT (telegram_id) DO NOTHING
  `
  const ids = {}
  for (const [key, side, qty, price, at] of [
    ["buy", "BUY", 2, 100, "2026-03-01T12:00:00Z"],
    ["sell", "SELL", 1, 150, "2026-04-01T12:00:00Z"],
  ]) {
    const rows = await sql`
      INSERT INTO public.spot_entries (telegram_id, ticker, side, qty, price, traded_at)
      VALUES (${tid}, 'BTC', ${side}, ${qty}, ${price}, ${at})
      RETURNING id
    `
    ids[key] = String(rows[0].id)
  }
  return ids
}

async function dbRow(id) {
  const rows = await sql`
    SELECT qty::float8 AS qty, planned, why, feeling, note, deleted_at
    FROM public.spot_entries WHERE id = ${BigInt(id)}
  `
  return rows[0]
}

/** RFC 4180 → records keyed by header. The note cell may be quoted. */
function parseCsv(csv) {
  const rows = [[]]
  let field = ""
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { rows.at(-1).push(field); field = "" }
    else if (ch === "\r" && csv[i + 1] === "\n") { rows.at(-1).push(field); field = ""; rows.push([]); i++ }
    else field += ch
  }
  rows.pop()
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

const NOTE = Array.from({ length: 12 }, (_, i) => `line ${i + 1}, thinking out loud`).join("\n")

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()
  const ids = await seed()
  console.log(`\nsetup: synthetic user ${TEST_TELEGRAM_ID}, a BTC buy and a BTC sell`)

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
          telegramName: "ui-test-spot-journal",
          role: "USER",
          apiKeys: {},
          originalAdmin: null,
        },
        version: 0,
      })
    )
  }, TEST_TELEGRAM_ID)

  const page = await context.newPage()
  await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "spot-journal-ui")
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))

  const tid = (t) => page.locator(`[data-testid="${t}"]`)
  const rows = () => page.locator('[data-testid="spot-entry-row"]')
  const rowOn = (d) => page.locator('[data-testid="spot-entry-row"]', { hasText: d })
  const iconOn = (d) => rowOn(d).locator('[data-testid="spot-journal-open"]')
  const popup = () => tid("spot-journal-popup")
  const note = () => tid("spot-journal-note")
  const pressed = (t) => tid(t).getAttribute("aria-pressed")
  const patched = () =>
    page.waitForResponse((r) => r.url().includes("/api/spot/entries") && r.request().method() === "PATCH")

  try {
    await gotoApp(page, `${BASE}/spot`)
    await page.waitForSelector('[data-testid="spot-entry-row"]')

    console.log("\nthe icon")
    await check("every row has exactly one journal icon, unfilled", async () => {
      assert.equal(await rows().count(), 2)
      for (const d of ["2026-03-01", "2026-04-01"]) {
        assert.equal(await iconOn(d).count(), 1, `${d} icon count`)
        assert.equal(await iconOn(d).getAttribute("data-filled"), "false")
      }
    })

    console.log("\nthe popup")
    await iconOn("2026-03-01").click()
    await popup().waitFor()
    await check("it holds Planned, Why and Feeling with the requested options", async () => {
      for (const t of ["planned-yes", "planned-no"]) assert.equal(await tid(`spot-journal-${t}`).count(), 1)
      for (const t of ["dca", "dip", "news", "pump", "take_profit"]) {
        assert.equal(await tid(`spot-journal-why-${t}`).count(), 1, `why ${t}`)
      }
      for (const t of ["calm", "unsure", "thrill", "fomo"]) {
        assert.equal(await tid(`spot-journal-feeling-${t}`).count(), 1, `feeling ${t}`)
      }
      assert.match(await popup().innerText(), /BTC/)
    })

    const style = await note().evaluate((el) => {
      const cs = getComputedStyle(el)
      return { rows: el.rows, resize: cs.resize, overflowY: cs.overflowY, lineHeight: parseFloat(cs.lineHeight), clientHeight: el.clientHeight, maxLength: el.maxLength }
    })
    await check("the note is a 3-row textarea, not resizable, scrolling, capped at 4000", async () => {
      assert.equal(style.rows, 3)
      assert.equal(style.resize, "none")
      assert.equal(style.overflowY, "auto")
      assert.equal(style.maxLength, 4000)
      // Three lines of text plus padding — not one, not five.
      assert.ok(style.clientHeight >= style.lineHeight * 3, `height ${style.clientHeight}`)
      assert.ok(style.clientHeight < style.lineHeight * 4 + 16, `height ${style.clientHeight}`)
    })

    for (const t of ["planned-yes", "why-dip", "why-dca", "feeling-calm", "feeling-fomo"]) {
      await tid(`spot-journal-${t}`).click()
    }
    await note().fill(NOTE)
    await check("a 12-line note keeps the box at 3 lines and scrolls inside it", async () => {
      const m = await note().evaluate((el) => {
        el.scrollTop = el.scrollHeight
        return { client: el.clientHeight, scroll: el.scrollHeight, top: el.scrollTop }
      })
      assert.equal(m.client, style.clientHeight, "the box grew")
      assert.ok(m.scroll > m.client * 2, `scrollHeight ${m.scroll} vs ${m.client}`)
      assert.ok(m.top > 0, "did not scroll")
    })
    await check("chosen chips are pressed, others are not", async () => {
      for (const t of ["planned-yes", "why-dca", "why-dip", "feeling-calm", "feeling-fomo"]) {
        assert.equal(await pressed(`spot-journal-${t}`), "true", t)
      }
      for (const t of ["planned-no", "why-news", "feeling-thrill"]) {
        assert.equal(await pressed(`spot-journal-${t}`), "false", t)
      }
    })
    await page.screenshot({ path: `${SHOTS}/spot-journal-1-popup.png` })

    let res = patched()
    await tid("spot-journal-save").click()
    await check("Save writes the row and closes the popup; only that icon lights up", async () => {
      assert.equal((await res).status(), 200)
      await popup().waitFor({ state: "hidden" })
      const r = await dbRow(ids.buy)
      assert.equal(r.planned, true)
      assert.equal(r.why, "dca|dip")
      assert.equal(r.feeling, "calm|fomo")
      assert.equal(r.note, NOTE)
      assert.equal(await iconOn("2026-03-01").getAttribute("data-filled"), "true")
      assert.equal(await iconOn("2026-04-01").getAttribute("data-filled"), "false")
    })

    console.log("\nreload, reopen, cancel")
    await reloadApp(page)
    await page.waitForSelector('[data-testid="spot-entry-row"]')
    await check("after a reload the icon is still filled", async () => {
      assert.equal(await iconOn("2026-03-01").getAttribute("data-filled"), "true")
    })
    await iconOn("2026-03-01").click()
    await popup().waitFor()
    await check("reopening shows what is stored", async () => {
      assert.equal(await pressed("spot-journal-planned-yes"), "true")
      assert.equal(await pressed("spot-journal-why-dca"), "true")
      assert.equal(await pressed("spot-journal-why-news"), "false")
      assert.equal(await note().inputValue(), NOTE)
    })
    await tid("spot-journal-why-news").click()
    await popup().getByRole("button", { name: "Cancel" }).click()
    await popup().waitFor({ state: "hidden" })
    await check("Cancel discards the edit", async () => {
      assert.equal((await dbRow(ids.buy)).why, "dca|dip")
      await iconOn("2026-03-01").click()
      await popup().waitFor()
      assert.equal(await pressed("spot-journal-why-news"), "false")
    })

    // Clicking the chosen answer again clears it; ⌘/Ctrl+Enter saves from the note.
    await tid("spot-journal-planned-yes").click()
    res = patched()
    await note().press("ControlOrMeta+Enter")
    await check("re-clicking Yes clears Planned, and ⌘↵ saves", async () => {
      assert.equal((await res).status(), 200)
      await popup().waitFor({ state: "hidden" })
      const r = await dbRow(ids.buy)
      assert.equal(r.planned, null)
      assert.equal(r.why, "dca|dip", "the rest is untouched")
    })

    await iconOn("2026-04-01").click()
    await popup().waitFor()
    await tid("spot-journal-planned-no").click()
    await tid("spot-journal-why-take_profit").click()
    res = patched()
    await tid("spot-journal-save").click()
    await check("a SELL row journals independently", async () => {
      assert.equal((await res).status(), 200)
      await popup().waitFor({ state: "hidden" })
      const r = await dbRow(ids.sell)
      assert.equal(r.planned, false)
      assert.equal(r.why, "take_profit")
      assert.equal(r.feeling, null)
      assert.equal(await iconOn("2026-04-01").getAttribute("data-filled"), "true")
    })

    console.log("\nneighbouring flows")
    await rowOn("2026-03-01").locator('[data-testid="spot-edit-entry"]').click()
    await tid("spot-coins").fill("3")
    const put = page.waitForResponse(
      (r) => r.url().includes("/api/spot/entries") && r.request().method() === "PUT"
    )
    await tid("spot-submit").click()
    await check("editing the amounts keeps the journal, on screen and in the row", async () => {
      assert.equal((await put).status(), 200)
      await page.waitForFunction(
        () => document.querySelector('[data-testid="spot-form"]')?.getAttribute("data-mode") === "add"
      )
      assert.equal(await iconOn("2026-03-01").getAttribute("data-filled"), "true")
      const r = await dbRow(ids.buy)
      assert.equal(r.qty, 3)
      assert.equal(r.why, "dca|dip")
    })

    const download = await Promise.all([page.waitForEvent("download"), tid("export-spot").click()]).then(([d]) => d)
    // The export is a zip; the journal lives in its ledger.csv.
    const raw = await download.createReadStream().then(async (s) => {
      const chunks = []
      for await (const chunk of s) chunks.push(chunk)
      return new TextDecoder().decode(unzipSync(new Uint8Array(Buffer.concat(chunks)))["ledger.csv"])
    })
    await check("the export's ledger carries the journal, multi-line note intact", async () => {
      const recs = parseCsv(raw.replace(/^﻿/, ""))
      const buy = recs.find((r) => r.side === "BUY")
      const sell = recs.find((r) => r.side === "SELL")
      assert.equal(buy.planned, "")
      assert.equal(buy.why, "dca|dip")
      assert.equal(buy.feeling, "calm|fomo")
      assert.equal(buy.note, NOTE)
      assert.equal(sell.planned, "no")
      assert.equal(sell.why, "take_profit")
    })

    await rowOn("2026-04-01").locator('[data-testid="spot-delete-entry"]').click()
    await check("delete still removes the row", async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="spot-entry-row"]').length === 1
      )
      assert.notEqual((await dbRow(ids.sell)).deleted_at, null)
    })

    await check("no uncaught page errors", () => {
      assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join("\n---\n")}`)
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
