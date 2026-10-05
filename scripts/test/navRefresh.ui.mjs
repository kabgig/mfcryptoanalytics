/**
 * Headless UI check of the navbar refresh icon.
 *
 * Each page's in-page "Refresh" button moved to a small icon in the navbar. This
 * drives the real pages in Chromium and asserts on the DOM and on the network:
 * the icon is there, carries the page's label, fires that page's reload when
 * clicked, is disabled while the reload runs, and disappears on pages (and
 * sessions) that have nothing to refresh. Every scenario is checked even after
 * one fails, so a red run lists all of them.
 *
 * SAFETY: one synthetic user, created and removed by this script; teardown runs
 * in a finally block and also at the start, for a crashed previous run.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:nav-refresh
 */
import assert from "node:assert/strict"
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
const TEST_TELEGRAM_ID = "990000001001"

const sql = neon(process.env.DATABASE_URL)

let passed = 0
const failed = []
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${String(err.message ?? err).split("\n")[0]}`)
  }
}

async function teardown() {
  await sql`DELETE FROM public.users WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}`
}

const navIcon = (page) => page.locator('header [data-testid="nav-refresh"]:visible')
// The removed buttons all started with the word "Refresh".
const inPageRefresh = (page) => page.locator("main button", { hasText: /^\s*Refresh/ })

/** Clicks the icon and resolves with the first request matching `urlPart`. */
async function clickAndCapture(page, urlPart) {
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes(urlPart), { timeout: 15_000 }),
    navIcon(page).click({ timeout: 15_000 }),
  ])
  return req
}

async function waitIdle(page) {
  await page.waitForFunction(
    () => document.querySelector('header [data-testid="nav-refresh"]')?.getAttribute("data-busy") !== "true",
    null,
    { timeout: 60_000 }
  )
}

const FUTURES_PAGES = ["/", "/wmon", "/hmon", "/tmon", "/emon", "/lvs", "/dpnl"]

async function main() {
  await teardown()
  const browser = await chromium.launch()

  try {
    // --- signed out ---------------------------------------------------------
    {
      const context = await browser.newContext()
      const page = await context.newPage()
      await gotoApp(page, `${BASE}/spot`)
      await check("signed out: no refresh icon", async () => {
        assert.equal(await navIcon(page).count(), 0)
      })
      await context.close()
    }

    // Wide enough for the full navbar. Below ~1400px the header already overflows
    // (pre-existing, see the report) and the left links cover the right controls.
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))
    await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "nav-refresh-test")

    // --- futures pages ------------------------------------------------------
    for (const path of FUTURES_PAGES) {
      await gotoApp(page, `${BASE}${path}`)
      await check(`${path}: icon labelled "Refresh trades", in-page button gone`, async () => {
        await navIcon(page).first().waitFor({ timeout: 30_000 }).catch(() => {})
        assert.equal(await navIcon(page).count(), 1, "visible icon count")
        assert.equal(await navIcon(page).getAttribute("aria-label"), "Refresh trades")
        assert.equal(await inPageRefresh(page).count(), 0, "in-page Refresh buttons")
        // Nothing else in the header sits on top of it.
        const onTop = await navIcon(page).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        })
        assert.ok(onTop, "icon is covered by another element")
      })
      await check(`${path}: click reloads trades`, async () => {
        const req = await clickAndCapture(page, "/api/trades-cache/all")
        assert.equal(req.method(), "POST")
        await waitIdle(page)
      })
    }

    await gotoApp(page, `${BASE}/`)
    await check("/: Viz + period selector stay right-aligned without the button", async () => {
      const viz = await page.locator("main a[href='/viz']").boundingBox()
      assert.ok(viz && viz.x > 1920 / 2, `Viz link at x=${viz?.x}`)
    })

    // --- spot: busy state ---------------------------------------------------
    await gotoApp(page, `${BASE}/spot`)
    await check('/spot: icon labelled "Refresh prices", in-page button gone', async () => {
      assert.equal(await navIcon(page).count(), 1)
      assert.equal(await navIcon(page).getAttribute("aria-label"), "Refresh prices")
      assert.equal(await inPageRefresh(page).count(), 0)
    })
    await check("/spot: click reloads prices; icon disabled + spinning until it answers", async () => {
      let release
      const held = new Promise((r) => { release = r })
      await page.route("**/api/spot/prices", async (route) => { await held; await route.continue() })
      const req = clickAndCapture(page, "/api/spot/prices")
      await req
      // The response is held, so the reload cannot finish until release().
      const icon = navIcon(page)
      await page.locator('header [data-testid="nav-refresh"][data-busy="true"]:visible')
        .waitFor({ timeout: 5_000 })
      assert.equal(await icon.getAttribute("data-busy"), "true")
      assert.equal(await icon.isDisabled(), true)
      assert.ok((await icon.locator("svg").getAttribute("class")).includes("animate-spin"))
      release()
      await waitIdle(page)
      assert.equal(await icon.isDisabled(), false)
      await page.unroute("**/api/spot/prices")
    })

    // --- client-side navigation swaps / clears the registration -------------
    await check("client nav Spot → Main: icon now refreshes trades", async () => {
      await page.locator("header nav a", { hasText: /^Main$/ }).click()
      await page.waitForURL(`${BASE}/`)
      await page.waitForFunction(
        () => [...document.querySelectorAll('header [data-testid="nav-refresh"]')]
          .some((b) => b.offsetParent && b.getAttribute("aria-label") === "Refresh trades"),
        null,
        { timeout: 30_000 }
      )
      const req = await clickAndCapture(page, "/api/trades-cache/all")
      assert.equal(req.method(), "POST")
      await waitIdle(page)
    })
    await check("client nav Main → Import/Jupiter: icon disappears", async () => {
      await page.locator("header nav button", { hasText: "Import" }).hover()
      await page.locator("header a", { hasText: "Jupiter Dex" }).click()
      await page.waitForURL(`${BASE}/import/jupiter`)
      await page.waitForTimeout(1500)
      assert.equal(await navIcon(page).count(), 0)
    })

    // --- admin --------------------------------------------------------------
    await sql`
      UPDATE public.users SET role = ${"ADMIN"}::user_role
      WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
    `
    await gotoApp(page, `${BASE}/admin`)
    await check('/admin: icon labelled "Refresh users", click reloads the list', async () => {
      assert.equal(await navIcon(page).getAttribute("aria-label"), "Refresh users")
      assert.equal(await inPageRefresh(page).count(), 0)
      const req = await clickAndCapture(page, "/api/admin/users")
      assert.equal(req.method(), "GET")
      await waitIdle(page)
    })

    await check("no uncaught page errors", async () => {
      assert.deepEqual(pageErrors, [])
    })
    await context.close()

    // --- mobile -------------------------------------------------------------
    {
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const mpage = await mobile.newPage()
      await signInBrowser(mpage, BASE, TEST_TELEGRAM_ID, "nav-refresh-test")
      await gotoApp(mpage, `${BASE}/spot`)
      await check("mobile /spot: icon visible beside the menu, no horizontal scroll", async () => {
        assert.equal(await navIcon(mpage).count(), 1)
        const req = await clickAndCapture(mpage, "/api/spot/prices")
        assert.equal(req.method(), "GET")
        const overflow = await mpage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px`)
      })
      await mobile.close()
    }
  } finally {
    await browser.close()
    await teardown()
  }

  console.log(`\n${passed} passed, ${failed.length} failed`)
  if (failed.length) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await teardown().catch(() => {})
  process.exit(1)
})
