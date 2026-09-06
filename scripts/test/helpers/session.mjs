/**
 * Test sign-in.
 *
 * Routes no longer accept a telegramId — identity comes from the session cookie —
 * so every suite has to hold a real session. /api/auth/dev-login mints one and
 * 404s outside development, which is exactly what the tests need.
 *
 * Node's fetch has no cookie jar, so the Set-Cookie value is captured and replayed
 * by hand. Browsers do this themselves; UI tests just navigate to the dev-login URL.
 */

export const DEV_LOGIN = "/api/auth/dev-login"

/** Signs in as a synthetic user and returns the Cookie header value. */
export async function signIn(base, telegramId, name = "test-user") {
  const res = await fetch(
    `${base}${DEV_LOGIN}?telegramId=${telegramId}&name=${encodeURIComponent(name)}`,
    { redirect: "manual" }
  )

  if (res.status === 404) {
    throw new Error(
      "dev-login returned 404 — the dev server must run with NODE_ENV=development"
    )
  }
  if (res.status !== 303) {
    throw new Error(`dev-login failed: HTTP ${res.status}`)
  }

  const setCookie = res.headers.getSetCookie?.() ?? []
  const session = setCookie
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("mfca_session="))

  if (!session) throw new Error("dev-login set no session cookie")
  return session
}

/** fetch() with a session cookie attached. */
export function authedFetch(cookie) {
  return (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie },
    })
}

/** POST JSON as a signed-in user. */
export function authedPost(base, cookie) {
  return async (path, body) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    })
    const text = await res.text()
    let json = {}
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, json, text, headers: res.headers }
  }
}

/**
 * Signs a browser context in by navigating to dev-login; the browser keeps the
 * cookie for the rest of the session.
 */
export async function signInBrowser(page, base, telegramId, name = "ui-test") {
  // dev-login 303s to "/", and in dev Next compiles that route on first hit,
  // which can take well over Playwright's 30s default.
  const res = await page.goto(
    `${base}${DEV_LOGIN}?telegramId=${telegramId}&name=${encodeURIComponent(name)}`,
    { waitUntil: "domcontentloaded", timeout: 120_000 }
  )
  if (res && res.status() >= 400) {
    throw new Error(`dev-login failed in browser: HTTP ${res.status()}`)
  }
}
