import test from "node:test"
import assert from "node:assert/strict"
import { computeLvsS } from "@/lib/services/lvsService"
import type { Trade, TradeOverridesMap } from "@/types"

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

// ------------------------------------------------------------------ bucketing

test("an exchange-reported side still buckets with no overrides at all", () => {
  const result = computeLvsS([
    trade({ id: "1", exchange: "Bybit", side: "long", pnl: 100 }),
    trade({ id: "2", exchange: "Bybit", side: "short", pnl: -40 }),
  ])
  assert.equal(result.long.tradeCount, 1)
  assert.equal(result.long.totalPnl, 100)
  assert.equal(result.short.tradeCount, 1)
  assert.equal(result.short.totalPnl, -40)
  assert.equal(result.unknownCount, 0)
  assert.equal(result.manualCount, 0)
})

test("a hand-set bias buckets a trade the exchange said nothing about", () => {
  // This is the whole point: OKX/Binance/MEXC/BingX/BYDFi/Jupiter report no
  // side, so before overrides every one of these fell into unknown.
  const trades = [
    trade({ id: "1", exchange: "OKX", pnl: 100 }),
    trade({ id: "2", exchange: "OKX", pnl: -40 }),
  ]
  const overrides: TradeOverridesMap = {
    "OKX|1": { bias: "buy" },
    "OKX|2": { bias: "sell" },
  }
  const before = computeLvsS(trades)
  assert.equal(before.unknownCount, 2, "precondition: both start unbucketed")

  const after = computeLvsS(trades, overrides)
  assert.equal(after.long.tradeCount, 1)
  assert.equal(after.long.totalPnl, 100)
  assert.equal(after.short.tradeCount, 1)
  assert.equal(after.short.totalPnl, -40)
  assert.equal(after.unknownCount, 0)
  assert.equal(after.manualCount, 2)
})

test("buy maps to long and sell to short", () => {
  const result = computeLvsS([trade({ id: "1", exchange: "OKX", pnl: 7 })], {
    "OKX|1": { bias: "buy" },
  })
  assert.equal(result.long.tradeCount, 1)
  assert.equal(result.short.tradeCount, 0)
})

test("a manual bias overrides the exchange's own side", () => {
  const trades = [trade({ id: "1", exchange: "Bybit", side: "long", pnl: 50 })]
  const result = computeLvsS(trades, { "Bybit|1": { bias: "sell" } })
  assert.equal(result.short.tradeCount, 1, "the user's bias must win")
  assert.equal(result.long.tradeCount, 0)
  assert.equal(result.manualCount, 1)
})

test("a tp/sl-only override does not bucket a trade", () => {
  // Filling in a stop loss says nothing about direction.
  const result = computeLvsS([trade({ id: "1", exchange: "OKX" })], {
    "OKX|1": { tp1: 70000, sl: 65000 },
  })
  assert.equal(result.unknownCount, 1)
  assert.equal(result.manualCount, 0)
})

test("overrides are matched per exchange, not by id alone", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", pnl: 10 }),
    trade({ id: "1", exchange: "MEXC", pnl: 20 }),
  ]
  const result = computeLvsS(trades, { "OKX|1": { bias: "buy" } })
  assert.equal(result.long.tradeCount, 1)
  assert.equal(result.long.totalPnl, 10)
  assert.deepEqual(result.unknownExchanges, ["MEXC"])
})

// -------------------------------------------------------------- the notice

test("exchangesWithoutSide names only the exchanges that report nothing", () => {
  const result = computeLvsS([
    trade({ id: "1", exchange: "Bybit", side: "long" }),
    trade({ id: "2", exchange: "OKX" }),
    trade({ id: "3", exchange: "MEXC" }),
  ])
  assert.deepEqual(result.exchangesWithoutSide, ["MEXC", "OKX"])
})

test("an exchange stays off the list once any of its trades reports a side", () => {
  // Guards the notice against naming an adapter that starts sending sides.
  const result = computeLvsS([
    trade({ id: "1", exchange: "Bitunix", side: "short" }),
    trade({ id: "2", exchange: "Bitunix" }),
  ])
  assert.deepEqual(result.exchangesWithoutSide, [])
  assert.equal(result.unknownCount, 1, "the sideless trade is still unbucketed")
})

test("exchangesWithoutSide survives the user filling every bias in", () => {
  // The exchange still does not report a side — it is the reason the values are
  // manual, so the notice must keep saying so even at unknownCount 0.
  const result = computeLvsS([trade({ id: "1", exchange: "OKX" })], {
    "OKX|1": { bias: "buy" },
  })
  assert.deepEqual(result.exchangesWithoutSide, ["OKX"])
  assert.equal(result.unknownCount, 0)
  assert.equal(result.manualCount, 1)
})

test("unknownExchanges lists where the still-unbucketed trades came from", () => {
  const result = computeLvsS(
    [
      trade({ id: "1", exchange: "OKX" }),
      trade({ id: "2", exchange: "MEXC" }),
      trade({ id: "3", exchange: "Binance" }),
    ],
    { "OKX|1": { bias: "buy" } }
  )
  assert.equal(result.unknownCount, 2)
  assert.deepEqual(result.unknownExchanges, ["Binance", "MEXC"])
})

// ---------------------------------------------------------------- stats math

test("the per-side stats are computed over the bias buckets", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", pnl: 100 }),
    trade({ id: "2", exchange: "OKX", pnl: -20 }),
    trade({ id: "3", exchange: "OKX", pnl: 40 }),
  ]
  const result = computeLvsS(trades, {
    "OKX|1": { bias: "buy" },
    "OKX|2": { bias: "buy" },
    "OKX|3": { bias: "sell" },
  })
  assert.equal(result.long.tradeCount, 2)
  assert.equal(result.long.winCount, 1)
  assert.equal(result.long.lossCount, 1)
  assert.equal(result.long.winRate, 50)
  assert.equal(result.long.totalPnl, 80)
  assert.equal(result.long.avgPnl, 40)
  assert.equal(result.long.bestTrade, 100)
  assert.equal(result.long.worstTrade, -20)
  assert.equal(result.short.tradeCount, 1)
  assert.equal(result.short.totalPnl, 40)
})

test("an empty trade list stays at zero rather than throwing", () => {
  const result = computeLvsS([])
  assert.equal(result.long.tradeCount, 0)
  assert.equal(result.short.tradeCount, 0)
  assert.equal(result.unknownCount, 0)
  assert.equal(result.manualCount, 0)
  assert.deepEqual(result.exchangesWithoutSide, [])
})
