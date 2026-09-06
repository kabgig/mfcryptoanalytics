/**
 * Headless UI check of "Sign out all devices".
 *
 * Drives the real settings modal in Chromium and asserts on the database and on
 * a second browser context — the point of the feature is that a device which
 * never touched the button also loses its session.
 *
 * SAFETY: one synthetic user, created and removed by this script.
 *
 *   PORT=3100 npm run dev
 *   TEST_BASE_URL=http://localhost:3100 npm run test:ui:session
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { neon } from "@neondatabase/serverless"
import { signInBrowser } from "./helpers/session.mjs"
import { gotoApp } from "./helpers/nav.mjs"

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const TEST_TELEGRAM_ID = "990000000601"
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "screenshots")

const sql = neon(process.env.DATABASE_URL)

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function teardown() {
  await sql`DELETE FROM public.users WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}`
}

const liveSessions = async () => {
  const rows = await sql`
    SELECT COUNT(*)::int AS n
      FROM public.user_sessions s
      JOIN public.users u ON u.id = s.user_id
     WHERE u.telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
  `
  return rows[0].n
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await teardown()

  const browser = await chromium.launch()
  try {
    // Two devices for the same person.
    const laptop = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const phone = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const laptopPage = await laptop.newPage()
    const phonePage = await phone.newPage()

    const pageErrors = []
    laptopPage.on("pageerror", (e) => pageErrors.push(String(e)))

    await signInBrowser(laptopPage, BASE, TEST_TELEGRAM_ID, "session-ui")
    await signInBrowser(phonePage, BASE, TEST_TELEGRAM_ID, "session-ui")

    await check("both devices start with live sessions", async () => {
      assert.equal(await liveSessions(), 2, "expected two live sessions")
      const me = await phonePage.evaluate(async () => (await fetch("/api/me")).status)
      assert.equal(me, 200, "the phone was not signed in")
    })

    await gotoApp(laptopPage, `${BASE}/`)

    await check("the settings modal opens", async () => {
      await laptopPage.locator('[data-testid="open-settings"]').first().click()
      await laptopPage.waitForSelector('[data-testid="signout-all"]', { timeout: 30_000 })
    })

    await check("the button asks for confirmation rather than acting at once", async () => {
      await laptopPage.locator('[data-testid="signout-all"]').click()
      await laptopPage.waitForSelector('[data-testid="signout-all-confirm"]', { timeout: 10_000 })
      // Nothing has happened yet.
      assert.equal(await liveSessions(), 2, "sessions were revoked before confirming")
    })

    await check("cancelling leaves everything alone", async () => {
      await laptopPage.locator('[data-testid="signout-all-cancel"]').click()
      await laptopPage.waitForSelector('[data-testid="signout-all"]', { timeout: 10_000 })
      assert.equal(await liveSessions(), 2, "cancel still revoked sessions")
    })

    await laptopPage.screenshot({ path: `${SHOTS}/session-1-settings.png`, fullPage: true })

    await check("confirming revokes every session in the database", async () => {
      await laptopPage.locator('[data-testid="signout-all"]').click()
      await laptopPage.waitForSelector('[data-testid="signout-all-confirm"]', { timeout: 10_000 })
      await Promise.all([
        laptopPage.waitForResponse(
          (r) => r.url().includes("/api/auth/logout-all") && r.request().method() === "POST",
          { timeout: 30_000 }
        ),
        laptopPage.locator('[data-testid="signout-all-confirm"]').click(),
      ])
      await laptopPage.waitForFunction(async () => {
        const r = await fetch("/api/me")
        return r.status === 401
      }, null, { timeout: 30_000 })
      assert.equal(await liveSessions(), 0, "sessions survived sign-out-all")
    })

    await check("the OTHER device is signed out too, without touching it", async () => {
      const status = await phonePage.evaluate(async () => (await fetch("/api/me")).status)
      assert.equal(status, 401, "the second device kept its session")
    })

    await check("the laptop lands on the logged-out shell", async () => {
      await laptopPage.waitForFunction(
        () => document.body.innerText.includes("Login with Telegram"),
        null, { timeout: 30_000 }
      )
    })

    await laptopPage.screenshot({ path: `${SHOTS}/session-2-signed-out.png`, fullPage: true })

    await check("no uncaught JS errors", () => {
      assert.deepEqual(pageErrors, [])
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
