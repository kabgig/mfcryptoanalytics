import test from "node:test"
import assert from "node:assert/strict"
import { mergeServerList, mergeServerSnapshot } from "@/lib/services/snapshot"

// --- mergeServerSnapshot: the notes and overrides maps ---------------------

test("an untouched map takes the server snapshot verbatim", () => {
  const server = { "OKX|a": { strategy: "orderflow" } }
  // Identity, not just equality: the no-write path must not copy or reshape.
  assert.equal(mergeServerSnapshot(server, new Map()), server)
})

test("a snapshot arriving after a write does not undo the write", () => {
  const merged = mergeServerSnapshot(
    { "OKX|a": { strategy: "breakout" } },                    // stale — pre-save
    new Map([["OKX|a", { strategy: "orderflow" }]])           // what the user saved
  )
  assert.deepEqual(merged, { "OKX|a": { strategy: "orderflow" } })
})

test("a snapshot does not resurrect an entry the user cleared", () => {
  // Why a plain { ...server, ...local } spread is not enough.
  const merged = mergeServerSnapshot(
    { "OKX|a": { strategy: "orderflow" }, "OKX|b": { bias: "buy" } },
    new Map([["OKX|a", null]])
  )
  assert.deepEqual(merged, { "OKX|b": { bias: "buy" } })
})

test("a key the user never cleared is taken from the server, not dropped", () => {
  // The regression that the first version of this helper caused: it inferred
  // "cleared" from the key being absent locally, so a key local state had lost
  // for any other reason took a good server record down with it.
  const merged = mergeServerSnapshot(
    { "OKX|a": { strategy: "orderflow" } },
    new Map()                                  // nothing recorded — hands off
  )
  assert.deepEqual(merged, { "OKX|a": { strategy: "orderflow" } })
})

test("a written key the server has never seen survives", () => {
  const merged = mergeServerSnapshot({}, new Map([["OKX|a", { strategy: "orderflow" }]]))
  assert.deepEqual(merged, { "OKX|a": { strategy: "orderflow" } })
})

test("keys the user never touched still come from the server", () => {
  const merged = mergeServerSnapshot(
    { "OKX|a": { strategy: "orderflow" }, "OKX|b": { bias: "sell" } },
    new Map([["OKX|a", { strategy: "reversal" }]])
  )
  assert.deepEqual(merged, {
    "OKX|a": { strategy: "reversal" },
    "OKX|b": { bias: "sell" },
  })
})

test("merging twice changes nothing the second time", () => {
  // StrictMode mounts effects twice in dev, so both GETs land and both merge.
  const server = { "OKX|a": { strategy: "breakout" } }
  const intents = new Map([["OKX|a", { strategy: "orderflow" }]])
  const once = mergeServerSnapshot(server, intents)
  assert.deepEqual(mergeServerSnapshot(server, intents), once)
})

test("the caller's server map is never mutated", () => {
  const server = { "OKX|a": { strategy: "breakout" } }
  mergeServerSnapshot(server, new Map([["OKX|a", { strategy: "orderflow" }]]))
  assert.deepEqual(server, { "OKX|a": { strategy: "breakout" } })
})

test("a reverted save re-records the value it reverted to", () => {
  // handleSaveOverride puts `previous` back on a failed POST and records it,
  // so the snapshot must then agree with what is on screen.
  const merged = mergeServerSnapshot(
    { "OKX|a": { strategy: "orderflow" } },
    new Map([["OKX|a", { strategy: "breakout" }]])
  )
  assert.deepEqual(merged, { "OKX|a": { strategy: "breakout" } })
})

// --- mergeServerList: the soft-deleted trades ------------------------------

const t = (id: string, exchange = "OKX") => ({ id, exchange })
const keyOf = (x: { exchange: string; id: string }) => `${x.exchange}|${x.id}`

test("an untouched list takes the server's list verbatim", () => {
  const server = [t("a"), t("b")]
  assert.equal(mergeServerList(server, new Map(), keyOf), server)
})

test("a trade deleted while the list was loading is not dropped again", () => {
  // The delete button renders before /api/trades/deleted answers, so this is
  // the ordinary case, not an edge one.
  assert.deepEqual(mergeServerList([], new Map([["OKX|a", t("a")]]), keyOf), [t("a")])
})

test("a trade restored while the list was loading is not resurrected", () => {
  const merged = mergeServerList([t("a"), t("b")], new Map([["OKX|a", null]]), keyOf)
  assert.deepEqual(merged, [t("b")])
})

test("trades the user never touched still come from the server", () => {
  const merged = mergeServerList([t("b"), t("c")], new Map([["OKX|a", t("a")]]), keyOf)
  assert.deepEqual(merged, [t("a"), t("b"), t("c")])
})

test("a locally deleted trade is not listed twice once the server agrees", () => {
  const merged = mergeServerList([t("a")], new Map([["OKX|a", t("a")]]), keyOf)
  assert.deepEqual(merged, [t("a")])
})

test("ids are only unique per exchange, so the key carries the exchange", () => {
  const merged = mergeServerList(
    [t("a", "Bybit")], new Map([["OKX|a", t("a", "OKX")]]), keyOf
  )
  assert.deepEqual(merged, [t("a", "OKX"), t("a", "Bybit")])
})
