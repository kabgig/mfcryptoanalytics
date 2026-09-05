/**
 * Headless UI check that a cron-archived trade behaves like a soft-deleted one
 * in the real dashboard: hidden from the table and the stats, listed behind the
 * "show deleted" toggle, and restorable.
 *
 * This is the visible half of turning the cleanup job from a hard DELETE into an
 * archive. Under the old job the row was destroyed, so none of this was
 * reachable at all.
 *
 * SAFETY: the cron sweeps every user's rows, so this refuses to run if any real
 * trade is old enough to be touched. Everything it seeds belongs to a synthetic
 * user, removed in a finally block.
 *
 *   npm run dev            # in another terminal
 *   npm run test:ui:cleanup
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000000403"
const EXCHANGE = "OKX"
const SECRET = process.env.CRON_SECRET
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const yearsAgo = (n) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString()
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

// ancient is past the 4-year cutoff; the other two sit inside the dashboard's
// default 3-month period so they render without touching the period selector.
const TRADES = [
  { id: "clui-ancient", closeTime: yearsAgo(5), pnl: 100 },
  { id: "clui-recent-a", closeTime: daysAgo(10), pnl: 50 },
  { id: "clui-recent-b", closeTime: daysAgo(20), pnl: 25 },
]

/** A custom period wide enough to reach an archived trade. */
const WIDE_PERIOD = {
  kind: "custom",
  from: new Date(Date.now() - 6 * 365 * 86_400_000).toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10),
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users             WHERE telegram_id = ${tid}`
}

async function assertNoRealDataAtRisk() {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM cached_trades
    WHERE close_time < NOW() - INTERVAL '2 years'
      AND telegram_id <> ${BigInt(TEST_TELEGRAM_ID)}
  `
  if (rows[0].n > 0) {
    throw new Error(`ABORT: ${rows[0].n} real trades are old enough for the sweep to touch`)
  }
}

