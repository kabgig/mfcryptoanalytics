import test from "node:test"
import assert from "node:assert/strict"
import {
  SPOT_EXPORT_COLUMNS,
  buildSpotCsv,
  buildSpotLedger,
  spotExportFilename,
} from "@/lib/services/spotExportService"
import { computeHolding, tickersOf } from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"

let seq = 0
function entry(over: Partial<SpotEntry> & { qty: number; price: number; tradedAt: string }): SpotEntry {
  return { id: String(++seq), ticker: "BTC", side: "BUY", ...over }
}

/** CSV → one record per row, keyed by header. The export never quotes a field. */
function records(csv: string): Record<string, string>[] {
  const lines = csv.split("\r\n")
  assert.equal(lines.at(-1), "", "csv must end with CRLF")
  const [header, ...rows] = lines.slice(0, -1)
  const cols = header.split(",")
  return rows.map((line) => {
    const cells = line.split(",")
    assert.equal(cells.length, cols.length, `ragged row: ${line}`)
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]))
  })
}

const near = (actual: string | number | null, expected: number) =>
  assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `expected ${expected}, got ${actual}`)

// BTC: DCA in, partial sell, sell flat, re-buy.
const btcCycle = () => [
  entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" }),
  entry({ qty: 3, price: 200, tradedAt: "2026-07-01T12:00:00.000Z" }),
  entry({ side: "SELL", qty: 1, price: 500, tradedAt: "2026-08-01T12:00:00.000Z" }),
  entry({ side: "SELL", qty: 3, price: 150, tradedAt: "2026-08-11T12:00:00.000Z" }),
  entry({ qty: 2, price: 120, tradedAt: "2026-09-01T12:00:00.000Z" }),
]

test("header lists every column once, in declared order", () => {
  const header = buildSpotCsv([]).split("\r\n")[0].split(",")
  assert.deepEqual(header, SPOT_EXPORT_COLUMNS.map((c) => c.header))
  assert.equal(new Set(header).size, header.length, "duplicate header")
  for (const h of [
    "tradedAt", "ticker", "side", "qty", "price", "total",
    "qtyApplied", "oversold", "positionQty", "costBasis", "avgEntryBefore", "avgEntryAfter",
    "realisedPnl", "realisedPnlPct", "cumRealisedPnl",
    "cycle", "priceVsAvgPct", "daysSincePrevEntry", "currentPrice", "changeSinceEntryPct",
    "planned", "why", "feeling", "note",
  ]) assert.ok(header.includes(h), `missing ${h}`)
})

test("no entries → header only, still CRLF-terminated", () => {
  const csv = buildSpotCsv([])
  assert.equal(csv.split("\r\n").length, 2)
  assert.deepEqual(records(csv), [])
})

test("rows are newest first", () => {
  const rows = records(buildSpotCsv(btcCycle()))
  assert.deepEqual(
    rows.map((r) => r.tradedAt.slice(0, 10)),
    ["2026-09-01", "2026-08-11", "2026-08-01", "2026-07-01", "2026-06-01"]
  )
})

test("position, average and PnL follow the average-cost replay row by row", () => {
  const [b1, b2, s1, s2, rb] = buildSpotLedger(btcCycle())

  // First buy: nothing held before, so no average to compare against.
  assert.equal(b1.avgEntryBefore, null)
  assert.equal(b1.priceVsAvgPct, null)
  near(b1.avgEntryAfter, 100)
  assert.equal(b1.realisedPnl, null)
  assert.equal(b1.oversold, null)

  // Second buy at 200 vs avg 100 → +100%; weighted average 175, not 150.
  near(b2.priceVsAvgPct, 100)
  near(b2.avgEntryAfter, 175)
  near(b2.positionQty, 4)
  near(b2.costBasis, 700)

  // Partial sell leaves the average untouched and banks 1 * (500 - 175).
  near(s1.avgEntryBefore, 175)
  near(s1.avgEntryAfter, 175)
  near(s1.realisedPnl, 325)
  near(s1.realisedPnlPct, (500 / 175 - 1) * 100)
  near(s1.positionQty, 3)
  assert.equal(s1.oversold, false)

  // Selling flat at a loss: 3 * (150 - 175), position and basis reset.
  near(s2.realisedPnl, -75)
  near(s2.cumRealisedPnl, 250)
  assert.equal(s2.positionQty, 0)
  assert.equal(s2.costBasis, 0)
  assert.equal(s2.avgEntryAfter, null)
  assert.equal(s2.cycle, 1, "the closing sell belongs to the cycle it closes")

  // Re-buy opens cycle 2 with a fresh average, not blended with the old one.
  assert.equal(rb.cycle, 2)
  assert.equal(rb.avgEntryBefore, null)
  assert.equal(rb.priceVsAvgPct, null)
  near(rb.avgEntryAfter, 120)
  near(rb.cumRealisedPnl, 250)
})

