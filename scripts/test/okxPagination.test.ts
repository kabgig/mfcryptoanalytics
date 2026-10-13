/**
 * OKX positions-history pagination.
 *
 * `after` is a uTime in ms ("records earlier than"). The adapter used to pass the
 * last record's posId — a ~4.5e17 number OKX reads as a far-future date — so it
 * got the first page back on every request and never finished. Accounts with
 * fewer than 100 positions in the window never paged and never noticed; the
 * first account to cross 100 stopped syncing entirely (2026-10-06).
 *
 * `fetch` is replaced by a fake that implements the documented semantics, so
 * these run offline. It refuses to answer more than MAX_CALLS requests: on the
 * old code that is what turns an endless loop into a failing test.
 */
import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { fetchFuturesTrades } from "@/lib/exchanges/adapters/okx/futures"
import type { OKXPosition } from "@/lib/exchanges/adapters/okx/types"

const MAX_CALLS = 12
const NEWEST = 1791000000000 // 2026-10-03
const realFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = realFetch })

function position(i: number, over: Partial<OKXPosition> = {}): OKXPosition {
  const uTime = NEWEST - i * 60_000
  return {
    // Real posIds are this size, which is what made them a disastrous cursor.
    posId: `3559128158201${String(i).padStart(6, "0")}`,
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    mgnMode: "cross",
    openMaxPos: "1",
    openAvgPx: "100",
    closeAvgPx: "101",
    pnl: String(i + 1),
    lever: "10",
    cTime: String(uTime - 30_000),
    uTime: String(uTime),
    ...over,
  }
}

interface FakeOkx {
  calls: URLSearchParams[]
}

/** Serves `book[instType]` the way OKX does: newest first, `after` = earlier than uTime. */
function fakeOkx(
  book: Record<string, OKXPosition[]>,
  opts: { ignoreCursor?: boolean; respond?: (q: URLSearchParams) => Response | null } = {}
): FakeOkx {
  const state: FakeOkx = { calls: [] }
  globalThis.fetch = (async (input: string | URL | Request) => {
    const q = new URL(String(input)).searchParams
    state.calls.push(q)
    if (state.calls.length > MAX_CALLS) {
      throw new Error(`runaway pagination: more than ${MAX_CALLS} requests`)
    }
    const custom = opts.respond?.(q)
    if (custom) return custom

    const limit = Number(q.get("limit") ?? 100)
    const after = q.get("after")
    const rows = [...(book[q.get("instType") ?? ""] ?? [])]
      .sort((a, b) => Number(b.uTime) - Number(a.uTime))
      .filter((p) => opts.ignoreCursor || !after || Number(p.uTime) < Number(after))

    // Every record sharing the boundary uTime comes back in the same page.
    let page = rows.slice(0, limit)
    if (page.length === limit) {
      const edge = page[page.length - 1].uTime
      page = rows.filter((p, i) => i < limit || p.uTime === edge)
    }
    return Response.json({ code: "0", msg: "", data: page })
  }) as typeof fetch
  return state
}

const swap = (n: number) => Array.from({ length: n }, (_, i) => position(i))

// --- the fix --------------------------------------------------------------------

test("250 SWAP positions: every one fetched exactly once (failed before the fix)", async () => {
  const okx = fakeOkx({ SWAP: swap(250) })
  const trades = await fetchFuturesTrades("k", "s", "p")

  assert.equal(trades.length, 250)
  assert.equal(new Set(trades.map((t) => t.id)).size, 250, "no duplicate ids")
  // 3 SWAP pages (100/100/50) + 1 FUTURES page.
  assert.equal(okx.calls.length, 4)
})

test("cursor is the oldest uTime of the previous page, never a posId", async () => {
  const book = swap(150)
  const okx = fakeOkx({ SWAP: book })
  await fetchFuturesTrades("k", "s", "p")

  const second = okx.calls[1]
  assert.equal(second.get("instType"), "SWAP")
  assert.equal(second.get("after"), book[99].uTime)
})

