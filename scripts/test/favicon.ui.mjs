/**
 * Headless check that the favicon stays legible on every tab strip.
 *
 * The icon used to be a bare glyph that swapped #111 ↔ #fff on
 * prefers-color-scheme. Inside a favicon that query follows the OS, not the
 * browser theme, so a dark OS with a light browser drew a white glyph on a white
 * tab strip. This renders the icon the app actually serves, under both emulated
 * schemes, composited over a light and a dark tab-strip colour, and asserts on
 * pixels: some part of the icon must reach a WCAG contrast of 3:1 against the
 * strip in all four combinations.
 *
 * No user, no DB — read-only against the running dev server.
 *
 *   npm run dev        # in another terminal
 *   npm run test:ui:favicon
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    "/Users/kabgig/.nvm/versions/node/v22.22.0/lib/node_modules/playwright"
)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"

// Representative tab-strip colours: Chrome light / Chrome dark.
const STRIPS = { light: [248, 247, 242], dark: [32, 33, 36] }
const MIN_CONTRAST = 3

let passed = 0
const failed = []
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${err.message}`)
  }
}

/** Best WCAG contrast any icon pixel reaches against the strip, plus white glyph pixel count. */
async function bestContrast(page, href, strip) {
  return page.evaluate(
    async ({ href, strip }) => {
      const img = new Image()
      img.src = href
      await img.decode()
      const size = 64
      const c = document.createElement("canvas")
      c.width = c.height = size
      const ctx = c.getContext("2d")
      ctx.fillStyle = `rgb(${strip.join(",")})`
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      const px = ctx.getImageData(0, 0, size, size).data
      const lum = ([r, g, b]) => {
        const f = (v) => {
          v /= 255
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const bg = lum(strip)
      let best = 1
      for (let i = 0; i < px.length; i += 4) {
        const l = lum([px[i], px[i + 1], px[i + 2]])
        const ratio = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)
        if (ratio > best) best = ratio
      }
      // Glyph pixels: near-white ink, which only the glyph (not the tile) has.
      let glyph = 0
      let minX = size, minY = size, maxX = -1, maxY = -1
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 230 && px[i + 1] > 230 && px[i + 2] > 230) {
          glyph++
          const x = (i / 4) % size, y = Math.floor(i / 4 / size)
          minX = Math.min(minX, x); maxX = Math.max(maxX, x)
          minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
      return { best, glyph, glyphW: maxX - minX + 1, glyphH: maxY - minY + 1 }
    },
    { href, strip }
  )
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 })

  const icons = await page.$$eval("link[rel~='icon'], link[rel='apple-touch-icon']", (ls) =>
    ls.map((l) => ({ rel: l.rel, type: l.type, href: l.href }))
  )
  const svg = icons.find((i) => i.rel.split(" ").includes("icon") && i.type === "image/svg+xml")

  await check("layout links an SVG favicon", () => {
    assert.ok(svg, `no SVG icon link, got ${JSON.stringify(icons)}`)
  })
  await check("layout still links the apple-touch-icon", () => {
    assert.ok(icons.some((i) => i.rel === "apple-touch-icon"), JSON.stringify(icons))
  })
  await check("favicon is served as image/svg+xml", async () => {
    const res = await page.request.get(svg.href)
    assert.equal(res.status(), 200)
    assert.match(res.headers()["content-type"] ?? "", /image\/svg\+xml/)
  })

  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const [stripName, strip] of Object.entries(STRIPS)) {
      await check(`OS ${scheme} · ${stripName} tab strip: legible (≥${MIN_CONTRAST}:1)`, async () => {
        const { best } = await bestContrast(page, svg.href, strip)
        assert.ok(best >= MIN_CONTRAST, `best contrast ${best.toFixed(2)}:1`)
      })
      await check(`OS ${scheme} · ${stripName} tab strip: glyph drawn in white`, async () => {
        // The strip itself is near-white on light, so measure on the dark strip.
        const { glyph } = await bestContrast(page, svg.href, STRIPS.dark)
        assert.ok(glyph > 150, `only ${glyph} white glyph pixels`)
      })
      await check(`OS ${scheme} · ${stripName} tab strip: glyph at full size`, async () => {
        // Cropped viewBox: the glyph spans ~61px of 64. Uncropped it was ~54,
        // and the shrunken one in the first tile ~42.
        const { glyphW, glyphH } = await bestContrast(page, svg.href, STRIPS.dark)
        assert.ok(glyphW >= 58 && glyphH >= 58, `glyph ${glyphW}×${glyphH}px of 64`)
      })
    }
  }
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