test("daysSincePrevEntry counts calendar days within one ticker only", () => {
  const ledger = buildSpotLedger([
    entry({ qty: 1, price: 100, tradedAt: "2026-06-01T23:00:00.000Z" }),
    entry({ ticker: "ETH", qty: 1, price: 10, tradedAt: "2026-06-05T12:00:00.000Z" }),
    entry({ qty: 1, price: 100, tradedAt: "2026-06-11T01:00:00.000Z" }),
  ])
  const btc = ledger.filter((r) => r.entry.ticker === "BTC")
  const eth = ledger.find((r) => r.entry.ticker === "ETH")!
  assert.equal(btc[0].daysSincePrevEntry, null)
  assert.equal(btc[1].daysSincePrevEntry, 10, "23:00 → 01:00 across 10 dates is 10 days, not 9")
  assert.equal(eth.daysSincePrevEntry, null, "another ticker's entry is not a previous entry")
})

test("an oversold SELL is flagged and clamped to what was held", () => {
  const ledger = buildSpotLedger([
    entry({ ticker: "SOL", qty: 1, price: 10, tradedAt: "2026-06-01T12:00:00.000Z" }),
    entry({ ticker: "SOL", side: "SELL", qty: 2, price: 30, tradedAt: "2026-06-02T12:00:00.000Z" }),
    entry({ ticker: "SOL", side: "SELL", qty: 1, price: 30, tradedAt: "2026-06-03T12:00:00.000Z" }),
  ])
  const [, over, empty] = ledger
  assert.equal(over.oversold, true)
  near(over.qtyApplied, 1)
  near(over.realisedPnl, 20)
  assert.equal(over.positionQty, 0)

  // Nothing held at all: no units sold, nothing banked, no % against no average.
  assert.equal(empty.oversold, true)
  assert.equal(empty.qtyApplied, 0)
  assert.equal(empty.realisedPnl, 0)
  assert.equal(empty.realisedPnlPct, null)
  near(empty.cumRealisedPnl, 20)

  const csv = records(buildSpotCsv(ledger.map((r) => r.entry)))
  assert.deepEqual(csv.map((r) => r.oversold), ["yes", "yes", ""])
})

test("same-day entries replay by numeric id, so id 10 follows id 9", () => {
  const day = "2026-06-01T12:00:00.000Z"
  const ledger = buildSpotLedger([
    { id: "10", ticker: "BTC", side: "SELL", qty: 1, price: 200, tradedAt: day },
    { id: "9", ticker: "BTC", side: "BUY", qty: 1, price: 100, tradedAt: day },
  ])
  assert.deepEqual(ledger.map((r) => r.entry.id), ["9", "10"])
  assert.equal(ledger[1].oversold, false)
  near(ledger[1].realisedPnl, 100)
})

test("final state per ticker matches computeHolding exactly", () => {
  const entries = [
    ...btcCycle(),
    entry({ ticker: "ETH", qty: 2.5, price: 3100.12, tradedAt: "2026-05-03T12:00:00.000Z" }),
    entry({ ticker: "ETH", qty: 0.7, price: 2800.5, tradedAt: "2026-05-20T12:00:00.000Z" }),
    entry({ ticker: "ETH", side: "SELL", qty: 1.1, price: 3500, tradedAt: "2026-06-20T12:00:00.000Z" }),
    entry({ ticker: "PEPE", qty: 1e9, price: 0.0000081, tradedAt: "2026-04-01T12:00:00.000Z" }),
    entry({ ticker: "PEPE", side: "SELL", qty: 4e8, price: 0.0000123, tradedAt: "2026-04-09T12:00:00.000Z" }),
  ]
  const ledger = buildSpotLedger(entries)
  for (const t of tickersOf(entries)) {
    const h = computeHolding(t, entries.filter((e) => e.ticker === t), null)
    const last = ledger.filter((r) => r.entry.ticker === t).at(-1)!
    assert.equal(last.positionQty, h.qty, `${t} qty`)
    assert.equal(last.costBasis, h.costBasis, `${t} costBasis`)
    assert.equal(last.avgEntryAfter, h.avgEntry, `${t} avgEntry`)
    assert.equal(last.cumRealisedPnl, h.realisedPnl, `${t} realisedPnl`)
  }
})

