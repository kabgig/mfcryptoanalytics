import test from "node:test"
import assert from "node:assert/strict"
import { tradeKey, filterDeleted } from "@/lib/db/trades"
import { computeStats } from "@/lib/services/statsService"
import type { Trade } from "@/types"

function trade(over: Partial<Trade> & { id: string; exchange: string }): Trade {
  return {
    ticker: "BTCUSDT",
    positionSize: 1,
    tp: null,
    sl: null,
    openTime: "2026-08-01T00:00:00.000Z",
    closeTime: "2026-08-02T00:00:00.000Z",
    pnl: 10,
    ...over,
  }
}

test("tradeKey namespaces ids by exchange", () => {
  assert.equal(tradeKey("OKX", "abc"), "OKX|abc")
  assert.notEqual(tradeKey("OKX", "abc"), tradeKey("Bybit", "abc"))
})

test("filterDeleted removes only the matching trade", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX" }),
    trade({ id: "2", exchange: "OKX" }),
    trade({ id: "3", exchange: "Bybit" }),
  ]
  const result = filterDeleted(trades, new Set([tradeKey("OKX", "2")]))
  assert.deepEqual(result.map((t) => t.id), ["1", "3"])
})

test("filterDeleted does not cross exchanges for a shared id", () => {
  // Trade ids are only unique per exchange (see the cached_trades PK), so
  // deleting OKX|1 must leave Bybit|1 untouched.
  const trades = [
    trade({ id: "1", exchange: "OKX" }),
    trade({ id: "1", exchange: "Bybit" }),
  ]
  const result = filterDeleted(trades, new Set([tradeKey("OKX", "1")]))
  assert.deepEqual(result.map((t) => t.exchange), ["Bybit"])
})

test("filterDeleted returns the input untouched when nothing is deleted", () => {
  const trades = [trade({ id: "1", exchange: "OKX" })]
  assert.equal(filterDeleted(trades, new Set()), trades)
})

test("deleting a trade removes it from every aggregate", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", pnl: 100, closeTime: "2026-08-02T00:00:00.000Z" }),
    trade({ id: "2", exchange: "OKX", pnl: -50, closeTime: "2026-08-03T00:00:00.000Z" }),
    trade({ id: "3", exchange: "OKX", pnl: 25, closeTime: "2026-08-04T00:00:00.000Z" }),
  ]

  const before = computeStats(trades)
  assert.equal(before.tradeCount, 3)
  assert.equal(before.totalPnl, 75)
  assert.equal(before.profitFactor, 2.5) // 125 / 50

  const after = computeStats(filterDeleted(trades, new Set([tradeKey("OKX", "2")])))
  assert.equal(after.tradeCount, 2)
  assert.equal(after.totalPnl, 125)
  assert.equal(after.winRate, 100)
  assert.equal(after.profitFactor, null, "no losing trades left")
  assert.equal(after.maxDrawdown, 0, "the only drawdown came from the deleted trade")
})

test("restoring is the exact inverse of deleting, for the stats", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", pnl: 100 }),
    trade({ id: "2", exchange: "OKX", pnl: -50, closeTime: "2026-08-03T00:00:00.000Z" }),
  ]
  const original = computeStats(trades)
  const deleted = trades.filter((t) => t.id !== "2")
  const restored = computeStats([...deleted, trades[1]])

  assert.deepEqual(restored, original)
})
