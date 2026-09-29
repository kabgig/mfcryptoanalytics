import test from "node:test"
import assert from "node:assert/strict"
import { strFromU8, unzipSync } from "fflate"
import {
  SPOT_SUMMARY_COLUMNS,
  SPOT_TOKEN_COLUMNS,
  buildSpotCsv,
  buildSpotExportFiles,
  buildSpotSummaryCsv,
  buildSpotTokensCsv,
  buildSpotZip,
} from "@/lib/services/spotExportService"
import { downloadBlob, downloadCsv } from "@/lib/services/exportService"
import { computeHoldings, computeTotals } from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"

let seq = 0
function entry(over: Partial<SpotEntry> & { qty: number; price: number; tradedAt: string }): SpotEntry {
  return { id: String(++seq), ticker: "BTC", side: "BUY", ...over }
}

/** CSV → one record per row, keyed by header. These files never quote a field. */
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

/** Decodes keeping a leading BOM — TextDecoder (and so strFromU8) drops it by default. */
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)

const near = (actual: string | number | null | undefined, expected: number) =>
  assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `expected ${expected}, got ${actual}`)

const NOW = new Date("2026-09-29T10:00:00.000Z")

// BTC: open, priced, with a banked partial sell.
// SOL: fully sold — closed, realised PnL only; then an oversold SELL of nothing.
// XYZ: open but no price feed.
const portfolio = () => [
  entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" }),
  entry({ qty: 3, price: 200, tradedAt: "2026-07-01T12:00:00.000Z" }),
  entry({ side: "SELL", qty: 1, price: 500, tradedAt: "2026-08-01T12:00:00.000Z" }),
  entry({ ticker: "SOL", qty: 2, price: 10, tradedAt: "2026-05-01T12:00:00.000Z" }),
  entry({ ticker: "SOL", side: "SELL", qty: 2, price: 25, tradedAt: "2026-05-10T12:00:00.000Z" }),
  entry({ ticker: "SOL", side: "SELL", qty: 1, price: 30, tradedAt: "2026-05-11T12:00:00.000Z" }),
  entry({ ticker: "XYZ", qty: 10, price: 5, tradedAt: "2026-09-20T12:00:00.000Z" }),
]
const PRICES = { BTC: 300, SOL: 40 }

// ---------------------------------------------------------------- zip

test("the zip holds exactly summary, tokens and ledger, each BOM-prefixed", async () => {
  const files = unzipSync(await buildSpotZip(portfolio(), PRICES, NOW))
  assert.deepEqual(Object.keys(files).sort(), ["ledger.csv", "summary.csv", "tokens.csv"])
  for (const [name, bytes] of Object.entries(files)) {
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], `${name} is missing its BOM`)
  }
})

test("each file in the zip is byte-for-byte its CSV builder's output", async () => {
  const files = unzipSync(await buildSpotZip(portfolio(), PRICES, NOW))
  const expected = buildSpotExportFiles(portfolio(), PRICES, NOW)
  for (const name of Object.keys(expected)) {
    assert.equal(text(files[name]), "\uFEFF" + expected[name], name)
  }
  // The ledger is the pre-zip export, unchanged.
  assert.equal(text(files["ledger.csv"]), "\uFEFF" + buildSpotCsv(portfolio(), PRICES))
})

test("non-ASCII notes survive the zip as UTF-8", async () => {
  const note = "купил на откате — 🚀"
  const files = unzipSync(
    await buildSpotZip(
      [entry({ qty: 1, price: 1, tradedAt: "2026-06-01T12:00:00.000Z",
        journal: { planned: null, why: [], feeling: [], note } })],
      {},
      NOW
    )
  )
  assert.ok(strFromU8(files["ledger.csv"]).includes(note))
})

// ---------------------------------------------------------------- tokens.csv

test("tokens: header is exactly the declared columns", () => {
  const header = buildSpotTokensCsv([]).split("\r\n")[0].split(",")
  assert.deepEqual(header, SPOT_TOKEN_COLUMNS.map((c) => c.header))
  assert.deepEqual(header, [
    "ticker", "status", "holding", "avgEntry", "currentPrice", "costBasis", "totalInvested",
    "marketValue", "unrealisedPnl", "unrealisedPnlPct", "realisedPnl", "allocationPct",
    "buyCount", "sellCount", "firstEntryAt", "lastEntryAt",
  ])
})

