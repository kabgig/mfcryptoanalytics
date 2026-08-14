import test from "node:test"
import assert from "node:assert/strict"
import {
  DUST,
  buildAllocation,
  buildDcaSeries,
  buildPortfolioSeries,
  computeBackfillGaps,
  computeHolding,
  computeHoldings,
  computeTotals,
  dayRange,
  firstTradeDay,
  heldQty,
  shiftDay,
  tickersOf,
} from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"

let seq = 0
function entry(over: Partial<SpotEntry> & { qty: number; price: number; tradedAt: string }): SpotEntry {
  return {
    id: String(++seq),
    ticker: "BTC",
    side: "BUY",
    ...over,
  }
}

const close = (v: number) => (a: number) => Math.abs(a - v) < 1e-6

test("average entry blends multiple buys by weight, not by count", () => {
  // 1 @ 100 and 3 @ 200 → 700 spent for 4 units → 175, not the 150 a naive
  // mean of the two prices would give.
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 3, price: 200, tradedAt: "2026-02-01T00:00:00.000Z" }),
    ],
    null
  )
  assert.equal(h.qty, 4)
  assert.ok(close(175)(h.avgEntry as number))
  assert.ok(close(700)(h.costBasis))
  assert.equal(h.buyCount, 2)
})

test("a partial sell leaves the average entry untouched", () => {
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 2, price: 200, tradedAt: "2026-02-01T00:00:00.000Z" }),
      entry({ qty: 1, price: 500, side: "SELL", tradedAt: "2026-03-01T00:00:00.000Z" }),
    ],
    null
  )
  assert.equal(h.qty, 3)
  assert.ok(close(150)(h.avgEntry as number), "avg stays 150 after selling at 500")
  assert.ok(close(450)(h.costBasis))
  assert.ok(close(350)(h.realisedPnl), "realised = 1 * (500 - 150)")
})

test("selling the whole position resets the cost basis and average", () => {
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 2, price: 300, side: "SELL", tradedAt: "2026-02-01T00:00:00.000Z" }),
    ],
    null
  )
  assert.equal(h.qty, 0)
  assert.equal(h.costBasis, 0)
  assert.equal(h.avgEntry, null, "a closed position has no average entry")
  assert.ok(close(400)(h.realisedPnl))
})

test("re-buying after a full sell starts a fresh average, not a blend", () => {
  // Without the reset the old 100-cost lot would drag the new average down to
  // ~550; the correct answer is the new cycle's own price.
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 2, price: 300, side: "SELL", tradedAt: "2026-02-01T00:00:00.000Z" }),
      entry({ qty: 1, price: 1000, tradedAt: "2026-03-01T00:00:00.000Z" }),
    ],
    null
  )
  assert.equal(h.qty, 1)
  assert.ok(close(1000)(h.avgEntry as number))
  assert.ok(close(1000)(h.costBasis))
})

test("float dust from a full sell still counts as flat", () => {
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 0.1 + 0.2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 0.3, price: 200, side: "SELL", tradedAt: "2026-02-01T00:00:00.000Z" }),
    ],
    null
  )
  // 0.1 + 0.2 === 0.30000000000000004, so a residue below DUST remains.
  assert.ok(h.qty < DUST)
  assert.equal(h.qty, 0)
  assert.equal(h.avgEntry, null)
  assert.equal(h.costBasis, 0)
})

test("overselling is clamped and never drives quantity negative", () => {
  const h = computeHolding(
    "BTC",
    [
      entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ qty: 99, price: 200, side: "SELL", tradedAt: "2026-02-01T00:00:00.000Z" }),
    ],
    null
  )
  assert.equal(h.qty, 0)
  assert.ok(close(100)(h.realisedPnl), "only the 1 unit actually held is realised")
})

test("entries are replayed in trade order regardless of input order", () => {
  const late = entry({ qty: 3, price: 200, tradedAt: "2026-02-01T00:00:00.000Z" })
  const early = entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" })
  const h = computeHolding("BTC", [late, early], null)
  assert.ok(close(175)(h.avgEntry as number))
})