test("current price fills today's columns; an unpriced ticker leaves them blank", () => {
  const rows = records(
    buildSpotCsv(
      [
        entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" }),
        entry({ ticker: "XYZ", qty: 1, price: 5, tradedAt: "2026-06-02T12:00:00.000Z" }),
      ],
      { BTC: 150 }
    )
  )
  const btc = rows.find((r) => r.ticker === "BTC")!
  const xyz = rows.find((r) => r.ticker === "XYZ")!
  assert.equal(btc.currentPrice, "150")
  near(btc.changeSinceEntryPct, 50)
  assert.equal(xyz.currentPrice, "")
  assert.equal(xyz.changeSinceEntryPct, "")
})

test("numbers are raw, without float noise or formatting", () => {
  const [row] = records(
    buildSpotCsv([entry({ qty: 0.1, price: 3, tradedAt: "2026-06-01T12:00:00.000Z" })])
  )
  assert.equal(row.total, "0.3", "0.1 * 3 must not export as 0.30000000000000004")
  assert.equal(row.qty, "0.1")
  assert.equal(row.price, "3")
  assert.equal(row.costBasis, "0.3")
  assert.equal(row.side, "BUY")
  assert.equal(row.cycle, "1")
  for (const v of Object.values(row)) assert.ok(!/[$%]/.test(v), `formatted cell: ${v}`)
})

test("tiny prices keep their significant digits", () => {
  const [row] = buildSpotLedger([
    entry({ ticker: "PEPE", qty: 3, price: 0.00000123456789, tradedAt: "2026-06-01T12:00:00.000Z" }),
  ])
  const csvRow = records(buildSpotCsv([row.entry]))[0]
  near(Number(csvRow.avgEntryAfter) / 0.00000123456789, 1)
})

test("spotExportFilename is date-stamped and distinct from the trades export", () => {
  assert.equal(spotExportFilename(new Date("2026-09-28T22:00:00Z")), "spot-2026-09-28.csv")
})

// ---------------------------------------------------------------- journal

/** RFC 4180 parse — the note is the one cell that may be quoted. */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [[]]
  let field = ""
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { rows.at(-1)!.push(field); field = "" }
    else if (ch === "\r" && csv[i + 1] === "\n") { rows.at(-1)!.push(field); field = ""; rows.push([]); i++ }
    else field += ch
  }
  rows.pop() // the empty row after the trailing CRLF
  const [header, ...body] = rows
  return body.map((r) => {
    assert.equal(r.length, header.length, `ragged row: ${r.join("|")}`)
    return Object.fromEntries(header.map((h, i) => [h, r[i]]))
  })
}

test("journal columns come last, after every computed column", () => {
  const header = SPOT_EXPORT_COLUMNS.map((c) => c.header)
  assert.deepEqual(header.slice(-4), ["planned", "why", "feeling", "note"])
  assert.equal(header.indexOf("changeSinceEntryPct"), header.length - 5)
})

test("journal fields export: yes/no, '|'-joined tags, the note verbatim", () => {
  const csv = parseCsv(buildSpotCsv([
    entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z",
      journal: { planned: true, why: ["dca", "dip"], feeling: ["calm", "fomo"], note: "plain" } }),
    entry({ side: "SELL", qty: 1, price: 150, tradedAt: "2026-06-02T12:00:00.000Z",
      journal: { planned: false, why: ["take_profit"], feeling: [], note: 'up 50%, "finally"\nnext: rebuy' } }),
  ]))
  const [sell, buy] = csv
  assert.equal(buy.planned, "yes")
  assert.equal(buy.why, "dca|dip")
  assert.equal(buy.feeling, "calm|fomo")
  assert.equal(buy.note, "plain")
  assert.equal(sell.planned, "no")
  assert.equal(sell.why, "take_profit")
  assert.equal(sell.feeling, "")
  assert.equal(sell.note, 'up 50%, "finally"\nnext: rebuy', "commas, quotes and newlines survive")
  // The computed columns before the note are still intact on the quoted row.
  assert.equal(sell.side, "SELL")
  near(sell.realisedPnl, 50)
})

test("an entry with no journal (legacy shape) exports four blank cells", () => {
  const [r] = parseCsv(buildSpotCsv([entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" })]))
  assert.deepEqual([r.planned, r.why, r.feeling, r.note], ["", "", "", ""])
  // And the plain split-by-comma reader above still works on journal-free data.
  assert.equal(records(buildSpotCsv([entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" })])).length, 1)
})
