/**
 * End-to-end check of trade soft delete against a running dev server and the
 * real database.
 *
 * SAFETY: everything is scoped to TEST_TELEGRAM_ID, a synthetic user created and
 * removed by this script. It never reads or writes another user's rows. Teardown
 * runs in a finally block, and re-running the script cleans up any leftovers
 * from a crashed previous run before it starts.
 *
 *   npm run dev            # in another terminal
 *   npm run test:integration
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"
import type { Trade } from "@/types"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000000001"
// The share route only accepts 48 hex chars (see app/api/share/[token]/route.ts).
const TEST_SHARE_TOKEN = "5d1e7e57000000000000000000000000000000000000dead"
const EXCHANGE = "OKX"

const sql = getSql()

const TRADES: Trade[] = [
  {
    id: "sd-test-1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1,
    tp: null, sl: null, pnl: 100,
    openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
  },
  {
    id: "sd-test-2", exchange: EXCHANGE, ticker: "ETHUSDT", positionSize: 2,
    tp: null, sl: null, pnl: -50,
    openTime: "2026-08-02T00:00:00.000Z", closeTime: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "sd-test-3", exchange: EXCHANGE, ticker: "XRPUSDT", positionSize: 3,
    tp: null, sl: null, pnl: 25,
    openTime: "2026-08-03T00:00:00.000Z", closeTime: "2026-08-04T00:00:00.000Z",
  },
]

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

async function visibleTrades(): Promise<Trade[]> {
  const { json } = await post("/api/trades-cache/all", { telegramId: TEST_TELEGRAM_ID })
  return (json.trades ?? []) as Trade[]
}

async function deletedTrades(): Promise<Trade[]> {
  const { json } = await post("/api/trades/deleted", { telegramId: TEST_TELEGRAM_ID })
  return (json.trades ?? []) as Trade[]
}

async function teardown() {
  const tid = BigInt(TEST_TELEGRAM_ID)
  await sql`DELETE FROM cached_trades      WHERE telegram_id = ${tid}`
  await sql`DELETE FROM exchange_fetch_log WHERE telegram_id = ${tid}`
  await sql`DELETE FROM users             WHERE telegram_id = ${tid}`
}

async function main() {
  // Clean slate, in case a previous run died before its teardown.
  await teardown()

  try {
    console.log("\nsetup")
    const seed = await post("/api/trades-store", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, trades: TRADES,
    })
    assert.equal(seed.status, 200, `seed failed: ${JSON.stringify(seed.json)}`)
    await sql`
      UPDATE users SET share_token = ${TEST_SHARE_TOKEN}
      WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
    `
    console.log(`  seeded ${TRADES.length} trades for synthetic user ${TEST_TELEGRAM_ID}`)

    console.log("\nbaseline")
    await check("all 3 trades are visible", async () => {
      assert.equal((await visibleTrades()).length, 3)
    })
    await check("nothing is deleted yet", async () => {
      assert.equal((await deletedTrades()).length, 0)
    })

    console.log("\ndelete")
    const del = await post("/api/trades/delete", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: "sd-test-2",
    })
    await check("delete returns ok", () => assert.equal(del.status, 200))

    const afterDelete = await visibleTrades()
    await check("deleted trade is gone from the dashboard feed", () => {
      assert.equal(afterDelete.length, 2)
      assert.ok(!afterDelete.some((t) => t.id === "sd-test-2"))
    })

    const nowDeleted = await deletedTrades()
    await check("deleted trade is listed by /api/trades/deleted", () => {
      assert.equal(nowDeleted.length, 1)
      assert.equal(nowDeleted[0].id, "sd-test-2")
      assert.equal(nowDeleted[0].pnl, -50, "full row is returned, so the UI can render it")
    })

    console.log("\nre-sync (the case soft delete exists for)")
    const resync = await post("/api/trades-store", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, trades: TRADES,
    })
    await check("re-syncing all 3 trades does NOT resurrect the deleted one", async () => {
      assert.equal(resync.status, 200)
      assert.equal((await visibleTrades()).length, 2, "deleted trade came back after re-sync")
    })

    await check("store response hands back deletedIds for the client-fetch path", () => {
      assert.deepEqual(resync.json.deletedIds, [`${EXCHANGE}|sd-test-2`])
    })

    const importPath = await post("/api/import/trades", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE,
    })
    await check("import feed also hides the deleted trade", () => {
      assert.equal((importPath.json.trades as Trade[]).length, 2)
    })

    const checkIds = await post("/api/import/check-ids", {
      telegramId: TEST_TELEGRAM_ID, ids: TRADES.map((t) => t.id),
    })
    await check("check-ids still reports the deleted trade as existing (re-upload keeps it deleted)", () => {
      assert.ok((checkIds.json.existingIds as string[]).includes("sd-test-2"))
    })

    console.log("\nother read paths")
    const shareRes = await fetch(`${BASE}/api/share/${TEST_SHARE_TOKEN}`)
    const shareJson = await shareRes.json() as { trades: Trade[] }
    await check("public share link hides the deleted trade", () => {
      assert.equal(shareRes.status, 200)
      assert.equal(shareJson.trades.length, 2)
      assert.ok(!shareJson.trades.some((t) => t.id === "sd-test-2"))
    })

    const adminRes = await fetch(`${BASE}/api/admin/users`)
    const adminJson = await adminRes.json() as { telegramId: string; tradeCount: number; totalPnl: number }[]
    const row = adminJson.find((u) => u.telegramId === TEST_TELEGRAM_ID)
    await check("admin counts and total PnL exclude the deleted trade", () => {
      assert.ok(row, "test user missing from admin list")
      assert.equal(row!.tradeCount, 2)
      assert.equal(row!.totalPnl, 125) // 100 + 25, the -50 is deleted
    })

    console.log("\ncache freshness (JOIN-vs-WHERE regression guard)")
    for (const t of TRADES) {
      await post("/api/trades/delete", { telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: t.id })
    }
    const allDeleted = await post("/api/trades-cache", {
      telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE,
    })
    await check("cache still reads as fresh when every trade is deleted", () => {
      assert.equal(allDeleted.json.fresh, true, "would re-hit the exchange on every page load")
      assert.equal((allDeleted.json.trades as Trade[]).length, 0)
    })

    console.log("\nrestore")
    for (const t of TRADES) {
      const res = await post("/api/trades/restore", {
        telegramId: TEST_TELEGRAM_ID, exchange: EXCHANGE, id: t.id,
      })
      assert.equal(res.status, 200)
    }
    const restored = await visibleTrades()
    await check("all trades are visible again after restore", async () => {
      assert.equal(restored.length, 3)
      assert.equal(restored.reduce((s, t) => s + t.pnl, 0), 75)
      assert.equal((await deletedTrades()).length, 0)
    })

    console.log("\nscoping")
    const wrongUser = await post("/api/trades/delete", {
      telegramId: "990000009999", exchange: EXCHANGE, id: "sd-test-1",
    })
    await check("deleting under a different telegramId does not touch this user's trade", async () => {
      assert.equal(wrongUser.status, 404)
      assert.equal((await visibleTrades()).length, 3)
    })

    const wrongExchange = await post("/api/trades/delete", {
      telegramId: TEST_TELEGRAM_ID, exchange: "Bybit", id: "sd-test-1",
    })
    await check("deleting with the wrong exchange is a 404, not a cross-exchange hit", async () => {
      assert.equal(wrongExchange.status, 404)
      assert.equal((await visibleTrades()).length, 3)
    })
  } finally {
    await teardown()
    console.log("\nteardown: synthetic user removed")
  }

  console.log(`\n✓ ${passed} checks passed\n`)
}

main().catch((err) => {
  console.error("\n✗ integration test failed:\n", err)
  process.exit(1)
})
