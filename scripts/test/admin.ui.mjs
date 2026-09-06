/**
 * Headless UI check of the admin page and server-side impersonation.
 *
 * Authorization is a real session now: the page sends no identity of its own,
 * and requireAdmin() re-reads `role` from the database on every request. This
 * drives the real page in Chromium and asserts on the DOM, the network status
 * codes and the database.
 *
 * SAFETY: both users are synthetic, created and removed by this script.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:admin
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"
import { signInBrowser } from "./helpers/session.mjs"

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const ADMIN_ID = "990000000201"
const USER_ID = "990000000202"

const sql = neon(process.env.DATABASE_URL)

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  for (const id of [ADMIN_ID, USER_ID]) {
    await sql`DELETE FROM public.users WHERE telegram_id = ${BigInt(id)}`
  }
}

/** Opens /admin in a fresh context signed in as the given user. */
async function openAdminAs(browser, telegramId, name, makeAdmin) {
  const context = await browser.newContext()
  const page = await context.newPage()

  const adminCalls = []
  page.on("response", (res) => {
    if (res.url().includes("/api/admin/users")) {
      adminCalls.push({ status: res.status(), url: res.url() })
    }
  })
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))

  await signInBrowser(page, BASE, telegramId, name)
  if (makeAdmin) {
    await sql`
      UPDATE public.users SET role = ${"ADMIN"}::user_role
      WHERE telegram_id = ${BigInt(telegramId)}
    `
  }

  const settled = page
    .waitForResponse((r) => r.url().includes("/api/admin/users"), { timeout: 30_000 })
    .catch(() => null)
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" })
  await settled
  await page.waitForTimeout(1500)

  return { context, page, adminCalls, pageErrors }
}

async function main() {
  await teardown()
  const browser = await chromium.launch()

  try {
    console.log("\nadmin page as an ADMIN")
    // The plain user must exist first so it shows up in the list.
    const plain = await openAdminAs(browser, USER_ID, "ui-plain-user", false)

    console.log("\nadmin page as a plain USER")
    await check("a non-admin is redirected off /admin", () => {
      assert.ok(!/\/admin$/.test(plain.page.url()), `still on ${plain.page.url()}`)
    })
    await check("the API refuses a non-admin session with 403", () => {
      assert.ok(
        plain.adminCalls.every((c) => c.status === 403),
        `expected only 403s, got ${JSON.stringify(plain.adminCalls)}`
      )
    })
    await check("a non-admin never sees another user's name", async () => {
      const body = await plain.page.innerText("body")
      assert.ok(!body.includes("ui-admin"), "leaked the user list to a non-admin")
    })
    await plain.context.close()

    const admin = await openAdminAs(browser, ADMIN_ID, "ui-admin", true)

    await check("the page stays on /admin", () => {
      assert.match(admin.page.url(), /\/admin$/)
    })
    await check("the heading renders", async () => {
      assert.match(await admin.page.textContent("h1"), /Admin Dashboard/)
    })
    await check("the page sends no identity of its own", () => {
      assert.ok(admin.adminCalls.length > 0, "no /api/admin/users request was made")
      assert.ok(
        admin.adminCalls.every((c) => !c.url.includes("telegramId")),
        `the page still sends an id: ${JSON.stringify(admin.adminCalls)}`
      )
    })
    await check("the route answers 200 for an admin session", () => {
      assert.ok(admin.adminCalls.every((c) => c.status === 200))
    })
    await check("both synthetic users are rendered in the table", async () => {
      const body = await admin.page.innerText("body")
      assert.ok(body.includes("ui-admin"), "admin row missing")
      assert.ok(body.includes("ui-plain-user"), "user row missing")
    })
    await check("no uncaught JS errors", () => {
      assert.deepEqual(admin.pageErrors, [])
    })

    console.log("\nimpersonation is decided server-side")

    await check("/api/me reports the admin before impersonating", async () => {
      const me = await admin.page.evaluate(async () => (await fetch("/api/me")).json())
      assert.equal(me.telegramId, "990000000201")
      assert.equal(me.impersonating, false)
    })

    await check("starting impersonation switches who the server thinks you are", async () => {
      const res = await admin.page.evaluate(async (target) => {
        const r = await fetch("/api/admin/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId: target }),
        })
        return { status: r.status, body: await r.json() }
      }, USER_ID)
      assert.equal(res.status, 200)

      const me = await admin.page.evaluate(async () => (await fetch("/api/me")).json())
      assert.equal(me.telegramId, USER_ID, "the server still sees the admin")
      assert.equal(me.impersonating, true)
      assert.equal(me.actorTelegramId, ADMIN_ID, "the real actor is not recorded")
    })

    await check("while impersonating, admin-only routes are refused", async () => {
      const status = await admin.page.evaluate(async () =>
        (await fetch("/api/admin/users")).status)
      assert.equal(status, 403, "an impersonating session kept admin powers")
    })

    await check("stopping impersonation restores the admin", async () => {
      await admin.page.evaluate(async () =>
        fetch("/api/admin/impersonate", { method: "DELETE" }))
      const me = await admin.page.evaluate(async () => (await fetch("/api/me")).json())
      assert.equal(me.telegramId, ADMIN_ID)
      assert.equal(me.impersonating, false)
      const status = await admin.page.evaluate(async () =>
        (await fetch("/api/admin/users")).status)
      assert.equal(status, 200, "admin powers did not come back")
    })

    await admin.context.close()

    console.log("\nthe route itself, not the page")

    await check("an anonymous request is refused 401", async () => {
      const res = await fetch(`${BASE}/api/admin/users`)
      assert.equal(res.status, 401)
      const body = await res.text()
      assert.ok(!body.includes("ui-plain-user"), "anonymous request leaked the list")
    })

    await check("a telegramId in the query string still gets nothing", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=${ADMIN_ID}`)
      assert.equal(res.status, 401, "a query param influenced authorization")
    })

    console.log(`\n${passed} checks passed\n`)
  } finally {
    await browser.close()
    await teardown()
    console.log("teardown: removed synthetic users")
  }
}

main().catch((err) => {
  console.error("\nUI test failed:", err)
  process.exit(1)
})