async function seed() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${tid}, ${"cleanup-ui"}) ON CONFLICT (telegram_id) DO NOTHING
  `
  for (const t of TRADES) {
    await sql`
      INSERT INTO cached_trades
        (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market, side)
      VALUES (${t.id}, ${tid}, ${EXCHANGE}, ${"BTCUSDT"}, 1, null, null,
              ${t.closeTime}::timestamptz, ${t.closeTime}::timestamptz, ${t.pnl}, null, null)
    `
  }
  await sql`
    INSERT INTO exchange_fetch_log (telegram_id, exchange, fetched_at)
    VALUES (${tid}, ${EXCHANGE}, NOW())
    ON CONFLICT (telegram_id, exchange) DO UPDATE SET fetched_at = NOW()
  `
}

const archivedAt = async (id) => {
  const rows = await sql`
    SELECT deleted_at FROM cached_trades
    WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)} AND id = ${id}
  `
  return rows.length === 0 ? "ROW GONE" : rows[0].deleted_at
}

async function main() {
  if (!SECRET) throw new Error("CRON_SECRET must be set (run with --env-file=.env.local)")
  mkdirSync(SHOTS, { recursive: true })

  await teardown()
  await assertNoRealDataAtRisk()
  await seed()

  // Run the real cron endpoint, exactly as Vercel does.
  const cronRes = await fetch(`${BASE}/api/cron/cleanup`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })
  const cronJson = await cronRes.json()
  console.log(`\nsetup: seeded 3 trades, cron reported ${JSON.stringify(cronJson)}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((id) => {
    localStorage.setItem("mfca-user-store", JSON.stringify({
      state: {
        userId: null, walletAddress: null,
        telegramId: id, telegramName: "cleanup-ui", role: "USER",
        apiKeys: {}, originalAdmin: null,
      },
      version: 0,
    }))
  }, TEST_TELEGRAM_ID)

  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)))
  const netIssues = []
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) netIssues.push(`HTTP ${r.status()} ${r.url()}`)
  })

  const rowCount = () => page.locator('[data-testid="delete-trade"]').count()
  const totalPnl = async () =>
    (await page.locator('[data-testid="total-pnl"]').innerText()).replace(/\s/g, "")
  const tradeCount = () => page.locator('[data-testid="trade-count"]').innerText()
  const waitForRows = (n) =>
    page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="delete-trade"]').length === expected,
      n,
      { timeout: 30_000 }
    )

  try {
    console.log("\nthe cron itself")

    await check("the cron archived exactly the one trade past the cutoff", () => {
      assert.equal(cronRes.status, 200)
      assert.equal(cronJson.archived, 1)
      assert.equal(cronJson.olderThanYears, 4)
    })

    await check("the archived row still exists in the database", async () => {
      const at = await archivedAt("clui-ancient")
      assert.notEqual(at, "ROW GONE", "the cron destroyed the row instead of archiving it")
      assert.ok(at !== null, "the row was not archived")
    })

    console.log("\nthe dashboard")
    const deletedFetched = page.waitForResponse(
      (r) => r.url().includes("/api/trades/deleted"), { timeout: 30_000 }
    )
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
    await waitForRows(2)
    // Without this the "no toggle" check below could pass simply because the
    // request had not come back yet.
    await deletedFetched
    await page.waitForTimeout(500)

    await check("only the two in-window trades are in the table", async () => {
      assert.equal(await rowCount(), 2)
    })

    await check("the archived trade is not in the visible table", async () => {
      const body = await page.innerText("body")
      assert.ok(!body.includes("clui-ancient"), "archived trade rendered in the table")
    })

    await check("stats exclude the archived trade: +$75.00 across 2 trades", async () => {
      assert.match(await totalPnl(), /\+?\$?75\.00/)
      assert.match(await tradeCount(), /2/)
    })

    // The deleted list is period-filtered too (HomeView filteredDeletedTrades),
    // and an archived trade is by definition older than the widest dashboard
    // preset (2y). So under a preset it is genuinely unreachable — asserted here
    // so the limitation is recorded rather than discovered later.
    await check("under the default 3m period the archived trade is not offered at all", async () => {
      assert.equal(
        await page.locator('[data-testid="toggle-deleted"]').count(),
        0,
        "expected the archived trade to fall outside the default period"
      )
    })

    console.log("\nwidening the period to reach it")
    await page.evaluate((sel) => {
      sessionStorage.setItem("mfca-period", JSON.stringify({ state: { selection: sel }, version: 0 }))
    }, WIDE_PERIOD)
    await page.reload({ waitUntil: "domcontentloaded" })
    await waitForRows(2)

    const toggle = page.locator('[data-testid="toggle-deleted"]')
    // The toggle only renders once /api/trades/deleted has come back.
    await toggle.waitFor({ state: "visible", timeout: 30_000 })

    await check("with a wide custom range the toggle appears and counts it", async () => {
      assert.equal(await toggle.count(), 1, "no toggle — the archived trade is unreachable")
      assert.match(await toggle.innerText(), /Show deleted \(1\)/)
    })

    await toggle.click()
    await page.waitForSelector('[data-testid="restore-trade"]', { timeout: 30_000 })
    await page.screenshot({ path: `${SHOTS}/cleanup-1-archived-revealed.png`, fullPage: true })

    await check("the archived trade is revealed with a restore button", async () => {
      // A revealed row carries restore-trade instead of delete-trade, so the
      // table is 2 live rows + 1 revealed one.
      assert.equal(await page.locator('[data-testid="restore-trade"]').count(), 1)
      assert.equal(await rowCount(), 2)
    })

    await check("revealing it does NOT add it back to the stats", async () => {
      assert.match(await totalPnl(), /\+?\$?75\.00/)
      assert.match(await tradeCount(), /2/)
    })

    console.log("\nrestoring what the cron archived")
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/trades/restore"), { timeout: 30_000 }),
      page.locator('[data-testid="restore-trade"]').click(),
    ])
    await waitForRows(3)
    await page.screenshot({ path: `${SHOTS}/cleanup-2-restored.png`, fullPage: true })

    await check("the trade comes back into the table", async () => {
      assert.equal(await rowCount(), 3)
    })

    await check("the stats pick it back up: +$175.00 across 3 trades", async () => {
      assert.match(await totalPnl(), /\+?\$?175\.00/)
      assert.match(await tradeCount(), /3/)
    })

    await check("the restore cleared deleted_at in the database", async () => {
      assert.equal(await archivedAt("clui-ancient"), null)
    })

    await check("the restore survives a fresh load", async () => {
      const fresh = await context.newPage()
      // sessionStorage is per-tab, so a new tab starts back on the 3m default
      // and the 5-year-old trade would fall outside it. Re-apply the range.
      await fresh.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
      await fresh.evaluate((sel) => {
        sessionStorage.setItem("mfca-period", JSON.stringify({ state: { selection: sel }, version: 0 }))
      }, WIDE_PERIOD)
      await fresh.reload({ waitUntil: "domcontentloaded" })
      await fresh.waitForFunction(
        () => document.querySelectorAll('[data-testid="delete-trade"]').length === 3,
        null, { timeout: 30_000 }
      )
      // Nothing is deleted any more, so the toggle should be gone entirely.
      const deletedFetch = fresh.waitForResponse(
        (r) => r.url().includes("/api/trades/deleted"), { timeout: 30_000 }
      ).catch(() => null)
      await deletedFetch
      await fresh.waitForTimeout(500)
      assert.equal(await fresh.locator('[data-testid="toggle-deleted"]').count(), 0)
      await fresh.close()
    })

    console.log("\nhygiene")
    await check("no uncaught JS errors in the browser", () => {
      assert.deepEqual(pageErrors, [])
    })
    await check("no failing app requests", () => {
      assert.deepEqual(netIssues, [])
    })

    console.log(`\n${passed} checks passed — screenshots in scripts/test/screenshots/\n`)
  } finally {
    await browser.close()
    await teardown()
    console.log(`teardown: removed synthetic user ${TEST_TELEGRAM_ID}`)
  }
}

main().catch((err) => {
  console.error("\nUI test failed:", err)
  process.exit(1)
})
