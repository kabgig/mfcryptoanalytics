/**
 * Error responses that say nothing useful to an attacker.
 *
 * Routes used to return `String(err)` straight to the client. On this stack that
 * string is a Neon driver error: it carries SQL text, table and column names and
 * sometimes connection detail. None of it is actionable for a user, and all of it
 * is a free map of the schema for anyone probing the API.
 *
 * The `error` key is kept — eight client call sites branch on
 * `if (data.error) throw new Error(data.error)` — only its value changes.
 */

/** Logs the real error with a `[route]` prefix and returns a generic 500. */
export function serverError(route: string, err: unknown, status = 500): Response {
  console.error(`[${route}] error:`, err)
  return Response.json({ error: "Internal server error" }, { status })
}

/**
 * Same, for a failure that came from an upstream exchange rather than from us.
 *
 * The exchange's own message is worth keeping — "Incorrect apiKey" tells the user
 * what to fix — but it is bounded so a hostile or broken upstream cannot use our
 * response as an echo channel.
 */
export function upstreamError(route: string, err: unknown, status = 502): Response {
  console.error(`[${route}] upstream error:`, err)
  const message = err instanceof Error ? err.message : String(err)
  return Response.json({ error: message.slice(0, 200) }, { status })
}
