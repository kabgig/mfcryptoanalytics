/**
 * The futures journal's order type, its single note, and the two migrations
 * behind them (20260929000001 notes + entry_order, 20260929000002 delta → delta5),
 * against the real database and a running dev server.
 *
 * Two phases, because a migration can only be proved by data that existed
 * before it ran:
 *
 *   npm run test:futures-journal -- --seed   # BEFORE db:migrate: writes legacy rows
 *   npm run db:migrate
 *   npm run test:futures-journal             # verifies, then tears down
 *
 * Run the verify phase without migrating and it fails — that is the red half.
 *
 * Every check runs even after a failure, so a run against the old schema lists
 * everything that differs rather than stopping at the first.
 *
 * SAFETY: every write is scoped to two synthetic users, created and removed
 * here. The only unscoped statements are read-only (a count and two pure
 * expression evaluations over literal values).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getSql } from "@/lib/db"
import { signIn } from "./helpers/session.mjs"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const MIGRATOR = "990000000901"
const OTHER = "990000000902"
const URL_ = `${BASE}/api/trades/overrides`
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations")

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
  for (const id of [MIGRATOR, OTHER]) {
    const tid = BigInt(id)
    await sql`DELETE FROM public.trade_overrides WHERE telegram_id = ${tid}`
    await sql`DELETE FROM public.trade_notes     WHERE telegram_id = ${tid}`
    await sql`DELETE FROM public.users           WHERE telegram_id = ${tid}`
  }
}

// ------------------------------------------------------------------- seed

/**
 * Legacy rows in the shape the old code wrote: notes per phase in trade_notes,
 * `delta` in the signals column. Written with columns that exist both before
 * and after the migration, so seeding cannot depend on which side it runs.
 */
async function seed() {
  await teardown()
  const tid = BigInt(MIGRATOR)
  await sql`INSERT INTO public.users (telegram_id, telegram_name) VALUES (${tid}, ${"migrator"})`

  // mig-1: notes only, two phases out of order in insertion — no journal row.
  await sql`INSERT INTO public.trade_notes (telegram_id, exchange, trade_id, phase, body)
            VALUES (${tid}, 'OKX', 'mig-1', 'after', ${'lesson, with "quotes"\nline two'})`
  await sql`INSERT INTO public.trade_notes (telegram_id, exchange, trade_id, phase, body)
            VALUES (${tid}, 'OKX', 'mig-1', 'before', 'plan A')`
  // Same id on another exchange: must stay a separate note.
  await sql`INSERT INTO public.trade_notes (telegram_id, exchange, trade_id, phase, body)
            VALUES (${tid}, 'Bybit', 'mig-1', 'before', 'bybit plan')`

  // mig-2: a journal row with `delta` in the middle, plus a during note.
  await sql`INSERT INTO public.trade_overrides (telegram_id, exchange, trade_id, strategy, signals)
            VALUES (${tid}, 'OKX', 'mig-2', 'pa', 'at_level|delta|sweep')`
  await sql`INSERT INTO public.trade_notes (telegram_id, exchange, trade_id, phase, body)
            VALUES (${tid}, 'OKX', 'mig-2', 'during', 'held')`

  // mig-3: `delta` alone. mig-4: control — no delta, no note, must not change.
  await sql`INSERT INTO public.trade_overrides (telegram_id, exchange, trade_id, signals)
            VALUES (${tid}, 'OKX', 'mig-3', 'delta')`
  await sql`INSERT INTO public.trade_overrides (telegram_id, exchange, trade_id, signals)
            VALUES (${tid}, 'OKX', 'mig-4', 'ask5|diff_channel')`

  console.log(`seeded legacy rows for ${MIGRATOR} — now run db:migrate, then this without --seed`)
}

// ----------------------------------------------------------------- verify

type Row = Record<string, unknown>

async function stored(exchange: string, tradeId: string, telegramId = MIGRATOR): Promise<Row | undefined> {
  const rows = (await sql`
    SELECT * FROM public.trade_overrides
    WHERE telegram_id = ${BigInt(telegramId)} AND exchange = ${exchange} AND trade_id = ${tradeId}
  `) as Row[]
  return rows[0]
}

/**
 * The `SET signals = <expr>` expression of one half of the delta migration,
 * lifted verbatim from the file so the test cannot drift from what dbmate runs.
 */
function signalsExpression(half: "up" | "down"): string {
  const text = readFileSync(`${MIGRATIONS}/20260929000002_split_delta_signal.sql`, "utf8")
  const [up, down] = text.split("-- migrate:down")
  const section = half === "up" ? up : down
  const match = section.match(/SET signals = ([\s\S]*?)\n WHERE/)
  if (!match) throw new Error(`no SET signals expression in the ${half} half`)
  return match[1]
}

/** Applies a migration expression to a literal value — a pure SELECT, no table. */
async function evaluate(expression: string, signals: string): Promise<string> {
  const rows = (await sql.query(
    `SELECT ${expression} AS out FROM (VALUES ($1::text)) AS v(signals)`,
    [signals]
  )) as { out: string }[]
  return rows[0].out
}

