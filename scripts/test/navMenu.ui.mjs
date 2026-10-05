/**
 * Headless UI check of the navbar layout: Main and Spot in the bar, every other
 * page folded into a "More" dropdown (Admin only for admins), Import unchanged.
 * Also checks the bar now fits a 1280px window — before the fold it overflowed
 * below ~1400px and the left links covered the right-hand controls.
 *
 * SAFETY: one synthetic user, created and removed by this script; teardown runs
 * in a finally block and also at the start, for a crashed previous run.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:nav-menu
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
const TEST_TELEGRAM_ID = "990000001002"
const MORE = ["WMon", "HMon", "TMon", "EMon", "LvsS", "DPnL"]

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

/** Text of the visible links directly in the desktop bar (not in a dropdown). */
const barLinks = (page) =>
  page.locator("header nav > a:visible").evaluateAll((els) => els.map((e) => e.textContent.trim()))
/** Text of the visible links inside the open dropdown. */
const dropdownLinks = (page) =>
  page.locator("header nav .absolute a:visible").evaluateAll((els) => els.map((e) => e.textContent.trim()))
const moreButton = (page) => page.locator("header nav button", { hasText: /^More$/ })

async function main() {
  await teardown()
  const browser = await chromium.launch()

  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))
    // A long display name is the worst case for the bar's width.
    await signInBrowser(page, BASE, TEST_TELEGRAM_ID, "nav-menu-test-user")
    await gotoApp(page, `${BASE}/spot`)

    await check("the bar shows only Main and Spot as direct links", async () => {
      assert.deepEqual(await barLinks(page), ["Main", "Spot"])
    })
    await check("More is closed until hovered; the analytics pages are not shown", async () => {
      assert.deepEqual(await dropdownLinks(page), [])
    })
    await check("hovering More lists the analytics pages, without Admin for a regular user", async () => {
      await moreButton(page).hover()
      assert.deepEqual(await dropdownLinks(page), MORE)
    })
    await check("a More item navigates and highlights More as active", async () => {
      await page.locator("header nav .absolute a", { hasText: /^WMon$/ }).click()
      await page.waitForURL(`${BASE}/wmon`)
      await page.mouse.move(5, 500)
      const cls = await moreButton(page).getAttribute("class")
      assert.ok(cls.includes("text-foreground") && !cls.includes("text-muted-foreground"), cls)
    })
    await check("Import is still its own dropdown with Jupiter Dex", async () => {
      await page.locator("header nav button", { hasText: "Import" }).hover()
      assert.deepEqual(await dropdownLinks(page), ["Jupiter Dex"])
      await page.mouse.move(5, 500)
    })

    await sql`
      UPDATE public.users SET role = ${"ADMIN"}::user_role
      WHERE telegram_id = ${BigInt(TEST_TELEGRAM_ID)}
    `
    await gotoApp(page, `${BASE}/admin`)
    await check("an admin finds Admin at the end of More, and it shows as active on /admin", async () => {
      await page.waitForFunction(() => document.body.innerText.includes("Admin Dashboard"), null, { timeout: 30_000 })
      const cls = await moreButton(page).getAttribute("class")
      assert.ok(!cls.includes("text-muted-foreground"), "More not highlighted on /admin")
      await moreButton(page).hover()
      assert.deepEqual(await dropdownLinks(page), [...MORE, "Admin"])
      await page.mouse.move(5, 500)
    })

    await check("no uncaught page errors", async () => {
      assert.deepEqual(pageErrors, [])
    })

    // --- 1280px: the bar now fits ------------------------------------------
    await page.setViewportSize({ width: 1280, height: 800 })
    await gotoApp(page, `${BASE}/spot`)
    await check("at 1280px the page does not scroll sideways", async () => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert.ok(overflow <= 0, `scrolls horizontally by ${overflow}px`)
    })
    await check("at 1280px the left links end before the right-hand controls start", async () => {
      const gap = await page.evaluate(() => {
        const [left, right] = document.querySelector("header .max-w-7xl").children
        const lastLeft = [...left.querySelectorAll("a, button")].pop().getBoundingClientRect()
        return right.firstElementChild.getBoundingClientRect().left - lastLeft.right
      })
      assert.ok(gap > 0, `overlap of ${-gap}px`)
    })
    await check("at 1280px the refresh icon is clickable (nothing on top of it)", async () => {
      const onTop = await page.locator('header [data-testid="nav-refresh"]:visible').evaluate((el) => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      })
      assert.ok(onTop)
    })
    await context.close()

    // --- mobile -------------------------------------------------------------
    {
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const mpage = await mobile.newPage()
      await signInBrowser(mpage, BASE, TEST_TELEGRAM_ID, "nav-menu-test-user")
      await gotoApp(mpage, `${BASE}/spot`)
      await check("mobile menu lists Main, Spot, then every More page and Jupiter Dex", async () => {
        await mpage.locator('header button[aria-label="Toggle menu"]').click()
        const links = await mpage.locator("header a:visible").evaluateAll(
          (els) => els.map((e) => e.textContent.trim()))
        assert.deepEqual(links, ["Main", "Spot", ...MORE, "Admin", "Jupiter Dex"])
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