test("unrealised PnL and percent derive from the live price", () => {
  const h = computeHolding(
    "BTC",
    [entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" })],
    150
  )
  assert.ok(close(300)(h.marketValue as number))
  assert.ok(close(100)(h.unrealisedPnl as number))
  assert.ok(close(50)(h.unrealisedPct as number))
})

test("a ticker with no price feed reports value as null, not zero", () => {
  const h = computeHolding(
    "WEIRD",
    [entry({ ticker: "WEIRD", qty: 5, price: 2, tradedAt: "2026-01-01T00:00:00.000Z" })],
    null
  )
  assert.equal(h.marketValue, null)
  assert.equal(h.unrealisedPnl, null)
  assert.equal(h.unrealisedPct, null)
  assert.ok(close(10)(h.costBasis), "cost basis is still known without a price")
})

test("computeHoldings splits by ticker and sorts by value", () => {
  const entries = [
    entry({ ticker: "ETH", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ ticker: "BTC", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
  ]
  const holdings = computeHoldings(entries, { BTC: 900, ETH: 100 })
  assert.deepEqual(holdings.map((h) => h.ticker), ["BTC", "ETH"])
})

test("totals ignore value for unpriced tickers but keep their cost", () => {
  const entries = [
    entry({ ticker: "BTC", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ ticker: "WEIRD", qty: 1, price: 50, tradedAt: "2026-01-01T00:00:00.000Z" }),
  ]
  const totals = computeTotals(computeHoldings(entries, { BTC: 200 }))
  assert.ok(close(150)(totals.costBasis))
  assert.ok(close(200)(totals.marketValue))
  assert.equal(totals.openTickers, 2)
})

test("allocation percentages cover priced holdings and sum to 100", () => {
  const entries = [
    entry({ ticker: "BTC", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ ticker: "ETH", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
  ]
  const alloc = buildAllocation(computeHoldings(entries, { BTC: 300, ETH: 100 }))
  assert.deepEqual(alloc.map((a) => a.ticker), ["BTC", "ETH"])
  assert.ok(close(75)(alloc[0].pct))
  assert.ok(close(100)(alloc.reduce((s, a) => s + a.pct, 0)))
})

test("allocation excludes closed positions", () => {
  const entries = [
    entry({ ticker: "BTC", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ ticker: "BTC", qty: 1, price: 100, side: "SELL", tradedAt: "2026-02-01T00:00:00.000Z" }),
    entry({ ticker: "ETH", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
  ]
  const alloc = buildAllocation(computeHoldings(entries, { BTC: 300, ETH: 100 }))
  assert.deepEqual(alloc.map((a) => a.ticker), ["ETH"])
})

test("dayRange is inclusive on both ends and crosses month boundaries", () => {
  assert.deepEqual(dayRange("2026-01-30", "2026-02-02"), [
    "2026-01-30",
    "2026-01-31",
    "2026-02-01",
    "2026-02-02",
  ])
  assert.deepEqual(dayRange("2026-01-01", "2026-01-01"), ["2026-01-01"])
})

test("DCA series breaks the average line across a fully-sold gap", () => {
  const entries = [
    entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ qty: 1, price: 200, side: "SELL", tradedAt: "2026-01-02T00:00:00.000Z" }),
    entry({ qty: 1, price: 500, tradedAt: "2026-01-04T00:00:00.000Z" }),
  ]
  const series = buildDcaSeries("BTC", entries, [], "2026-01-05")
  const byDate = Object.fromEntries(series.map((p) => [p.date, p.avgEntry]))

  assert.ok(close(100)(byDate["2026-01-01"] as number))
  assert.equal(byDate["2026-01-02"], null, "flat on the day of the closing sell")
  assert.equal(byDate["2026-01-03"], null, "still flat while holding nothing")
  assert.ok(close(500)(byDate["2026-01-04"] as number), "new cycle starts fresh")
})

test("DCA series marks buy and sell days and forward-fills market price", () => {
  const entries = [entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" })]
  const series = buildDcaSeries(
    "BTC",
    entries,
    [{ day: "2026-01-01", close: 120 }],
    "2026-01-03"
  )
  assert.equal(series[0].buyPrice, 100)
  assert.equal(series[1].buyPrice, undefined)
  // No candle for the 2nd/3rd — the last known close carries forward.
  assert.equal(series[1].market, 120)
  assert.equal(series[2].market, 120)
})

test("portfolio series tracks invested cash and market value per day", () => {
  const entries = [
    entry({ ticker: "BTC", qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ ticker: "BTC", qty: 1, price: 200, tradedAt: "2026-01-02T00:00:00.000Z" }),
  ]
  const series = buildPortfolioSeries(
    entries,
    { BTC: [{ day: "2026-01-01", close: 100 }, { day: "2026-01-02", close: 400 }] },
    "2026-01-02"
  )
  assert.equal(series.length, 2)
  assert.ok(close(100)(series[0].invested))
  assert.ok(close(100)(series[0].value as number))
  assert.ok(close(300)(series[1].invested), "cumulative cash in")
  assert.ok(close(800)(series[1].value as number), "2 units at 400")
})

test("portfolio value is null while no price is known for any holding", () => {
  const entries = [entry({ qty: 1, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" })]
  const series = buildPortfolioSeries(entries, {}, "2026-01-01")
  assert.equal(series[0].value, null)
  assert.ok(close(100)(series[0].invested))
})

test("a sell reduces cumulative invested cash", () => {
  const entries = [
    entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ qty: 1, price: 150, side: "SELL", tradedAt: "2026-01-02T00:00:00.000Z" }),
  ]
  const series = buildPortfolioSeries(entries, {}, "2026-01-02")
  assert.ok(close(200)(series[0].invested))
  assert.ok(close(50)(series[1].invested), "200 in, 150 back out")
})

test("heldQty reports the sellable amount and clamps at zero", () => {
  const entries = [
    entry({ qty: 2, price: 100, tradedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ qty: 0.5, price: 150, side: "SELL", tradedAt: "2026-01-02T00:00:00.000Z" }),
  ]
  assert.ok(close(1.5)(heldQty(entries, "BTC")))
  assert.equal(heldQty(entries, "ETH"), 0, "a ticker never bought holds nothing")
})

test("shiftDay moves across month and year boundaries", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28")
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01")
  assert.equal(shiftDay("2026-06-10", 0), "2026-06-10")
})

test("backfill fetches the whole span when nothing is cached", () => {
  assert.deepEqual(computeBackfillGaps("2026-01-01", undefined, "2026-03-01"), [
    ["2026-01-01", "2026-03-01"],
  ])
})

test("backfill tops up only the days since the last visit", () => {
  assert.deepEqual(
    computeBackfillGaps("2026-01-01", { min: "2026-01-01", max: "2026-02-25" }, "2026-03-01"),
    [["2026-02-26", "2026-03-01"]]
  )
})

test("backfill fills the older gap when an entry is backdated", () => {
  // The regression: the cache already reached today, so resuming only forward
  // fetched nothing and the chart had no market line before the cached window.
  assert.deepEqual(
    computeBackfillGaps("2025-09-15", { min: "2026-06-01", max: "2026-08-14" }, "2026-08-14"),
    [["2025-09-15", "2026-05-31"]]
  )
})

test("backfill fills both ends when the cache is a middle slice", () => {
  assert.deepEqual(
    computeBackfillGaps("2026-01-01", { min: "2026-02-01", max: "2026-02-10" }, "2026-03-01"),
    [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-11", "2026-03-01"],
    ]
  )
})

test("backfill asks for nothing when the cache already covers the range", () => {
  assert.deepEqual(
    computeBackfillGaps("2026-01-01", { min: "2026-01-01", max: "2026-03-01" }, "2026-03-01"),
    []
  )
})

test("empty input degrades gracefully everywhere", () => {
  assert.deepEqual(tickersOf([]), [])
  assert.equal(firstTradeDay([]), null)
  assert.deepEqual(computeHoldings([], {}), [])
  assert.deepEqual(buildPortfolioSeries([], {}, "2026-01-01"), [])
  assert.deepEqual(buildDcaSeries("BTC", [], [], "2026-01-01"), [])
  assert.deepEqual(buildAllocation([]), [])
  assert.equal(computeTotals([]).unrealisedPct, null)
})
