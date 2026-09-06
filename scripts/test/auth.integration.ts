/**
 * End-to-end check of the session model (Phase 2).
 *
 * The property under test is the one the whole app rested on and did not have:
 * an unauthenticated caller reaches nothing, and an authenticated one reaches
 * only their own rows — no matter what they put in the request.
 *
 * SAFETY: everything is scoped to synthetic users, created and removed here.
 *
 *   npm run dev            # in another terminal
 *   npm run test:auth
 */
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { getSql } from "@/lib/db"
import { authedPost, signIn } from "./helpers/session.mjs"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const ALICE = "990000000501"
const BOB = "990000000502"
const ADMIN = "990000000503"
const EXCHANGE = "OKX"

const sql = getSql()

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex")

/**
 * Mints a login token the same way lib/auth/session.ts does, but in SQL.
 * Importing that module here would pull `next/headers`, which only resolves
 * inside the Next runtime.
 */
async function mintLoginToken(telegramId: string, ttl = "10 minutes"): Promise<string> {
  const rows = await sql`
    SELECT id FROM public.users WHERE telegram_id = ${BigInt(telegramId)}
  ` as { id: string }[]
  const raw = randomBytes(32).toString("base64url")
  await sql`
    INSERT INTO public.login_tokens (token_hash, user_id, expires_at)
    VALUES (${sha256(raw)}, ${BigInt(rows[0].id)}, NOW() + ${ttl}::interval)
  `
  return raw
}

