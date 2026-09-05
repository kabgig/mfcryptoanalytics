/**
 * End-to-end check of the daily cleanup cron against a running dev server and
 * the real database.
 *
 * SAFETY, and it matters more here than in the other suites: this route is
 * GLOBAL — it sweeps every user's rows, not just the caller's. A red/green run
 * therefore executes the pre-change HARD DELETE against the production database.
 * assertNoRealDataAtRisk() below aborts the whole run unless every row old
 * enough to be touched belongs to this script's synthetic users.
 *
 *   npm run dev            # in another terminal
 *   npm run test:cleanup
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const USER_ID = "990000000401"
const OTHER_ID = "990000000402"
const EXCHANGE = "OKX"
const SECRET = process.env.CRON_SECRET ?? ""

const sql = getSql()

let passed = 0
const failures: string[] = []
const CONTINUE_ON_FAIL = Boolean(process.env.CLEANUP_TEST_CONTINUE_ON_FAIL)

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (err) {
    if (!CONTINUE_ON_FAIL) throw err
    failures.push(`${name} — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)
    console.log(`  ✗ ${name}`)
    return
  }
  passed++
  console.log(`  ✓ ${name}`)
}

/** Years back from now, as an ISO timestamp. */
const yearsAgo = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString()
}

const SYNTHETIC = [BigInt(USER_ID), BigInt(OTHER_ID)]

/**
 * Refuses to run if any real row is old enough for either the old (2 year, hard
 * DELETE) or the new (4 year, archive) sweep to touch it.
 */
async function assertNoRealDataAtRisk() {
  const rows = await sql`
    SELECT telegram_id, COUNT(*)::int AS n
    FROM cached_trades
    WHERE close_time < NOW() - INTERVAL '2 years'
      AND telegram_id <> ALL(${SYNTHETIC}::bigint[])
    GROUP BY telegram_id
  ` as { telegram_id: string; n: number }[]

  if (rows.length > 0) {
    throw new Error(
      `ABORT: ${rows.length} real user(s) have trades older than 2 years. ` +
      `A red run would hard-delete them. ${JSON.stringify(rows)}`
    )
  }
}

/** Fingerprint of everything that is not ours, to prove the sweep left it alone. */
async function realDataFingerprint() {
  const [row] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS live
    FROM cached_trades
    WHERE telegram_id <> ALL(${SYNTHETIC}::bigint[])
  ` as { total: number; live: number }[]
  return row
}

async function teardown() {
  for (const id of [USER_ID, OTHER_ID]) {
    const tid = BigInt(id)
    await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
    await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
    await sql`DELETE FROM users             WHERE telegram_id = ${tid}`
  }
}

/** Rows seeded with an explicit close_time, bypassing the API's date handling. */
async function seed(telegramId: string, rows: { id: string; closeTime: string; pnl: number }[]) {
  const tid = BigInt(telegramId)
  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${tid}, ${"cleanup-test"})
    ON CONFLICT (telegram_id) DO NOTHING
  `
  for (const r of rows) {
    await sql`
      INSERT INTO cached_trades
        (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market, side)
      VALUES (${r.id}, ${tid}, ${EXCHANGE}, ${"BTCUSDT"}, 1, null, null,
              ${r.closeTime}::timestamptz, ${r.closeTime}::timestamptz, ${r.pnl}, null, null)
    `
  }
}

const state = async (id: string) => {
  const rows = await sql`
    SELECT id, deleted_at FROM cached_trades
    WHERE telegram_id = ${BigInt(USER_ID)} AND id = ${id}
  ` as { id: string; deleted_at: Date | null }[]
  return rows[0] ?? null
}

