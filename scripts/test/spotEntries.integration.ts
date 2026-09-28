/**
 * /api/spot/entries against a running dev server and the real database.
 *
 * Covers the edit endpoint (PUT: amounts only, ownership, validation) and the
 * date-aware oversell rule: a SELL may only take what was held on its own
 * date, adding or enlarging one past that is rejected, and shrinking a BUY is
 * allowed even when it strands a later SELL (the table flags that SELL).
 *
 * Every check runs even after a failure, so a run against the old code lists
 * everything that changed rather than stopping at the first difference.
 *
 * SAFETY: everything is scoped to two synthetic users, created and removed here.
 *
 *   npm run dev            # in another terminal
 *   npm run test:spot
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"
import { signIn } from "./helpers/session.mjs"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const ALICE = "990000000701"
const BOB = "990000000702"
const URL_ = `${BASE}/api/spot/entries`

const sql = getSql()

let passed = 0
const failures: string[] = []

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (err) {
    failures.push(`${name} — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)
    console.log(`  ✗ ${name}`)
    return
  }
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  for (const id of [ALICE, BOB]) {
    const tid = BigInt(id)
    await sql`DELETE FROM public.spot_entries WHERE telegram_id = ${tid}`
    await sql`DELETE FROM public.users        WHERE telegram_id = ${tid}`
  }
}

type Res = { status: number; json: Record<string, unknown> }

function client(cookie: string | null) {
  return async (method: string, query = "", body?: unknown): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (cookie) headers.cookie = cookie
    const res = await fetch(`${URL_}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, json }
  }
}

async function row(id: string) {
  const rows = (await sql`
    SELECT ticker, side, qty::float8 AS qty, price::float8 AS price,
           traded_at, deleted_at
    FROM public.spot_entries WHERE id = ${BigInt(id)}
  `) as { ticker: string; side: string; qty: number; price: number; traded_at: Date; deleted_at: Date | null }[]
  return rows[0]
}

async function liveCount(telegramId: string) {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM public.spot_entries
    WHERE telegram_id = ${BigInt(telegramId)} AND deleted_at IS NULL
  `) as { n: number }[]
  return rows[0].n
}

const day = (d: string) => `${d}T12:00:00.000Z`

async function main() {
  await teardown()
  const anon = client(null)
  const alice = client(await signIn(BASE, ALICE, "spot-alice"))
  const bob = client(await signIn(BASE, BOB, "spot-bob"))

  try {
    console.log("\nsetup: Alice buys 2 BTC on 2026-03-01")
    const buy = await alice("POST", "", { ticker: "BTC", side: "BUY", qty: 2, price: 100, tradedAt: day("2026-03-01") })
    assert.equal(buy.status, 200, `setup buy failed: ${JSON.stringify(buy.json)}`)
    const buyId = (buy.json.entry as { id: string }).id

    // ------------------------------------------------------------ POST rules
    console.log("\nPOST: a sell may only take what was held on its date")

    await check("a SELL dated before the buy is rejected (400), nothing written", async () => {
      const r = await alice("POST", "", { ticker: "BTC", side: "SELL", qty: 1, price: 150, tradedAt: day("2026-01-01") })
      assert.equal(r.status, 400, `got ${r.status}`)
      assert.match(String(r.json.error), /only 0 held on 2026-01-01/)
      assert.equal(await liveCount(ALICE), 1)
    })

    let sellId = ""
    await check("a SELL after the buy, within holdings, is accepted", async () => {
      const r = await alice("POST", "", { ticker: "BTC", side: "SELL", qty: 1, price: 150, tradedAt: day("2026-04-01") })
      assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.json)}`)
      sellId = (r.json.entry as { id: string }).id
    })

    await check("a SELL larger than holdings is still rejected", async () => {
      const r = await alice("POST", "", { ticker: "BTC", side: "SELL", qty: 5, price: 150, tradedAt: day("2026-05-01") })
      assert.equal(r.status, 400)
      assert.match(String(r.json.error), /only 1 held/)
    })

    await check("a same-day SELL may take a same-day BUY", async () => {
      const b = await alice("POST", "", { ticker: "ETH", side: "BUY", qty: 3, price: 10, tradedAt: day("2026-06-01") })
      const s = await alice("POST", "", { ticker: "ETH", side: "SELL", qty: 3, price: 12, tradedAt: day("2026-06-01") })
      assert.equal(b.status, 200)
      assert.equal(s.status, 200, `got ${s.status}: ${JSON.stringify(s.json)}`)
    })

    await check("POST with a malformed JSON body is 400, not 500", async () => {
      assert.equal((await alice("POST", "", "{not json")).status, 400)
    })

    // ------------------------------------------------------------- PUT: auth
    console.log("\nPUT: auth and ownership")

    await check("PUT without a session is 401", async () => {
      assert.equal((await anon("PUT", `?id=${buyId}`, { qty: 1, price: 1 })).status, 401)
    })

    await check("Bob editing Alice's row is 404 and changes nothing", async () => {
      const r = await bob("PUT", `?id=${buyId}`, { qty: 99, price: 1 })
      assert.equal(r.status, 404, `got ${r.status}`)
      const db = await row(buyId)
      assert.equal(db.qty, 2)
      assert.equal(db.price, 100)
    })

    await check("an id that does not exist is 404", async () => {
      assert.equal((await alice("PUT", "?id=999999999999", { qty: 1, price: 1 })).status, 404)
    })

    // ------------------------------------------------------- PUT: validation
    console.log("\nPUT: validation")

    for (const [label, query] of [
      ["missing id", ""], ["non-numeric id", "?id=abc"], ["fractional id", "?id=1.5"],
      ["zero id", "?id=0"], ["negative id", "?id=-1"],
    ]) {
      await check(`${label} is 400`, async () => {
        assert.equal((await alice("PUT", query, { qty: 1, price: 1 })).status, 400)
      })
    }

    for (const [label, body] of [
      ["qty 0", { qty: 0, price: 1 }], ["negative qty", { qty: -1, price: 1 }],
      ["non-numeric qty", { qty: "abc", price: 1 }], ["missing qty", { price: 1 }],
      ["qty as an object", { qty: { a: 1 }, price: 1 }], ["negative price", { qty: 1, price: -1 }],
      ["missing price", { qty: 1 }], ["Infinity price", { qty: 1, price: "Infinity" }],
    ] as [string, unknown][]) {
      await check(`${label} is 400 and the row is unchanged`, async () => {
        assert.equal((await alice("PUT", `?id=${buyId}`, body)).status, 400)
        assert.equal((await row(buyId)).qty, 2)
      })
    }

    await check("malformed JSON, null and an array body are 400", async () => {
      assert.equal((await alice("PUT", `?id=${buyId}`, "{nope")).status, 400)
      assert.equal((await alice("PUT", `?id=${buyId}`, "null")).status, 400)
      assert.equal((await alice("PUT", `?id=${buyId}`, [1, 2])).status, 400)
    })

    await check("a body over 32 KB is 413", async () => {
      const r = await alice("PUT", `?id=${buyId}`, { qty: 1, price: 1, pad: "x".repeat(40_000) })
      assert.equal(r.status, 413)
    })

    // ------------------------------------------------------------ PUT: edits
    console.log("\nPUT: editing amounts")

    await check("editing a BUY's amounts saves them and returns the entry", async () => {
      const r = await alice("PUT", `?id=${buyId}`, { qty: 3, price: 110 })
      assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.json)}`)
      const e = r.json.entry as { id: string; qty: number; price: number; ticker: string }
      assert.equal(e.id, buyId)
      assert.equal(e.qty, 3)
      assert.equal(e.price, 110)
      const db = await row(buyId)
      assert.equal(db.qty, 3)
      assert.equal(db.price, 110)
    })

    await check("ticker, side and date in the body are ignored", async () => {
      const r = await alice("PUT", `?id=${buyId}`, {
        qty: 3, price: 110, ticker: "DOGE", side: "SELL", tradedAt: day("2020-01-01"),
      })
      assert.equal(r.status, 200)
      const db = await row(buyId)
      assert.equal(db.ticker, "BTC")
      assert.equal(db.side, "BUY")
      assert.equal(db.traded_at.toISOString(), day("2026-03-01"))
    })

    await check("enlarging a SELL past what was held is 400, row unchanged", async () => {
      // 3 BTC held before the sell; asking for 4.
      const r = await alice("PUT", `?id=${sellId}`, { qty: 4, price: 150 })
      assert.equal(r.status, 400, `got ${r.status}`)
      assert.match(String(r.json.error), /only 3 held on 2026-04-01/)
      assert.equal((await row(sellId)).qty, 1)
    })

    await check("enlarging a SELL within holdings is accepted", async () => {
      assert.equal((await alice("PUT", `?id=${sellId}`, { qty: 3, price: 150 })).status, 200)
      assert.equal((await row(sellId)).qty, 3)
    })

    await check("shrinking a BUY that strands a later SELL is allowed", async () => {
      const r = await alice("PUT", `?id=${buyId}`, { qty: 0.5, price: 110 })
      assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.json)}`)
      assert.equal((await row(buyId)).qty, 0.5)
    })

    await check("a stranded SELL can still have its price corrected", async () => {
      const r = await alice("PUT", `?id=${sellId}`, { qty: 3, price: 160 })
      assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.json)}`)
      assert.equal((await row(sellId)).price, 160)
    })

    await check("a stranded SELL can be shrunk", async () => {
      assert.equal((await alice("PUT", `?id=${sellId}`, { qty: 2, price: 160 })).status, 200)
    })

    await check("a stranded SELL cannot be enlarged further", async () => {
      const r = await alice("PUT", `?id=${sellId}`, { qty: 2.5, price: 160 })
      assert.equal(r.status, 400)
      assert.equal((await row(sellId)).qty, 2)
    })

    // ------------------------------------------------------ neighbouring flows
    console.log("\nGET / DELETE still behave")

    await check("GET lists Alice's live entries with the edited values", async () => {
      const r = await alice("GET")
      assert.equal(r.status, 200)
      const entries = r.json.entries as { id: string; qty: number }[]
      assert.equal(entries.length, 4)
      assert.equal(entries.find((e) => e.id === buyId)?.qty, 0.5)
    })

    await check("Bob sees none of Alice's entries", async () => {
      assert.deepEqual((await bob("GET")).json.entries, [])
    })

    await check("Bob deleting Alice's row is 404", async () => {
      assert.equal((await bob("DELETE", `?id=${sellId}`)).status, 404)
      assert.equal((await row(sellId)).deleted_at, null)
    })

    await check("DELETE with a fractional id is 400, not 500", async () => {
      assert.equal((await alice("DELETE", "?id=1.5")).status, 400)
    })

    await check("DELETE soft-deletes the row", async () => {
      assert.equal((await alice("DELETE", `?id=${sellId}`)).status, 200)
      assert.notEqual((await row(sellId)).deleted_at, null)
    })

    await check("a soft-deleted row cannot be edited (404)", async () => {
      assert.equal((await alice("PUT", `?id=${sellId}`, { qty: 1, price: 1 })).status, 404)
    })
  } finally {
    await teardown()
    console.log(`\nteardown: removed synthetic users ${ALICE}, ${BOB}`)
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"))
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error("\nFAILED:", err)
  try { await teardown() } catch { /* best effort */ }
  process.exit(1)
})