test("tokens: no entries → header only", () => {
  assert.deepEqual(records(buildSpotTokensCsv([])), [])
})

test("tokens: one row per ticker, closed ones included, in the dashboard's order", () => {
  const rows = records(buildSpotTokensCsv(portfolio(), PRICES))
  assert.deepEqual(
    rows.map((r) => r.ticker),
    computeHoldings(portfolio(), PRICES).map((h) => h.ticker)
  )
  assert.deepEqual(rows.map((r) => r.ticker).sort(), ["BTC", "SOL", "XYZ"])
})

test("tokens: an open priced ticker matches computeHolding", () => {
  const btc = records(buildSpotTokensCsv(portfolio(), PRICES)).find((r) => r.ticker === "BTC")!
  assert.equal(btc.status, "open")
  near(btc.holding, 3)
  near(btc.avgEntry, 175)
  assert.equal(btc.currentPrice, "300")
  near(btc.costBasis, 525)
  near(btc.totalInvested, 700)
  near(btc.marketValue, 900)
  near(btc.unrealisedPnl, 375)
  near(btc.unrealisedPnlPct, (375 / 525) * 100)
  near(btc.realisedPnl, 325)
  assert.equal(btc.buyCount, "2")
  assert.equal(btc.sellCount, "1")
  assert.equal(btc.firstEntryAt, "2026-06-01T12:00:00.000Z")
  assert.equal(btc.lastEntryAt, "2026-08-01T12:00:00.000Z")
})

test("tokens: a closed ticker keeps its realised PnL with holding 0", () => {
  const sol = records(buildSpotTokensCsv(portfolio(), PRICES)).find((r) => r.ticker === "SOL")!
  assert.equal(sol.status, "closed")
  assert.equal(sol.holding, "0")
  assert.equal(sol.avgEntry, "", "a closed position has no average")
  assert.equal(sol.costBasis, "0")
  near(sol.totalInvested, 20)
  near(sol.realisedPnl, 30)
  assert.equal(sol.allocationPct, "", "closed positions take no allocation")
  assert.equal(sol.sellCount, "1", "the SELL of nothing held is not counted")
  assert.equal(sol.lastEntryAt, "2026-05-11T12:00:00.000Z", "…but it is still the last entry")
})

test("tokens: an unpriced ticker leaves value and PnL blank, never 0", () => {
  const xyz = records(buildSpotTokensCsv(portfolio(), PRICES)).find((r) => r.ticker === "XYZ")!
  assert.equal(xyz.status, "open")
  near(xyz.holding, 10)
  near(xyz.costBasis, 50)
  for (const col of ["currentPrice", "marketValue", "unrealisedPnl", "unrealisedPnlPct", "allocationPct"]) {
    assert.equal(xyz[col], "", `${col} should be blank`)
  }
  assert.equal(xyz.realisedPnl, "0")
})

test("tokens: allocation covers the priced open tickers and sums to 100", () => {
  const rows = records(
    buildSpotTokensCsv(
      [
        entry({ qty: 1, price: 100, tradedAt: "2026-06-01T12:00:00.000Z" }),
        entry({ ticker: "ETH", qty: 1, price: 10, tradedAt: "2026-06-01T12:00:00.000Z" }),
      ],
      { BTC: 300, ETH: 100 }
    )
  )
  near(rows.find((r) => r.ticker === "BTC")!.allocationPct, 75)
  near(rows.find((r) => r.ticker === "ETH")!.allocationPct, 25)
})

// ---------------------------------------------------------------- summary.csv

test("summary: header is exactly the declared columns, with one data row", () => {
  const csv = buildSpotSummaryCsv(portfolio(), PRICES, NOW)
  assert.deepEqual(csv.split("\r\n")[0].split(","), SPOT_SUMMARY_COLUMNS.map((c) => c.header))
  assert.deepEqual(csv.split("\r\n")[0].split(","), [
    "exportedAt", "portfolioValue", "costBasis", "totalInvested", "unrealisedPnl",
    "unrealisedPnlPct", "realisedPnl", "openPositions", "tickers", "entries",
    "unpricedTickers", "firstEntryAt", "lastEntryAt",
  ])
  assert.equal(records(csv).length, 1)
})