const runCron = async (auth = `Bearer ${SECRET}`) => {
  const res = await fetch(`${BASE}/api/cron/cleanup`, { headers: { authorization: auth } })
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

async function main() {
  if (!SECRET) throw new Error("CRON_SECRET must be set (run with --env-file=.env.local)")

  await teardown()
  await assertNoRealDataAtRisk()
  const before = await realDataFingerprint()
  console.log(`\nsafety: ${before.total} real rows, none older than 2 years — safe to sweep`)

  try {
    // ancient  = past both the old 2y and the new 4y cutoff
    // middle   = past the old 2y cutoff but INSIDE the new 4y one  <- the discriminator
    // recent   = inside both
    // usergone = ancient, but already deleted by the user
    await seed(USER_ID, [
      { id: "cl-ancient", closeTime: yearsAgo(5), pnl: 100 },
      { id: "cl-middle", closeTime: yearsAgo(3), pnl: 50 },
      { id: "cl-recent", closeTime: yearsAgo(1), pnl: 25 },
      { id: "cl-usergone", closeTime: yearsAgo(6), pnl: 10 },
    ])
    await seed(OTHER_ID, [{ id: "cl-other-recent", closeTime: yearsAgo(1), pnl: 7 }])

    // The user deleted this one themselves, three days ago.
    const userDeletedAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
    await sql`
      UPDATE cached_trades SET deleted_at = ${userDeletedAt}::timestamptz
      WHERE telegram_id = ${BigInt(USER_ID)} AND id = ${"cl-usergone"}
    `

    console.log("\nthe sweep")
    const run1 = await runCron()

    await check("the cron authorises and reports what it archived", () => {
      assert.equal(run1.status, 200)
      assert.equal(run1.json.archived, 1, `expected 1 archived, got ${JSON.stringify(run1.json)}`)
      assert.equal(run1.json.olderThanYears, 4)
    })

    await check("a 5-year-old trade is archived, not deleted", async () => {
      const row = await state("cl-ancient")
      assert.ok(row, "the row was destroyed instead of archived")
      assert.ok(row.deleted_at !== null, "the row was not archived")
    })

    await check("a 3-year-old trade is left completely alone (4y cutoff, not 2y)", async () => {
      const row = await state("cl-middle")
      assert.ok(row, "a 3-year-old trade was removed — cutoff is still 2 years")
      assert.equal(row.deleted_at, null, "a 3-year-old trade was archived — cutoff is still 2 years")
    })

    await check("a recent trade is untouched", async () => {
      const row = await state("cl-recent")
      assert.ok(row)
      assert.equal(row.deleted_at, null)
    })

    await check("the user's own deletion timestamp is not overwritten", async () => {
      const row = await state("cl-usergone")
      assert.ok(row, "the user's deleted trade was destroyed")
      assert.equal(
        row.deleted_at!.getTime(),
        new Date(userDeletedAt).getTime(),
        "the sweep stomped a timestamp it should have skipped"
      )
    })

    await check("another user's recent trade is untouched by the global sweep", async () => {
      const rows = await sql`
        SELECT deleted_at FROM cached_trades
        WHERE telegram_id = ${BigInt(OTHER_ID)} AND id = ${"cl-other-recent"}
      ` as { deleted_at: Date | null }[]
      assert.equal(rows.length, 1)
      assert.equal(rows[0].deleted_at, null)
    })

    await check("no real user's data was touched", async () => {
      assert.deepEqual(await realDataFingerprint(), before)
    })

    console.log("\nre-running the sweep")
    const run2 = await runCron()

    await check("a second run archives nothing", () => {
      assert.equal(run2.status, 200)
      assert.equal(run2.json.archived, 0, "the sweep is not idempotent")
    })

    await check("the archive timestamp is stable across runs", async () => {
      const first = await state("cl-ancient")
      await runCron()
      const third = await state("cl-ancient")
      // Dates are distinct objects, so compare the instant, not the reference.
      assert.equal(
        third!.deleted_at!.getTime(),
        first!.deleted_at!.getTime(),
        "re-archiving moved the timestamp"
      )
    })

    console.log("\nwhat an archived trade looks like to the app")

    await check("it is hidden from the dashboard feed", async () => {
      const { json } = await post("/api/trades-cache/all", { telegramId: USER_ID })
      const ids = (json.trades as { id: string }[]).map((t) => t.id)
      assert.ok(!ids.includes("cl-ancient"), "archived trade still on the dashboard")
      assert.ok(ids.includes("cl-middle"), "the 3-year-old trade vanished from the dashboard")
      assert.ok(ids.includes("cl-recent"))
    })

    // BEHAVIOUR CHANGE, asserted so it is deliberate rather than a surprise:
    // archived trades now sit in the same list as the user's own deletions.
    await check("it IS listed under the show-deleted toggle", async () => {
      const { json } = await post("/api/trades/deleted", { telegramId: USER_ID })
      const ids = (json.trades as { id: string }[]).map((t) => t.id)
      assert.ok(ids.includes("cl-ancient"), "archived trade is not recoverable from the UI")
    })

    await check("it is excluded from admin totals", async () => {
      await sql`
        INSERT INTO users (telegram_id, telegram_name, role)
        VALUES (${BigInt(OTHER_ID)}, ${"cleanup-admin"}, ${"ADMIN"}::user_role)
        ON CONFLICT (telegram_id) DO UPDATE SET role = ${"ADMIN"}::user_role
      `
      const res = await fetch(`${BASE}/api/admin/users?telegramId=${OTHER_ID}`)
      assert.equal(res.status, 200)
      const rows = await res.json() as { telegramId: string; tradeCount: number; totalPnl: number }[]
      const row = rows.find((r) => r.telegramId === USER_ID)
      assert.ok(row)
      // cl-middle (50) + cl-recent (25); cl-ancient and cl-usergone are deleted.
      assert.equal(row.tradeCount, 2, "admin count includes archived trades")
      assert.equal(row.totalPnl, 75, "admin PnL includes archived trades")
    })

    await check("it is excluded from a public share link", async () => {
      const token = "c1ea0000000000000000000000000000000000000000beef"
      await sql`UPDATE users SET share_token = ${token} WHERE telegram_id = ${BigInt(USER_ID)}`
      const res = await fetch(`${BASE}/api/share/${token}`)
      assert.equal(res.status, 200)
      const ids = ((await res.json()).trades as { id: string }[]).map((t) => t.id)
      assert.ok(!ids.includes("cl-ancient"), "share link leaked an archived trade")
      assert.ok(ids.includes("cl-middle"))
    })

    await check("a re-sync does not resurrect it", async () => {
      // Each trade keeps its real close time: upsertTrades refreshes close_time
      // from the payload, so re-syncing with a fabricated recent date would pull
      // an old trade back inside the archive window and mask the next assertion.
      const all = [
        { id: "cl-ancient", closeTime: yearsAgo(5) },
        { id: "cl-middle", closeTime: yearsAgo(3) },
        { id: "cl-recent", closeTime: yearsAgo(1) },
      ].map(({ id, closeTime }) => ({
        id, exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1, tp: null, sl: null,
        pnl: 1, openTime: closeTime, closeTime,
      }))
      const { status, json } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: EXCHANGE, trades: all,
      })
      assert.equal(status, 200)
      // deletedIds carries composite `exchange|id` keys (see tradeKey), which is
      // what the client feeds into filterDeleted.
      assert.ok(
        (json.deletedIds as string[]).includes(`${EXCHANGE}|cl-ancient`),
        `re-sync did not report the archived trade as hidden: ${JSON.stringify(json.deletedIds)}`
      )
      const row = await state("cl-ancient")
      assert.ok(row!.deleted_at !== null, "a re-sync un-archived the trade")
    })

    await check("check-ids still counts it as present, so a re-upload keeps it archived", async () => {
      const { json } = await post("/api/import/check-ids", {
        telegramId: USER_ID, ids: ["cl-ancient"],
      })
      assert.deepEqual(json.existingIds, ["cl-ancient"])
    })

    await check("the user can restore an archived trade", async () => {
      const { status } = await post("/api/trades/restore", {
        telegramId: USER_ID, exchange: EXCHANGE, id: "cl-ancient",
      })
      assert.equal(status, 200)
      const row = await state("cl-ancient")
      assert.equal(row!.deleted_at, null, "restore did not clear deleted_at")

      const { json } = await post("/api/trades-cache/all", { telegramId: USER_ID })
      const ids = (json.trades as { id: string }[]).map((t) => t.id)
      assert.ok(ids.includes("cl-ancient"), "a restored trade did not come back")
    })

    await check("the next sweep re-archives a restored-but-still-old trade", async () => {
      const run = await runCron()
      assert.equal(run.json.archived, 1)
      const row = await state("cl-ancient")
      assert.ok(row!.deleted_at !== null)
    })

    console.log("\nauthorisation")

    await check("no bearer is refused and archives nothing", async () => {
      await post("/api/trades/restore", { telegramId: USER_ID, exchange: EXCHANGE, id: "cl-ancient" })
      const res = await fetch(`${BASE}/api/cron/cleanup`)
      assert.equal(res.status, 401)
      assert.equal((await state("cl-ancient"))!.deleted_at, null, "an unauthorised call still swept")
    })

    await check("a wrong bearer is refused", async () => {
      const { status } = await runCron("Bearer not-the-secret")
      assert.equal(status, 401)
      assert.equal((await state("cl-ancient"))!.deleted_at, null)
    })

    console.log(`\n${passed} checks passed, ${failures.length} failed`)
    if (failures.length > 0) {
      console.log("\nfailed:")
      for (const f of failures) console.log(`  ✗ ${f}`)
      console.log("")
    }
  } finally {
    await teardown()
    console.log("teardown: removed synthetic users")
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err)
  process.exit(1)
})
