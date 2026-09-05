/**
 * Request body size caps, checked before the body is read.
 *
 * `Content-Length` is a declared value, not a measured one, so this is a cheap
 * first filter rather than a guarantee: a chunked request omits the header
 * entirely. Routes that accept arrays must therefore *also* bound the array
 * length after parsing (see MAX_TRADES_PER_REQUEST), which is the check that
 * actually protects the database.
 */

/** Enough for any JSON body in this app that is not a trade batch. */
export const DEFAULT_BODY_LIMIT = 32 * 1024

/**
 * Trade imports are the one genuinely large payload. A Jupiter Perps CSV of
 * ~10k trades serialises to roughly 2 MB, so the cap is set above a realistic
 * worst case rather than at a typical one.
 */
export const TRADE_BATCH_BODY_LIMIT = 4 * 1024 * 1024

/** Row cap for a single trades payload — the bound the insert loop relies on. */
export const MAX_TRADES_PER_REQUEST = 10_000

/** Cap for the id list `/api/import/check-ids` accepts. */
export const MAX_IDS_PER_REQUEST = 10_000

/**
 * Returns a 413 when the declared body is over `limit`, or null to continue.
 *
 *   const tooLarge = enforceBodyLimit(request)
 *   if (tooLarge) return tooLarge
 */
export function enforceBodyLimit(
  request: Request,
  limit: number = DEFAULT_BODY_LIMIT
): Response | null {
  const declared = request.headers.get("content-length")
  if (declared === null) return null

  const size = Number(declared)
  // A non-numeric Content-Length is malformed rather than large; let the body
  // parser reject it so the client gets a 400 instead of a misleading 413.
  if (!Number.isFinite(size)) return null

  if (size > limit) {
    return Response.json(
      { error: `Request body too large (max ${limit} bytes)` },
      { status: 413 }
    )
  }
  return null
}
