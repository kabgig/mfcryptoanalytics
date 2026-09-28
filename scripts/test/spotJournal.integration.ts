/**
 * The spot journal (PATCH /api/spot/entries?id=) against a running dev server
 * and the real database.
 *
 * Covers auth and ownership, validation, the stored shape of each field, and the
 * neighbouring flows the journal must not disturb: GET returns it, PUT (amounts)
 * keeps it and returns it, POST starts empty, DELETE still soft-deletes, and a
 * row written before the journal existed reads back as an empty journal.
 *
 * Every check runs even after a failure, so a run against the old code lists
 * everything that changed rather than stopping at the first difference.
 *
 * SAFETY: everything is scoped to two synthetic users, created and removed here.
 *
 *   npm run dev            # in another terminal
 *   npm run test:spot-journal
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"
import { signIn } from "./helpers/session.mjs"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const ALICE = "990000000801"
const BOB = "990000000802"
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

type DbRow = {
  qty: number; price: number; deleted_at: Date | null
  planned: boolean | null; why: string | null; feeling: string | null; note: string | null
}

async function row(id: string): Promise<DbRow> {
  const rows = (await sql`
    SELECT qty::float8 AS qty, price::float8 AS price, deleted_at,
           planned, why, feeling, note
    FROM public.spot_entries WHERE id = ${BigInt(id)}
  `) as DbRow[]
  return rows[0]
}

const EMPTY = { planned: null, why: [], feeling: [], note: "" }
const FULL = { planned: true, why: ["dip", "dca"], feeling: ["fomo", "calm"], note: "  line one, with a comma\nline two  " }
const day = (d: string) => `${d}T12:00:00.000Z`
const journalOf = (r: Res) => (r.json.entry as { journal?: unknown } | undefined)?.journal

async function main() {
  await teardown()
  const anon = client(null)
  const alice = client(await signIn(BASE, ALICE, "spot-journal-alice"))
  const bob = client(await signIn(BASE, BOB, "spot-journal-bob"))

  try {
    console.log("\nsetup: Alice buys 2 BTC")
    const buy = await alice("POST", "", { ticker: "BTC", side: "BUY", qty: 2, price: 100, tradedAt: day("2026-03-01") })
    assert.equal(buy.status, 200, `setup buy failed: ${JSON.stringify(buy.json)}`)
    const buyId = (buy.json.entry as { id: string }).id

    await check("a new entry comes back from POST with an empty journal", () => {
      assert.deepEqual(journalOf(buy), EMPTY)
    })

    // ---------------------------------------------------------- auth
    console.log("\nPATCH: auth and ownership")

    await check("PATCH without a session is 401", async () => {
      assert.equal((await anon("PATCH", `?id=${buyId}`, FULL)).status, 401)
    })

    await check("Bob journalling Alice's row is 404 and writes nothing", async () => {
      assert.equal((await bob("PATCH", `?id=${buyId}`, FULL)).status, 404)
      const db = await row(buyId)
      assert.deepEqual([db.planned, db.why, db.feeling, db.note], [null, null, null, null])
    })

    await check("an id that does not exist is 404", async () => {
      assert.equal((await alice("PATCH", "?id=999999999999", FULL)).status, 404)
    })

    for (const [label, query] of [
      ["missing id", ""], ["non-numeric id", "?id=abc"], ["fractional id", "?id=1.5"], ["zero id", "?id=0"],
    ]) {
      await check(`${label} is 400`, async () => {
        assert.equal((await alice("PATCH", query, FULL)).status, 400)
      })
    }

    // ---------------------------------------------------------- validation
    console.log("\nPATCH: validation")

    for (const [label, body] of [
      ["an unknown why tag", { ...FULL, why: ["moon"] }],
      ["an unknown feeling tag", { ...FULL, feeling: ["greed"] }],
      ["a repeated tag", { ...FULL, why: ["dca", "dca"] }],
      ["why as a string", { ...FULL, why: "dca" }],
      ["planned as a string", { ...FULL, planned: "yes" }],
      ["a missing note", { planned: true, why: [], feeling: [] }],
      ["a note of 4001 characters", { ...FULL, note: "x".repeat(4001) }],
      ["an empty object", {}],
    ] as [string, unknown][]) {
      await check(`${label} is 400 and the row is unchanged`, async () => {
        const r = await alice("PATCH", `?id=${buyId}`, body)
        assert.equal(r.status, 400, `got ${r.status}`)
        assert.equal(typeof r.json.error, "string")
        assert.equal((await row(buyId)).planned, null)
      })
    }

    await check("malformed JSON, null and an array body are 400", async () => {
      assert.equal((await alice("PATCH", `?id=${buyId}`, "{nope")).status, 400)
      assert.equal((await alice("PATCH", `?id=${buyId}`, "null")).status, 400)
      assert.equal((await alice("PATCH", `?id=${buyId}`, [1, 2])).status, 400)
    })

    await check("a body over 32 KB is 413", async () => {
      assert.equal((await alice("PATCH", `?id=${buyId}`, { ...FULL, pad: "x".repeat(40_000) })).status, 413)
    })

    // ---------------------------------------------------------- saving
    console.log("\nPATCH: saving")

    await check("a full journal saves, normalized, and comes back on the entry", async () => {
      const r = await alice("PATCH", `?id=${buyId}`, FULL)
      assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.json)}`)
      assert.deepEqual(journalOf(r), {
        planned: true, why: ["dca", "dip"], feeling: ["calm", "fomo"],
        note: "line one, with a comma\nline two",
      })
      const db = await row(buyId)
      assert.equal(db.planned, true)
      assert.equal(db.why, "dca|dip")
      assert.equal(db.feeling, "calm|fomo")
      assert.equal(db.note, "line one, with a comma\nline two")
    })

    await check("amounts in a PATCH body are ignored", async () => {
      assert.equal((await alice("PATCH", `?id=${buyId}`, { ...FULL, qty: 99, price: 1 })).status, 200)
      const db = await row(buyId)
      assert.equal(db.qty, 2)
      assert.equal(db.price, 100)
    })

    await check("a note of exactly 4000 characters is accepted", async () => {
      const r = await alice("PATCH", `?id=${buyId}`, { ...FULL, note: "é".repeat(4000) })
      assert.equal(r.status, 200, `got ${r.status}`)
      assert.equal((await row(buyId)).note?.length, 4000)
    })

    await check("planned=false is stored as false, not as unset", async () => {
      assert.equal((await alice("PATCH", `?id=${buyId}`, { ...EMPTY, planned: false })).status, 200)
      assert.equal((await row(buyId)).planned, false)
    })

    await check("clearing every field stores NULLs and reads back empty", async () => {
      const r = await alice("PATCH", `?id=${buyId}`, { ...EMPTY, note: "   " })
      assert.equal(r.status, 200)
      assert.deepEqual(journalOf(r), EMPTY)
      const db = await row(buyId)
      assert.deepEqual([db.planned, db.why, db.feeling, db.note], [null, null, null, null])
    })

    // ---------------------------------------------------------- neighbours
    console.log("\nneighbouring flows keep the journal")

    await alice("PATCH", `?id=${buyId}`, FULL)

    await check("GET returns the journal on each entry", async () => {
      const entries = (await alice("GET")).json.entries as { id: string; journal: unknown }[]
      assert.deepEqual(entries.find((e) => e.id === buyId)?.journal, {
        planned: true, why: ["dca", "dip"], feeling: ["calm", "fomo"],
        note: "line one, with a comma\nline two",
      })
    })

    await check("PUT (editing amounts) keeps the journal and returns it", async () => {
      const r = await alice("PUT", `?id=${buyId}`, { qty: 3, price: 110 })
      assert.equal(r.status, 200)
      assert.equal((journalOf(r) as { planned: boolean }).planned, true,
        "the edited entry must carry its journal, or the icon blanks until reload")
      const db = await row(buyId)
      assert.equal(db.qty, 3)
      assert.equal(db.why, "dca|dip")
    })

    await check("a row written before the journal existed reads as an empty journal", async () => {
      const inserted = (await sql`
        INSERT INTO public.spot_entries (telegram_id, ticker, side, qty, price, traded_at)
        VALUES (${BigInt(ALICE)}, 'ETH', 'BUY', 1, 10, ${day("2026-02-01")})
        RETURNING id
      `) as { id: string }[]
      const entries = (await alice("GET")).json.entries as { id: string; journal: unknown }[]
      assert.deepEqual(entries.find((e) => e.id === String(inserted[0].id))?.journal, EMPTY)
    })

    await check("Bob sees none of Alice's entries or journals", async () => {
      assert.deepEqual((await bob("GET")).json.entries, [])
    })

    await check("DELETE soft-deletes the row and the journal stays on it", async () => {
      assert.equal((await alice("DELETE", `?id=${buyId}`)).status, 200)
      const db = await row(buyId)
      assert.notEqual(db.deleted_at, null)
      assert.equal(db.why, "dca|dip")
    })

    await check("a soft-deleted row cannot be journalled (404)", async () => {
      assert.equal((await alice("PATCH", `?id=${buyId}`, EMPTY)).status, 404)
      assert.equal((await row(buyId)).planned, true)
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
