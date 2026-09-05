/**
 * End-to-end check of the Phase 1 security hardening against a running dev
 * server and the real database.
 *
 * SAFETY: every read and write is scoped to the two synthetic users below, both
 * created and removed by this script. Teardown runs in a finally block, and a
 * fresh run cleans up leftovers from a crashed previous one. Nothing here reads
 * or writes another user's rows.
 *
 *   npm run dev                 # in another terminal
 *   npm run test:security
 */
import assert from "node:assert/strict"
import { getSql } from "@/lib/db"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const ADMIN_ID = "990000000101"
const USER_ID = "990000000102"
const WEBHOOK_ID = "990000000103"
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""

const sql = getSql()

let passed = 0
const failures: string[] = []

/**
 * SECURITY_TEST_CONTINUE_ON_FAIL records failures instead of aborting, so a
 * red/green run against the pre-fix code shows which checks the change is
 * responsible for rather than stopping at the first one.
 */
const CONTINUE_ON_FAIL = Boolean(process.env.SECURITY_TEST_CONTINUE_ON_FAIL)

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (err) {
    if (!CONTINUE_ON_FAIL) throw err
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err)
    failures.push(`${name} — ${message}`)
    console.log(`  ✗ ${name}`)
    return
  }
  passed++
  console.log(`  ✓ ${name}`)
}

async function setup() {
  await teardown()
  await sql`
    INSERT INTO users (telegram_id, telegram_name, role)
    VALUES (${BigInt(ADMIN_ID)}, ${"sec-test-admin"}, ${"ADMIN"}::user_role)
  `
  await sql`
    INSERT INTO users (telegram_id, telegram_name, role)
    VALUES (${BigInt(USER_ID)}, ${"sec-test-user"}, ${"USER"}::user_role)
  `
}