test("records sharing the boundary uTime are neither skipped nor repeated", async () => {
  // Positions 95..104 all closed in the same millisecond, straddling the page edge.
  const book = swap(180).map((p, i) =>
    i >= 95 && i <= 104 ? { ...p, uTime: String(NEWEST - 95 * 60_000) } : p
  )
  fakeOkx({ SWAP: book })
  const trades = await fetchFuturesTrades("k", "s", "p")

  assert.equal(trades.length, 180)
  assert.equal(new Set(trades.map((t) => t.id)).size, 180)
})

// --- guards ---------------------------------------------------------------------

test("an exchange that ignores the cursor cannot loop forever", async () => {
  const okx = fakeOkx({ SWAP: swap(250) }, { ignoreCursor: true })
  const trades = await fetchFuturesTrades("k", "s", "p")

  // Page 1, its re-served copy (stall detected), then FUTURES.
  assert.equal(okx.calls.length, 3)
  assert.equal(trades.length, 100, "the re-served page is deduped")
})

// --- regressions ----------------------------------------------------------------

test("under 100 positions: one request per instType, no cursor sent", async () => {
  const okx = fakeOkx({ SWAP: swap(69), FUTURES: [position(500, { instId: "BTC-USDT-261225", instType: "FUTURES" })] })
  const trades = await fetchFuturesTrades("k", "s", "p")

  assert.equal(trades.length, 70)
  assert.equal(okx.calls.length, 2)
  assert.deepEqual(okx.calls.map((q) => q.get("instType")), ["SWAP", "FUTURES"])
  assert.ok(okx.calls.every((q) => !q.has("after")))
})

test("exactly 100 positions: second page is empty and ends the loop", async () => {
  const okx = fakeOkx({ SWAP: swap(100) })
  const trades = await fetchFuturesTrades("k", "s", "p")

  assert.equal(trades.length, 100)
  assert.equal(okx.calls.length, 3) // SWAP p1, SWAP p2 (empty), FUTURES
})

test("cursor resets between SWAP and FUTURES", async () => {
  const futures = Array.from({ length: 120 }, (_, i) =>
    position(1000 + i, { instId: "ETH-USDT-261225", instType: "FUTURES" })
  )
  const okx = fakeOkx({ SWAP: swap(130), FUTURES: futures })
  const trades = await fetchFuturesTrades("k", "s", "p")

  assert.equal(trades.length, 250)
  const firstFutures = okx.calls.find((q) => q.get("instType") === "FUTURES")!
  assert.equal(firstFutures.has("after"), false)
})

test("zero-pnl positions are still dropped", async () => {
  const book = swap(120).map((p, i) => (i % 10 === 0 ? { ...p, pnl: "0" } : p))
  fakeOkx({ SWAP: book })
  const trades = await fetchFuturesTrades("k", "s", "p")
  assert.equal(trades.length, 108)
})

test("ids are unchanged: okx-futures-<posId>-<cTime>", async () => {
  const p = position(0)
  fakeOkx({ SWAP: [p] })
  const [t] = await fetchFuturesTrades("k", "s", "p")
  assert.equal(t.id, `okx-futures-${p.posId}-${p.cTime}`)
  assert.equal(t.ticker, "BTCUSDT")
  assert.equal(t.closeTime, new Date(Number(p.uTime)).toISOString())
})

test("OKX API error still throws, so the route falls back to stored trades", async () => {
  fakeOkx({}, { respond: () => Response.json({ code: "50111", msg: "Invalid OK-ACCESS-KEY", data: [] }) })
  await assert.rejects(fetchFuturesTrades("k", "s", "p"), /API error 50111/)
})

test("HTTP error still throws", async () => {
  fakeOkx({}, { respond: () => new Response("nope", { status: 401 }) })
  await assert.rejects(fetchFuturesTrades("k", "s", "p"), /error 401/)
})

test("a failure on a later page still throws (no silent partial result)", async () => {
  fakeOkx({ SWAP: swap(250) }, {
    respond: (q) => (q.has("after") ? Response.json({ code: "50011", msg: "Rate limit", data: [] }) : null),
  })
  await assert.rejects(fetchFuturesTrades("k", "s", "p"), /50011/)
})