let passed = 0
const failures: string[] = []
const CONTINUE = Boolean(process.env.AUTH_TEST_CONTINUE_ON_FAIL)

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (err) {
    if (!CONTINUE) throw err
    failures.push(`${name} — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)
    console.log(`  ✗ ${name}`)
    return
  }
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  for (const id of [ALICE, BOB, ADMIN]) {
    const tid = BigInt(id)
    await sql`DELETE FROM public.cached_trades      WHERE telegram_id = ${tid}`
    await sql`DELETE FROM public.exchange_fetch_log WHERE telegram_id = ${tid}`
    await sql`DELETE FROM public.users             WHERE telegram_id = ${tid}`
  }
}

const anon = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, init)
  return { status: res.status, text: await res.text() }
}

async function main() {
  await teardown()

  try {
    // -------------------------------------------------------- closed by default
    console.log("\nno session reaches nothing")

    const GUARDED_GET = [
      "/api/me",
      "/api/trades/notes",
      "/api/trades/overrides",
      "/api/spot/entries",
      "/api/spot/prices",
      "/api/admin/users",
      "/api/user/share-token",
    ]
    for (const path of GUARDED_GET) {
      await check(`GET ${path} is 401 without a cookie`, async () => {
        const { status, text } = await anon(path)
        assert.equal(status, 401, `got ${status}`)
        assert.ok(!text.includes("telegram"), "leaked data in a 401 body")
      })
    }

    const GUARDED_POST = [
      "/api/trades-cache", "/api/trades-cache/all", "/api/trades/deleted",
      "/api/trades/delete", "/api/trades/restore", "/api/trades-store",
      "/api/import/trades", "/api/import/check-ids", "/api/balance",
      "/api/trades", "/api/trades-asia", "/api/trades-global",
      "/api/trades/notes", "/api/trades/overrides", "/api/spot/entries",
      "/api/admin/impersonate",
    ]
    for (const path of GUARDED_POST) {
      await check(`POST ${path} is 401 without a cookie`, async () => {
        const { status } = await anon(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId: ALICE, exchange: EXCHANGE, id: "x", ids: ["x"], trades: [] }),
        })
        assert.equal(status, 401, `got ${status}`)
      })
    }

    await check("the public routes are still reachable without a cookie", async () => {
      assert.equal((await anon("/api/spot/symbols")).status, 200)
      assert.equal((await anon(`/api/share/${"0".repeat(48)}`)).status, 404) // reached the handler
      assert.equal((await anon("/api/cron/cleanup")).status, 401)            // its own guard, not the proxy
    })

    // ------------------------------------------------------------- signing in
    console.log("\nsign-in")

    const aliceCookie = await signIn(BASE, ALICE, "alice")
    const bobCookie = await signIn(BASE, BOB, "bob")
    const alice = authedPost(BASE, aliceCookie)
    const bob = authedPost(BASE, bobCookie)

    await check("the session cookie is httpOnly, lax and path-scoped", async () => {
      const res = await fetch(`${BASE}/api/auth/dev-login?telegramId=${ALICE}`, { redirect: "manual" })
      const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("mfca_session="))
      assert.ok(raw, "no cookie set")
      assert.match(raw, /HttpOnly/i)
      assert.match(raw, /SameSite=lax/i)
      assert.match(raw, /Path=\//i)
    })

    await check("the raw session token is never stored, only its hash", async () => {
      const value = aliceCookie.split("=")[1]
      const rows = await sql`
        SELECT session_token_hash FROM public.user_sessions
        WHERE session_token_hash = ${sha256(value)}
      ` as unknown[]
      assert.equal(rows.length, 1, "hash lookup failed — storage format changed")
      const raw = await sql`
        SELECT 1 FROM public.user_sessions WHERE session_token_hash = ${value}
      ` as unknown[]
      assert.equal(raw.length, 0, "the raw token is in the database")
    })

    await check("/api/me returns the signed-in identity", async () => {
      const res = await fetch(`${BASE}/api/me`, { headers: { cookie: aliceCookie } })
      assert.equal(res.status, 200)
      const me = await res.json()
      assert.equal(me.telegramId, ALICE)
      assert.equal(me.role, "USER")
      assert.equal(me.impersonating, false)
    })

    // ------------------------------------------------------ identity is server-side
    console.log("\na forged telegramId is ignored")

    await check("seeding as Alice writes to Alice", async () => {
      const trades = [{
        id: "auth-a1", exchange: EXCHANGE, ticker: "BTCUSDT", positionSize: 1,
        tp: null, sl: null, pnl: 100,
        openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
      }]
      const { status } = await alice("/api/trades-store", { exchange: EXCHANGE, trades })
      assert.equal(status, 200)
      const rows = await sql`
        SELECT id FROM public.cached_trades WHERE telegram_id = ${BigInt(ALICE)}
      ` as unknown[]
      assert.equal(rows.length, 1)
    })

    // THE core assertion of Phase 2.
    await check("Bob sending Alice's telegramId still writes to Bob", async () => {
      const trades = [{
        id: "auth-b1", exchange: EXCHANGE, ticker: "ETHUSDT", positionSize: 1,
        tp: null, sl: null, pnl: 7,
        openTime: "2026-08-01T00:00:00.000Z", closeTime: "2026-08-02T00:00:00.000Z",
      }]
      const { status } = await bob("/api/trades-store", { telegramId: ALICE, exchange: EXCHANGE, trades })
      assert.equal(status, 200)

      const alicesRows = await sql`
        SELECT id FROM public.cached_trades WHERE telegram_id = ${BigInt(ALICE)}
      ` as { id: string }[]
      assert.deepEqual(alicesRows.map((r) => r.id), ["auth-a1"], "Bob wrote into Alice's account")

      const bobsRows = await sql`
        SELECT id FROM public.cached_trades WHERE telegram_id = ${BigInt(BOB)}
      ` as { id: string }[]
      assert.deepEqual(bobsRows.map((r) => r.id), ["auth-b1"])
    })

    await check("Bob reading with Alice's telegramId gets his own empty history", async () => {
      const { status, json } = await bob("/api/trades-cache/all", { telegramId: ALICE })
      assert.equal(status, 200)
      const ids = ((json as { trades: { id: string }[] }).trades).map((t) => t.id)
      assert.ok(!ids.includes("auth-a1"), "Bob read Alice's trades")
      assert.deepEqual(ids, ["auth-b1"])
    })

    await check("Bob cannot delete Alice's trade by id", async () => {
      const { status } = await bob("/api/trades/delete", {
        telegramId: ALICE, exchange: EXCHANGE, id: "auth-a1",
      })
      assert.equal(status, 404, "cross-user delete was not refused")
      const rows = await sql`
        SELECT deleted_at FROM public.cached_trades
        WHERE telegram_id = ${BigInt(ALICE)} AND id = ${"auth-a1"}
      ` as { deleted_at: Date | null }[]
      assert.equal(rows[0].deleted_at, null, "Alice's trade was deleted by Bob")
    })

    await check("Bob cannot read or mint Alice's share token", async () => {
      const res = await fetch(`${BASE}/api/user/share-token?telegramId=${ALICE}`, {
        headers: { cookie: bobCookie },
      })
      assert.equal(res.status, 200)
      const { token } = await res.json()
      // Whatever comes back is Bob's own (null), never Alice's.
      const alices = await sql`
        SELECT share_token FROM public.users WHERE telegram_id = ${BigInt(ALICE)}
      ` as { share_token: string | null }[]
      assert.notEqual(token, alices[0].share_token ?? "sentinel")
    })

    await check("a journal note written by Bob lands on Bob", async () => {
      await bob("/api/trades/notes", {
        telegramId: ALICE, exchange: EXCHANGE, id: "auth-b1",
        phase: "before", body: "bob's note",
      })
      const rows = await sql`
        SELECT telegram_id FROM public.trade_notes WHERE body = ${"bob's note"}
      ` as { telegram_id: string }[]
      assert.equal(rows.length, 1)
      assert.equal(String(rows[0].telegram_id), BOB)
    })

    // ------------------------------------------------------------------- roles
    console.log("\nroles and admin")

    const adminCookie = await signIn(BASE, ADMIN, "admin")
    await sql`UPDATE public.users SET role = ${"ADMIN"}::user_role WHERE telegram_id = ${BigInt(ADMIN)}`

    await check("a normal user is refused the admin list with 403", async () => {
      const res = await fetch(`${BASE}/api/admin/users`, { headers: { cookie: aliceCookie } })
      assert.equal(res.status, 403)
      assert.ok(!(await res.text()).includes("alice"), "403 body leaked the list")
    })

    await check("an admin gets the list", async () => {
      const res = await fetch(`${BASE}/api/admin/users`, { headers: { cookie: adminCookie } })
      assert.equal(res.status, 200)
      const rows = await res.json() as { telegramId: string }[]
      assert.ok(rows.find((r) => r.telegramId === ALICE), "admin list missing a user")
    })

    await check("role is re-read per request, so a demotion takes effect immediately", async () => {
      await sql`UPDATE public.users SET role = ${"USER"}::user_role WHERE telegram_id = ${BigInt(ADMIN)}`
      const res = await fetch(`${BASE}/api/admin/users`, { headers: { cookie: adminCookie } })
      assert.equal(res.status, 403, "a demoted admin kept access")
      await sql`UPDATE public.users SET role = ${"ADMIN"}::user_role WHERE telegram_id = ${BigInt(ADMIN)}`
    })

    await check("a non-admin cannot start impersonation", async () => {
      const { status } = await alice("/api/admin/impersonate", { telegramId: BOB })
      assert.equal(status, 403)
    })

    await check("an admin can impersonate, and it is the server that decides", async () => {
      const res = await fetch(`${BASE}/api/admin/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ telegramId: ALICE }),
      })
      assert.equal(res.status, 200)
      const imp = (res.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(";")[0]).find((c) => c.startsWith("mfca_impersonate="))
      assert.ok(imp, "no impersonation cookie set")

      const me = await fetch(`${BASE}/api/me`, { headers: { cookie: `${adminCookie}; ${imp}` } })
      const body = await me.json()
      assert.equal(body.telegramId, ALICE, "impersonation did not take effect")
      assert.equal(body.impersonating, true)
      assert.equal(body.actorTelegramId, ADMIN, "the real actor is not recorded")
    })

    await check("a forged impersonation cookie does nothing for a normal user", async () => {
      const me = await fetch(`${BASE}/api/me`, {
        headers: { cookie: `${bobCookie}; mfca_impersonate=${ALICE}` },
      })
      const body = await me.json()
      assert.equal(body.telegramId, BOB, "a non-admin impersonated someone by setting a cookie")
      assert.equal(body.impersonating, false)
    })

    // ------------------------------------------------------------ session life
    console.log("\nsession lifecycle")

    await check("logout revokes server-side, not just in the browser", async () => {
      const cookie = await signIn(BASE, ALICE, "alice")
      const before = await fetch(`${BASE}/api/me`, { headers: { cookie } })
      assert.equal(before.status, 200)

      const out = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie } })
      assert.equal(out.status, 200)

      // Replaying the same cookie must now fail — clearing it client-side is not enough.
      const after = await fetch(`${BASE}/api/me`, { headers: { cookie } })
      assert.equal(after.status, 401, "a revoked session still validates")
    })

    await check("an expired session is refused", async () => {
      const cookie = await signIn(BASE, ALICE, "alice")
      const value = cookie.split("=")[1]
      await sql`
        UPDATE public.user_sessions SET expires_at = NOW() - INTERVAL '1 minute'
        WHERE session_token_hash = ${sha256(value)}
      `
      const res = await fetch(`${BASE}/api/me`, { headers: { cookie } })
      assert.equal(res.status, 401)
    })

    await check("a garbage cookie is refused", async () => {
      const res = await fetch(`${BASE}/api/me`, { headers: { cookie: "mfca_session=not-a-real-token" } })
      assert.equal(res.status, 401)
    })

    // ------------------------------------------------------------ login tokens
    console.log("\nlogin tokens")

    await check("a login token works exactly once", async () => {
      const token = await mintLoginToken(ALICE)

      const first = await fetch(`${BASE}/api/auth/exchange?token=${token}`, { redirect: "manual" })
      assert.equal(first.status, 303)
      assert.ok(
        (first.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("mfca_session=")),
        "first redemption set no session"
      )

      const second = await fetch(`${BASE}/api/auth/exchange?token=${token}`, { redirect: "manual" })
      assert.equal(second.headers.get("location"), "/?auth=expired", "a token was redeemable twice")
    })

    // REGRESSION: Telegram's preview crawler redeemed a live token ~450ms after
    // the message was sent, took the session, and left the user with
    // "?auth=expired". The crawler must not spend the token.
    await check("a link-preview crawler does not consume the token", async () => {
      const token = await mintLoginToken(ALICE)

      const crawler = await fetch(`${BASE}/api/auth/exchange?token=${token}`, {
        headers: { "user-agent": "TelegramBot (like TwitterBot)" },
        redirect: "manual",
      })
      assert.equal(crawler.status, 200, "crawler was redirected into the login flow")
      assert.ok(
        !(crawler.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("mfca_session=")),
        "the crawler was handed a session"
      )

      const stillUnused = await sql`
        SELECT used_at FROM public.login_tokens WHERE token_hash = ${sha256(token)}
      ` as { used_at: Date | null }[]
      assert.equal(stillUnused[0].used_at, null, "the crawler burned the token")

      // And the real user, arriving afterwards, still gets in.
      const user = await fetch(`${BASE}/api/auth/exchange?token=${token}`, {
        headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" },
        redirect: "manual",
      })
      assert.equal(user.status, 303)
      assert.equal(user.headers.get("location"), "/", "the user did not land signed in")
      assert.ok(
        (user.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("mfca_session=")),
        "the user got no session"
      )
    })

    await check("an expired login token is refused", async () => {
      const token = await mintLoginToken(ALICE, "-1 minute")
      const res = await fetch(`${BASE}/api/auth/exchange?token=${token}`, { redirect: "manual" })
      assert.equal(res.headers.get("location"), "/?auth=expired")
    })

    await check("a malformed token never reaches the database", async () => {
      const res = await fetch(`${BASE}/api/auth/exchange?token=../../etc/passwd`, { redirect: "manual" })
      assert.equal(res.headers.get("location"), "/?auth=invalid")
    })

    await check("the old /auth?id= login is dead", async () => {
      // The page now only redirects; nothing it does can produce a session.
      const res = await fetch(`${BASE}/auth?id=${ALICE}&name=x`)
      const setCookie = res.headers.getSetCookie?.() ?? []
      assert.ok(
        !setCookie.some((c) => c.startsWith("mfca_session=")),
        "the legacy auth page still mints a session"
      )
    })

    console.log(`\n${passed} checks passed, ${failures.length} failed`)
    if (failures.length) {
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
