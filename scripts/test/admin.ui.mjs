/**
 * Headless UI check of the admin page against the newly gated
 * /api/admin/users route.
 *
 * The route now requires the caller's telegramId and reads `role` from the
 * database. The page had to start sending that id, so this drives the real page
 * in Chromium and asserts on the rendered DOM and the network status codes —
 * an ADMIN still sees the table, a USER is refused and redirected.
 *
 * SAFETY: both users are synthetic, created and removed by this script.
 * Teardown runs in a finally block, and a fresh run cleans up leftovers.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:admin
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"

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
    await sql`DELETE FROM users WHERE telegram_id = ${BigInt(id)}`
  }
}

async function setup() {
  await teardown()
  await sql`
    INSERT INTO users (telegram_id, telegram_name, role)
    VALUES (${BigInt(ADMIN_ID)}, ${"ui-admin"}, ${"ADMIN"}::user_role)
  `
  await sql`
    INSERT INTO users (telegram_id, telegram_name, role)
    VALUES (${BigInt(USER_ID)}, ${"ui-plain-user"}, ${"USER"}::user_role)
  `
}

/** Seeds the zustand store the way /auth does, then loads /admin. */
async function openAdminAs(browser, telegramId, name, role) {
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

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
  await page.evaluate(
    ([id, nm, r]) => {
      localStorage.setItem(
        "mfca-user-store",
        JSON.stringify({
          state: {
            userId: null, walletAddress: null,
            telegramId: id, telegramName: nm, role: r,
            apiKeys: {}, originalAdmin: null,
          },
          version: 0,
        })
      )
    },
    [telegramId, name, role]
  )
  const settled = page
    .waitForResponse((r) => r.url().includes("/api/admin/users"), { timeout: 30_000 })
    .catch(() => null)

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" })
  // An ADMIN triggers the call; a USER never should, so a miss is a valid
  // outcome here and the assertions decide which one was expected.
  await settled
  await page.waitForTimeout(1000)

  return { context, page, adminCalls, pageErrors }
}

async function main() {
  await setup()
  const browser = await chromium.launch()

  try {
    console.log("\nadmin page as an ADMIN")
    const admin = await openAdminAs(browser, ADMIN_ID, "ui-admin", "ADMIN")

    await check("the page stays on /admin", async () => {
      assert.match(admin.page.url(), /\/admin$/)
    })

    await check("the heading renders", async () => {
      const heading = await admin.page.textContent("h1")
      assert.match(heading ?? "", /Admin Dashboard/)
    })

    await check("the page sends its telegramId to the gated route", () => {
      assert.ok(admin.adminCalls.length > 0, "no /api/admin/users request was made")
      assert.ok(
        admin.adminCalls.every((c) => c.url.includes(`telegramId=${ADMIN_ID}`)),
        `request did not carry the id: ${JSON.stringify(admin.adminCalls)}`
      )
    })

    await check("the route answers 200 for an admin", () => {
      assert.deepEqual(
        admin.adminCalls.map((c) => c.status),
        admin.adminCalls.map(() => 200)
      )
    })

    await check("both synthetic users are rendered in the table", async () => {
      const body = await admin.page.innerText("body")
      assert.ok(body.includes("ui-admin"), "admin row missing from the table")
      assert.ok(body.includes("ui-plain-user"), "user row missing from the table")
    })

    await check("no error banner is shown", async () => {
      const body = await admin.page.innerText("body")
      assert.ok(!body.includes("Forbidden"), "page rendered a Forbidden error")
      assert.ok(!body.includes("Internal server error"))
    })

    await check("no uncaught JS errors", () => {
      assert.deepEqual(admin.pageErrors, [])
    })

    await admin.context.close()

    console.log("\nadmin page as a plain USER")
    const user = await openAdminAs(browser, USER_ID, "ui-plain-user", "USER")

    await check("a non-admin is redirected off /admin", () => {
      assert.ok(!/\/admin$/.test(user.page.url()), `still on ${user.page.url()}`)
    })

    await check("a non-admin never sees another user's name", async () => {
      const body = await user.page.innerText("body")
      assert.ok(!body.includes("ui-admin"), "leaked the user list to a non-admin")
    })

    await user.context.close()

    console.log("\nthe route itself, not the page")

    await check("a non-admin id is refused 403 by the API directly", async () => {
      const res = await fetch(`${BASE}/api/admin/users?telegramId=${USER_ID}`)
      assert.equal(res.status, 403)
      const body = await res.text()
      assert.ok(!body.includes("ui-admin"), "403 response still leaked the list")
    })

    await check("an anonymous request is refused 403", async () => {
      const res = await fetch(`${BASE}/api/admin/users`)
      assert.equal(res.status, 403)
      const body = await res.text()
      assert.ok(!body.includes("ui-plain-user"), "anonymous request leaked the list")
    })

    console.log(`\n${passed} checks passed\n`)
  } finally {
    await browser.close()
    await teardown()
    console.log(`teardown: removed synthetic users`)
  }
}

main().catch((err) => {
  console.error("\nUI test failed:", err)
  process.exit(1)
})