test("summary: the totals are the dashboard tiles' computeTotals", () => {
  const [s] = records(buildSpotSummaryCsv(portfolio(), PRICES, NOW))
  const t = computeTotals(computeHoldings(portfolio(), PRICES))
  assert.equal(s.exportedAt, "2026-09-29T10:00:00.000Z")
  near(s.portfolioValue, t.marketValue) // 900 BTC + 0 SOL; XYZ unpriced
  near(s.portfolioValue, 900)
  near(s.costBasis, t.costBasis) // 525 + 0 + 50
  near(s.costBasis, 575)
  near(s.totalInvested, 770)
  near(s.unrealisedPnl, t.unrealisedPnl)
  near(s.unrealisedPnlPct, t.unrealisedPct!)
  near(s.realisedPnl, 355)
  assert.equal(s.openPositions, "2")
  assert.equal(s.tickers, "3")
  assert.equal(s.entries, "7")
  assert.equal(s.unpricedTickers, "XYZ", "flags why the value is understated")
  assert.equal(s.firstEntryAt, "2026-05-01T12:00:00.000Z")
  assert.equal(s.lastEntryAt, "2026-09-20T12:00:00.000Z")
})

test("summary: no entries → zeros, blank percentage and dates", () => {
  const [s] = records(buildSpotSummaryCsv([], {}, NOW))
  assert.equal(s.portfolioValue, "0")
  assert.equal(s.costBasis, "0")
  assert.equal(s.unrealisedPnlPct, "")
  assert.equal(s.openPositions, "0")
  assert.equal(s.entries, "0")
  assert.equal(s.unpricedTickers, "")
  assert.equal(s.firstEntryAt, "")
  assert.equal(s.lastEntryAt, "")
})

test("summary: several unpriced tickers are '|'-joined, sorted", () => {
  const [s] = records(
    buildSpotSummaryCsv(
      [
        entry({ ticker: "ZZZ", qty: 1, price: 1, tradedAt: "2026-06-01T12:00:00.000Z" }),
        entry({ ticker: "AAA", qty: 1, price: 1, tradedAt: "2026-06-01T12:00:00.000Z" }),
      ],
      {},
      NOW
    )
  )
  assert.equal(s.unpricedTickers, "AAA|ZZZ")
})

// ---------------------------------------------------------------- download helpers

/** Minimal DOM for the download helpers: records what the anchor was given. */
function fakeDom() {
  const clicks: { href: string; download: string }[] = []
  const blobs = new Map<string, Blob>()
  const revoked: string[] = []
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let n = 0
  URL.createObjectURL = (b: Blob) => {
    const url = `blob:test/${++n}`
    blobs.set(url, b)
    return url
  }
  URL.revokeObjectURL = (u: string) => void revoked.push(u)
  g.document = {
    createElement: () => {
      const a = { href: "", download: "", click: () => clicks.push({ href: a.href, download: a.download }), remove: () => {} }
      return a
    },
    body: { appendChild: () => {} },
  }
  const restore = () => {
    g.document = saved.document
    URL.createObjectURL = saved.create
    URL.revokeObjectURL = saved.revoke
  }
  return { clicks, blobs, revoked, restore }
}

test("downloadCsv still prefixes a BOM, keeps the CSV type and defers the revoke", async () => {
  const dom = fakeDom()
  try {
    downloadCsv("a,b\r\n", "trades-2026-09-29.csv")
    assert.deepEqual(dom.clicks.map((c) => c.download), ["trades-2026-09-29.csv"])
    const blob = dom.blobs.get(dom.clicks[0].href)!
    assert.equal(blob.type, "text/csv;charset=utf-8")
    // Blob.text() decodes as UTF-8 and would eat the BOM — check the raw bytes.
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())].slice(0, 3), [0xef, 0xbb, 0xbf])
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer()), "﻿a,b\r\n")
    assert.deepEqual(dom.revoked, [], "revoked synchronously — would race the download")
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(dom.revoked, [dom.clicks[0].href])
  } finally {
    dom.restore()
  }
})

test("downloadBlob hands the zip over untouched", async () => {
  const dom = fakeDom()
  try {
    const zip = await buildSpotZip(portfolio(), PRICES, NOW)
    downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), "spot-2026-09-29.zip")
    const blob = dom.blobs.get(dom.clicks[0].href)!
    assert.equal(dom.clicks[0].download, "spot-2026-09-29.zip")
    assert.equal(blob.type, "application/zip")
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), zip)
  } finally {
    dom.restore()
  }
})
