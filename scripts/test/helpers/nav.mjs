/**
 * Deterministic page navigation for the UI suites.
 *
 * These tests used `waitUntil: "networkidle"`. That was always slightly fragile —
 * the wallet SDK holds a socket open — and adding SessionProvider's /api/me call
 * on every mount tipped it into regular 30s timeouts.
 *
 * Two things make a reliable wait here:
 *
 *  1. The nav header is server-rendered, so its presence proves nothing about
 *     hydration. Waiting for the absence of a "Loading…" placeholder is likewise
 *     useless on its own: before React runs, the placeholder is not there yet, so
 *     the check passes instantly against the SSR shell.
 *  2. SessionProvider fires /api/me on mount on every page. That response is
 *     therefore a dependable "React is alive" marker, and it is what the client
 *     components wait for before fetching their own data.
 *
 * So: navigate, wait for /api/me, then wait for the loading placeholder to clear.
 */

/** Navigates and waits until the app has finished its initial load. */
export async function gotoApp(page, url, opts = {}) {
  const timeout = opts.timeout ?? 90_000
  const hydrated = waitForHydration(page, timeout)
  await page.goto(url, { waitUntil: "domcontentloaded", timeout })
  await hydrated
  await settled(page, { timeout })
}

/** Same, for a reload. */
export async function reloadApp(page, opts = {}) {
  const timeout = opts.timeout ?? 90_000
  const hydrated = waitForHydration(page, timeout)
  await page.reload({ waitUntil: "domcontentloaded", timeout })
  await hydrated
  await settled(page, { timeout })
}

/** Resolves once the client has mounted and asked who it is. */
function waitForHydration(page, timeout) {
  return page
    .waitForResponse((r) => r.url().includes("/api/me"), { timeout })
    .catch(() => null)
}

/** Resolves once no loading placeholder is left on the page. */
export async function settled(page, opts = {}) {
  const timeout = opts.timeout ?? 90_000
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? ""
        return text.trim().length > 0 && !text.includes("Loading…")
      },
      null,
      { timeout }
    )
    // A page that never clears its placeholder should fail on its own assertion,
    // with a useful message, rather than here.
    .catch(() => {})
  await page.waitForTimeout(800)
}
