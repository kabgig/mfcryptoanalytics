/**
 * Folding a server snapshot into state the user is already editing.
 *
 * The dashboard loads its notes, overrides and soft-deleted trades once on
 * mount and, until this existed, replaced each collection wholesale when the
 * response arrived. Every save in between is optimistic and per-item, so a slow
 * response overwrote writes that had already reached Postgres: the row reverted
 * on screen and exported blank, even though the data was safe in the database.
 * It took a cold serverless start (or `next dev` compiling the route — measured
 * at 9.7s inside a 12.3s request) to open the window, which is what made it an
 * intermittent failure rather than an obvious one.
 *
 * The merge is driven by a record of what the user *intended*, not by comparing
 * the response against current state:
 *
 *   key → value  the user set it; that value wins over the snapshot
 *   key → null   the user cleared it; it stays gone
 *   key absent   the user has not touched it; the snapshot is authoritative
 *
 * Deriving intent from state instead — "in the snapshot but missing locally,
 * so the user must have cleared it" — was tried first and is wrong. It cannot
 * tell a deliberate clear from a key that local state lost for any other
 * reason, and in the second case it deletes a perfectly good server record.
 * That produced exactly the bug it was meant to fix, just less often. Recording
 * the intent at the point of the write does not depend on state being correct.
 *
 * A plain `{ ...server, ...local }` is not enough either: it restores a value
 * the user just wrote, but resurrects one they just deleted, since a deleted
 * entry is simply absent from `local`.
 */

/** What the user has done to one key since mount: a value, or null for cleared. */
export type LocalIntents<T> = ReadonlyMap<string, T | null>

/**
 * The server's map, with every key the user has touched since mount left the
 * way they left it.
 */
export function mergeServerSnapshot<T>(
  server: Record<string, T>,
  intents: LocalIntents<T>
): Record<string, T> {
  // The overwhelmingly common case: the response beat the user to it, so the
  // snapshot is authoritative and there is nothing to merge.
  if (intents.size === 0) return server

  const next = { ...server }
  for (const [key, value] of intents) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

/**
 * The list form of the same problem, for state held as an array rather than a
 * map — the soft-deleted trades behind the "Show deleted" toggle.
 *
 * That list has two writers, like the maps: the loader that replaces it
 * wholesale, and handleDelete/handleRestore, which add and remove one trade
 * optimistically. The delete button appears as soon as the main table renders,
 * which is routinely before /api/trades/deleted answers — so a trade deleted in
 * that window was dropped from the list again the moment the response landed,
 * and the "Show deleted" toggle vanished with it.
 *
 * Trades the user has touched lead, matching the prepend handleDelete does;
 * everything else follows in the order the server sent it.
 */
export function mergeServerList<T>(
  server: T[],
  intents: LocalIntents<T>,
  keyOf: (item: T) => string
): T[] {
  if (intents.size === 0) return server

  const kept: T[] = []
  for (const value of intents.values()) if (value !== null) kept.push(value)

  return [...kept, ...server.filter((item) => !intents.has(keyOf(item)))]
}