type Res = { status: number; json: Record<string, unknown> }

function client(cookie: string) {
  return async (body: unknown, raw?: string): Promise<Res> => {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: raw ?? JSON.stringify(body),
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, json }
  }
}

async function verify() {
  try {
    console.log("\n20260929000001 — notes folded into one field")
    await check("a notes-only trade gained a row holding just the merged note", async () => {
      const row = await stored("OKX", "mig-1")
      assert.ok(row, "no trade_overrides row was created")
      assert.equal(row.notes, 'Before:\nplan A\n\nAfter:\nlesson, with "quotes"\nline two')
      assert.equal(row.strategy, null)
      assert.equal(row.signals, null)
      assert.equal(row.entry_order, null)
    })
    await check("phases are ordered before → during → after, not by insertion", async () => {
      const notes = String((await stored("OKX", "mig-1"))?.notes)
      assert.ok(notes.indexOf("Before:") < notes.indexOf("After:"), notes)
    })
    await check("a note on an existing journal row is added without touching the rest", async () => {
      const row = await stored("OKX", "mig-2")
      assert.equal(row?.notes, "During:\nheld")
      assert.equal(row?.strategy, "pa")
    })
    await check("the same trade id on another exchange keeps its own note", async () => {
      assert.equal((await stored("Bybit", "mig-1"))?.notes, "Before:\nbybit plan")
    })
    await check("a trade with no legacy notes gets none", async () => {
      assert.equal((await stored("OKX", "mig-4"))?.notes, null)
    })
    await check("trade_notes is left intact — it is the rollback", async () => {
      const rows = (await sql`
        SELECT count(*)::int AS n FROM public.trade_notes WHERE telegram_id = ${BigInt(MIGRATOR)}
      `) as { n: number }[]
      assert.equal(rows[0].n, 4)
    })

    console.log("\n20260929000001 — constraints")
    await check("entry_order accepts only limit and market", async () => {
      const tid = BigInt(MIGRATOR)
      await sql`UPDATE public.trade_overrides SET entry_order = 'market'
                WHERE telegram_id = ${tid} AND trade_id = 'mig-4'`
      await assert.rejects(
        sql`UPDATE public.trade_overrides SET entry_order = 'stop'
            WHERE telegram_id = ${tid} AND trade_id = 'mig-4'`,
        /entry_order_chk/
      )
      await sql`UPDATE public.trade_overrides SET entry_order = NULL
                WHERE telegram_id = ${tid} AND trade_id = 'mig-4'`
    })
    await check("a blank note is refused by the database", async () => {
      await assert.rejects(
        sql`UPDATE public.trade_overrides SET notes = '   '
            WHERE telegram_id = ${BigInt(MIGRATOR)} AND trade_id = 'mig-4'`,
        /notes_chk/
      )
    })
    await check("a row carrying nothing at all is still refused", async () => {
      await assert.rejects(
        sql`UPDATE public.trade_overrides SET notes = NULL
            WHERE telegram_id = ${BigInt(MIGRATOR)} AND exchange = 'OKX' AND trade_id = 'mig-1'`,
        /empty_chk/
      )
    })

    console.log("\n20260929000002 — delta → delta5")
    await check("delta in the middle of a list became delta5 in the same slot", async () => {
      assert.equal((await stored("OKX", "mig-2"))?.signals, "at_level|delta5|sweep")
    })
    await check("a lone delta became delta5", async () => {
      assert.equal((await stored("OKX", "mig-3"))?.signals, "delta5")
    })
    await check("a list without delta was not rewritten", async () => {
      assert.equal((await stored("OKX", "mig-4"))?.signals, "ask5|diff_channel")
    })
    await check("no row in the table still carries a bare delta tag", async () => {
      const rows = (await sql`
        SELECT count(*)::int AS n FROM public.trade_overrides
        WHERE signals IS NOT NULL AND 'delta' = ANY (string_to_array(signals, '|'))
      `) as { n: number }[]
      assert.equal(rows[0].n, 0)
    })
    await check("the up expression renames the tag, not a substring", async () => {
      const up = signalsExpression("up")
      assert.equal(await evaluate(up, "delta"), "delta5")
      assert.equal(await evaluate(up, "delta1_5|delta5"), "delta1_5|delta5")
      assert.equal(await evaluate(up, "at_level|delta|sweep"), "at_level|delta5|sweep")
    })
    await check("the down expression folds both thresholds back into one delta", async () => {
      const down = signalsExpression("down")
      assert.equal(await evaluate(down, "delta5"), "delta")
      assert.equal(await evaluate(down, "at_level|delta1_5|delta5|sweep"), "at_level|delta|sweep")
      assert.equal(await evaluate(down, "ask1_5|ask5"), "ask1_5|ask5")
    })

    console.log("\nthe route, against migrated data")
    const cookie = await signIn(BASE, MIGRATOR, "migrator")
    const post = client(cookie)
    const getAll = async () => {
      const res = await fetch(URL_, { headers: { cookie } })
      return ((await res.json()) as { overrides: Record<string, Record<string, unknown>> }).overrides
    }

    await check("GET serves the migrated note and the renamed signal", async () => {
      const all = await getAll()
      assert.equal(all["OKX|mig-1"]?.notes, 'Before:\nplan A\n\nAfter:\nlesson, with "quotes"\nline two')
      assert.deepEqual(all["OKX|mig-2"]?.signals, ["at_level", "delta5", "sweep"])
      assert.equal(all["OKX|mig-2"]?.notes, "During:\nheld")
    })
    await check("a note and an order type save and read back", async () => {
      const res = await post({ exchange: "OKX", id: "api-1", notes: "  line one, a comma\nline two  ", entryOrder: "limit" })
      assert.equal(res.status, 200, JSON.stringify(res.json))
      const row = await stored("OKX", "api-1")
      assert.equal(row?.notes, "line one, a comma\nline two")
      assert.equal(row?.entry_order, "limit")
    })
    await check("the new signals are accepted, in vocabulary order", async () => {
      const res = await post({ exchange: "OKX", id: "api-1", signals: ["delta5", "ask1_5", "delta1_5"] })
      assert.equal(res.status, 200, JSON.stringify(res.json))
      assert.equal((await stored("OKX", "api-1"))?.signals, "ask1_5|delta1_5|delta5")
    })
    await check("saving other fields leaves the note alone", async () => {
      assert.equal((await stored("OKX", "api-1"))?.notes, "line one, a comma\nline two")
    })
    await check("clearing the note keeps a row that still has content", async () => {
      assert.equal((await post({ exchange: "OKX", id: "api-1", notes: "" })).status, 200)
      const row = await stored("OKX", "api-1")
      assert.equal(row?.notes, null)
      assert.equal(row?.entry_order, "limit")
    })
    await check("clearing the note on a notes-only row deletes the row", async () => {
      const res = await post({ exchange: "OKX", id: "mig-1", notes: null })
      assert.equal(res.status, 200)
      assert.equal(res.json.override, null)
      assert.equal(await stored("OKX", "mig-1"), undefined)
    })

    console.log("\nvalidation")
    for (const [name, body, status] of [
      ["the retired delta tag", { exchange: "OKX", id: "v", signals: ["delta"] }, 400],
      ["an unknown order type", { exchange: "OKX", id: "v", entryOrder: "stop" }, 400],
      ["a non-string note", { exchange: "OKX", id: "v", notes: 42 }, 400],
      ["a note over the cap", { exchange: "OKX", id: "v", notes: "x".repeat(16_001) }, 400],
      ["a non-string id", { exchange: "OKX", id: 7, notes: "x" }, 400],
      ["an array body", [{ exchange: "OKX", id: "v" }], 400],
    ] as [string, unknown, number][]) {
      await check(`${name} is refused with ${status}`, async () => {
        const res = await post(body)
        assert.equal(res.status, status, JSON.stringify(res.json))
        assert.equal(typeof res.json.error, "string")
      })
    }
    await check("a note at exactly the cap is accepted", async () => {
      const res = await post({ exchange: "OKX", id: "api-cap", notes: "y".repeat(16_000) })
      assert.equal(res.status, 200, JSON.stringify(res.json))
      assert.equal(String((await stored("OKX", "api-cap"))?.notes).length, 16_000)
    })
    await check("malformed JSON is a 400, not a 500", async () => {
      assert.equal((await post(undefined, "{not json")).status, 400)
    })
    await check("a body over 64 KB is refused with 413 before it is read", async () => {
      const res = await post({ exchange: "OKX", id: "v", notes: "z".repeat(70_000) })
      assert.equal(res.status, 413)
    })
    await check("nothing was written by a refused request", async () => {
      assert.equal(await stored("OKX", "v"), undefined)
    })

    console.log("\nownership and the removed route")
    await check("another user never sees this user's note", async () => {
      const otherCookie = await signIn(BASE, OTHER, "other")
      const res = await fetch(URL_, { headers: { cookie: otherCookie } })
      const text = await res.text()
      assert.equal(res.status, 200)
      assert.equal(text.includes("line one"), false)
      assert.equal(text.includes("plan A"), false)
      // And writing the same trade id lands on their own row, not this one.
      const w = await client(otherCookie)({ exchange: "OKX", id: "api-1", notes: "other's note" })
      assert.equal(w.status, 200)
      assert.equal((await stored("OKX", "api-1", OTHER))?.notes, "other's note")
      assert.equal((await stored("OKX", "api-1"))?.notes, null)
    })
    await check("/api/trades/notes is gone for a signed-in user", async () => {
      const res = await fetch(`${BASE}/api/trades/notes`, { headers: { cookie } })
      assert.equal(res.status, 404)
    })
  } finally {
    await teardown()
    console.log("\nteardown: synthetic users removed")
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
}

;(process.argv.includes("--seed") ? seed() : verify()).catch((err) => {
  console.error(err)
  process.exit(1)
})