async function teardown() {
  for (const id of [ADMIN_ID, USER_ID, WEBHOOK_ID]) {
    await sql`DELETE FROM users WHERE telegram_id = ${BigInt(id)}`
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { /* non-JSON body */ }
  return { status: res.status, json, text, headers: res.headers }
}

async function main() {
  if (!SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET must be set (run with --env-file=.env.local)")
  await setup()

  try {
    // ---------------------------------------------------------------- admin
    console.log("\nadmin/users authorization")

    await check("anonymous request is refused", async () => {
      const res = await fetch(`${BASE}/api/admin/users`)
      assert.equal(res.status, 403)
      const body = await res.text()
      assert.ok(!body.includes("sec-test-admin"), "leaked the user list")
      assert.ok(!body.includes("telegramId"), "leaked the user list")
    })

    await check("a non-admin telegramId is refused", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=${USER_ID}`)
      assert.equal(res.status, 403)
      const body = await res.text()
      assert.ok(!body.includes("sec-test-admin"), "leaked the user list")
    })

    await check("an unknown telegramId is refused", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=990000000999`)
      assert.equal(res.status, 403)
    })

    await check("a non-numeric telegramId is refused without touching the DB", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=' OR 1=1--`)
      assert.equal(res.status, 403)
    })

    await check("unknown and non-admin are indistinguishable", async () => {
      const [a, b] = await Promise.all([
        fetch(`${BASE}/api/admin/users?telegramId=${USER_ID}`).then((r) => r.text()),
        fetch(`${BASE}/api/admin/users?telegramId=990000000999`).then((r) => r.text()),
      ])
      assert.equal(a, b, "response distinguishes an existing user from an unknown one")
    })

    // REGRESSION: the feature still works for the person it is for.
    await check("an ADMIN telegramId still gets the full list", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=${ADMIN_ID}`)
      assert.equal(res.status, 200)
      const rows = await res.json() as { telegramId: string; role: string }[]
      assert.ok(Array.isArray(rows), "expected an array")
      const admin = rows.find((r) => r.telegramId === ADMIN_ID)
      assert.ok(admin, "admin's own row missing from the list")
      assert.equal(admin.role, "ADMIN")
      assert.ok(rows.find((r) => r.telegramId === USER_ID), "other users missing")
    })

    // -------------------------------------------------------------- webhook
    console.log("\ntelegram webhook authentication")

    const update = (id: string) => ({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: Number(id), first_name: "sec-test-webhook" },
        chat: { id: Number(id), type: "private" },
        text: "/start",
      },
    })

    const rowExists = async (id: string) => {
      const rows = await sql`
        SELECT 1 FROM users WHERE telegram_id = ${BigInt(id)}
      ` as unknown[]
      return rows.length > 0
    }

    await check("no secret header is rejected 401", async () => {
      const { status } = await post("/api/telegram/webhook", update(WEBHOOK_ID))
      assert.equal(status, 401)
    })

    await check("a rejected update creates no user row", async () => {
      assert.equal(await rowExists(WEBHOOK_ID), false, "forged update created a user")
    })

    await check("a wrong secret is rejected 401", async () => {
      const { status } = await post("/api/telegram/webhook", update(WEBHOOK_ID), {
        "x-telegram-bot-api-secret-token": "x".repeat(SECRET.length),
      })
      assert.equal(status, 401)
      assert.equal(await rowExists(WEBHOOK_ID), false)
    })

    await check("a truncated secret is rejected 401", async () => {
      const { status } = await post("/api/telegram/webhook", update(WEBHOOK_ID), {
        "x-telegram-bot-api-secret-token": SECRET.slice(0, -1),
      })
      assert.equal(status, 401)
    })

    await check("malformed JSON with a valid secret is a 400, not a 500", async () => {
      const { status } = await post("/api/telegram/webhook", "{not json", {
        "x-telegram-bot-api-secret-token": SECRET,
      })
      assert.equal(status, 400)
    })

    // REGRESSION: the real Telegram flow still works.
    await check("the correct secret is accepted and creates the user", async () => {
      const { status, json } = await post("/api/telegram/webhook", update(WEBHOOK_ID), {
        "x-telegram-bot-api-secret-token": SECRET,
      })
      assert.equal(status, 200)
      assert.equal(json.ok, true)
      assert.equal(await rowExists(WEBHOOK_ID), true, "valid update did not create the user")
    })

    await check("a non-/start update with a valid secret is still a no-op 200", async () => {
      const { status, json } = await post(
        "/api/telegram/webhook",
        { update_id: 2, message: { message_id: 2, chat: { id: 1, type: "private" }, text: "hello" } },
        { "x-telegram-bot-api-secret-token": SECRET }
      )
      assert.equal(status, 200)
      assert.equal(json.ok, true)
    })

    // -------------------------------------------------------- error leakage
    console.log("\nerror messages")

    const leaky = /SyntaxError|BigInt|NeonDbError|SELECT |INSERT |relation |column |at async|\.ts:\d+/

    for (const [path, body] of [
      ["/api/trades-cache", { telegramId: "not-a-number", exchange: "OKX" }],
      ["/api/trades-cache/all", { telegramId: "not-a-number" }],
      ["/api/trades/deleted", { telegramId: "not-a-number" }],
      ["/api/trades/delete", { telegramId: "not-a-number", exchange: "OKX", id: "x" }],
      ["/api/trades/restore", { telegramId: "not-a-number", exchange: "OKX", id: "x" }],
      ["/api/import/trades", { telegramId: "not-a-number", exchange: "OKX" }],
      ["/api/import/check-ids", { telegramId: "not-a-number", ids: ["x"] }],
    ] as [string, unknown][]) {
      await check(`${path} returns no internal detail`, async () => {
        const { status, json, text } = await post(path, body)
        assert.ok(status >= 400, `expected an error status, got ${status}`)
        assert.ok(!leaky.test(text), `leaked internals: ${text.slice(0, 200)}`)
        // REGRESSION: eight client call sites branch on `data.error`.
        assert.equal(typeof json.error, "string", "dropped the `error` key clients rely on")
      })
    }

    // ------------------------------------------------------------ body caps
    console.log("\nrequest size limits")

    const tinyTrade = (i: number) => ({
      id: `sec-${i}`, exchange: "OKX", ticker: "BTCUSDT", positionSize: 1,
      tp: null, sl: null, pnl: 0,
      // Deliberately unparseable: on the pre-fix code the first insert fails, so
      // a red run of this test writes no rows.
      openTime: "not-a-date", closeTime: "not-a-date",
    })

    await check("an over-cap body is refused 413 before parsing", async () => {
      const trades = Array.from({ length: 12_000 }, (_, i) => tinyTrade(i))
      const { status } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: "OKX", trades,
        padding: "x".repeat(4 * 1024 * 1024),
      })
      assert.equal(status, 413)
    })

    await check("an over-cap trade count is refused 413", async () => {
      const trades = Array.from({ length: 10_001 }, (_, i) => tinyTrade(i))
      const { status, json } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: "OKX", trades,
      })
      assert.equal(status, 413)
      assert.equal(typeof json.error, "string")
    })

    await check("nothing was written by the refused batches", async () => {
      const rows = await sql`
        SELECT 1 FROM cached_trades WHERE telegram_id = ${BigInt(USER_ID)}
      ` as unknown[]
      assert.equal(rows.length, 0, "an over-cap batch reached the database")
    })

    await check("an over-cap id list is refused 413", async () => {
      const ids = Array.from({ length: 10_001 }, (_, i) => `sec-${i}`)
      const { status } = await post("/api/import/check-ids", { telegramId: USER_ID, ids })
      assert.equal(status, 413)
    })

    // REGRESSION: a realistic import is still accepted end to end.
    await check("a normal-sized import still saves", async () => {
      const trades = Array.from({ length: 50 }, (_, i) => ({
        id: `sec-ok-${i}`, exchange: "OKX", ticker: "BTCUSDT", positionSize: 1,
        tp: null, sl: null, pnl: 1,
        openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
      }))
      const { status, json } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: "OKX", trades, skipExisting: true,
      })
      assert.equal(status, 200)
      assert.equal(json.saved, 50, "import under-reported what it wrote")

      const stored = await sql`
        SELECT id FROM cached_trades WHERE telegram_id = ${BigInt(USER_ID)}
      ` as { id: string }[]
      assert.equal(stored.length, 50, "a normal-sized import did not reach the DB")
    })

    // The skip half of skipExisting: a re-upload must report 0 new, not 0 total.
    await check("re-importing the same trades reports 0 saved and writes nothing", async () => {
      const trades = Array.from({ length: 50 }, (_, i) => ({
        id: `sec-ok-${i}`, exchange: "OKX", ticker: "BTCUSDT", positionSize: 1,
        tp: null, sl: null, pnl: 1,
        openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
      }))
      const { status, json } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: "OKX", trades, skipExisting: true,
      })
      assert.equal(status, 200)
      assert.equal(json.saved, 0, "a pure re-upload should save nothing")

      const stored = await sql`
        SELECT id FROM cached_trades WHERE telegram_id = ${BigInt(USER_ID)}
      ` as { id: string }[]
      assert.equal(stored.length, 50, "re-upload duplicated rows")
    })

    await check("a partial re-import counts only the genuinely new trades", async () => {
      // 40 already stored above, 10 new.
      const trades = Array.from({ length: 50 }, (_, i) => ({
        id: `sec-ok-${i + 40}`, exchange: "OKX", ticker: "BTCUSDT", positionSize: 1,
        tp: null, sl: null, pnl: 1,
        openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
      }))
      const { status, json } = await post("/api/trades-store", {
        telegramId: USER_ID, exchange: "OKX", trades, skipExisting: true,
      })
      assert.equal(status, 200)
      assert.equal(json.saved, 40, "expected only the 40 unseen ids to count")

      const stored = await sql`
        SELECT id FROM cached_trades WHERE telegram_id = ${BigInt(USER_ID)}
      ` as { id: string }[]
      assert.equal(stored.length, 90, "expected 50 + 40 distinct rows")

      const check2 = await post("/api/import/check-ids", {
        telegramId: USER_ID, ids: trades.map((t) => t.id),
      })
      assert.equal(check2.status, 200)
      assert.equal((check2.json.existingIds as string[]).length, 50)
    })

    // ------------------------------------------------------------- headers
    console.log("\nsecurity headers")

    const page = await fetch(`${BASE}/`)
    const expectHeader = (name: string, match: RegExp) =>
      check(`${name} is set on page responses`, () => {
        const value = page.headers.get(name)
        assert.ok(value, `${name} missing`)
        assert.match(value, match)
      })

    await expectHeader("strict-transport-security", /max-age=63072000/)
    await expectHeader("x-content-type-options", /nosniff/)
    await expectHeader("x-frame-options", /DENY/)
    await expectHeader("referrer-policy", /strict-origin-when-cross-origin/)
    await expectHeader("permissions-policy", /camera=\(\)/)
    await expectHeader("content-security-policy-report-only", /frame-ancestors 'none'/)

    await check("CSP is report-only, so nothing is enforced yet", () => {
      assert.equal(page.headers.get("content-security-policy"), null)
    })

    await check("API responses are marked no-store", async () => {
      const res = await fetch(`${BASE}/api/user/role?telegramId=${USER_ID}`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get("cache-control") ?? "", /no-store/)
    })

    await check("headers reach the share page too", async () => {
      const res = await fetch(`${BASE}/share/${"0".repeat(48)}`)
      assert.match(res.headers.get("x-frame-options") ?? "", /DENY/)
    })

    // -------------------------------------------------------------- robots
    console.log("\nrobots.txt")

    await check("robots.txt exists and hides the sensitive paths", async () => {
      const res = await fetch(`${BASE}/robots.txt`)
      assert.equal(res.status, 200)
      const body = await res.text()
      for (const path of ["/api/", "/admin", "/auth", "/share/", "/viz/share/"]) {
        assert.ok(body.includes(`Disallow: ${path}`), `robots.txt does not disallow ${path}`)
      }
      assert.ok(body.includes("Allow: /"), "landing page should stay crawlable")
    })

    // --------------------------------------------------- untouched neighbours
    console.log("\nregression: routes this change did not touch")

    await check("/api/user/role still answers", async () => {
      const res = await fetch(`${BASE}/api/user/role?telegramId=${ADMIN_ID}`)
      assert.equal(res.status, 200)
      assert.equal((await res.json()).role, "ADMIN")
    })

    await check("/api/spot/symbols still answers", async () => {
      const res = await fetch(`${BASE}/api/spot/symbols`)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray((await res.json()).tickers))
    })

    await check("/api/share/[token] still validates its token", async () => {
      assert.equal((await fetch(`${BASE}/api/share/bad-token`)).status, 400)
      assert.equal((await fetch(`${BASE}/api/share/${"0".repeat(48)}`)).status, 404)
    })

    await check("/api/cron/cleanup still rejects a missing bearer", async () => {
      assert.equal((await fetch(`${BASE}/api/cron/cleanup`)).status, 401)
    })

    await check("/api/trades/notes and /overrides still read", async () => {
      const notes = await fetch(`${BASE}/api/trades/notes?telegramId=${USER_ID}`)
      assert.equal(notes.status, 200)
      const ov = await fetch(`${BASE}/api/trades/overrides?telegramId=${USER_ID}`)
      assert.equal(ov.status, 200)
    })

    await check("/api/spot/entries still validates and reads", async () => {
      assert.equal((await fetch(`${BASE}/api/spot/entries`)).status, 400)
      const res = await fetch(`${BASE}/api/spot/entries?telegramId=${USER_ID}`)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray((await res.json()).entries))
    })

    console.log(`\n${passed} checks passed, ${failures.length} failed`)
    if (failures.length > 0) {
      console.log("\nfailed:")
      for (const f of failures) console.log(`  ✗ ${f}`)
      console.log("")
    }
  } finally {
    await teardown()
    console.log(`teardown: removed synthetic users`)
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err)
  process.exit(1)
})
