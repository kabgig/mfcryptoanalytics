import test from "node:test"
import assert from "node:assert/strict"
import {
  buildTradesCsv,
  escapeCsvField,
  exportFilename,
  EXPORT_COLUMNS,
} from "@/lib/services/exportService"
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

/** Splits a CSV honouring quoted fields — the export writer's inverse. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ",") {
      row.push(field); field = ""
    } else if (c === "\r") {
      // consumed with the \n below
    } else if (c === "\n") {
      row.push(field); field = ""
      rows.push(row); row = []
    } else field += c
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// ------------------------------------------------------------------ csv rules

test("escapeCsvField only quotes when it has to", () => {
  assert.equal(escapeCsvField("BTCUSDT"), "BTCUSDT")
  assert.equal(escapeCsvField("a,b"), '"a,b"')
  assert.equal(escapeCsvField('he said "buy"'), '"he said ""buy"""')
  assert.equal(escapeCsvField("line1\nline2"), '"line1\nline2"')
})

test("buildTradesCsv emits a header plus one row per trade", () => {
  const csv = buildTradesCsv([
    trade({ id: "1", exchange: "OKX" }),
    trade({ id: "2", exchange: "Bybit" }),
  ])
  const rows = parseCsv(csv)
  assert.deepEqual(rows[0], [...EXPORT_COLUMNS])
  assert.equal(rows.length, 3)
})

test("buildTradesCsv joins each trade's note onto its own row", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", ticker: "BTCUSDT" }),
    trade({ id: "2", exchange: "OKX", ticker: "ETHUSDT" }),
    trade({ id: "1", exchange: "Bybit", ticker: "SOLUSDT" }),
  ]
  const overrides: TradeOverridesMap = {
    "OKX|1": { notes: "n1" },
    // Same id, other exchange: must not bleed onto OKX|1 or pick up its note.
    "Bybit|1": { notes: "bybit note" },
  }
  const [header, ...rows] = parseCsv(buildTradesCsv(trades, overrides))
  const col = (row: string[], name: string) => row[header.indexOf(name)]

  assert.equal(col(rows[0], "ticker"), "BTCUSDT")
  assert.equal(col(rows[0], "notes"), "n1")
  assert.equal(col(rows[1], "ticker"), "ETHUSDT")
  assert.equal(col(rows[1], "notes"), "", "a trade with no note exports blank")
  assert.equal(col(rows[2], "notes"), "bybit note")
})

test("the export carries one notes column, not the three per-phase ones", () => {
  assert.ok(EXPORT_COLUMNS.includes("notes"))
  for (const gone of ["noteBefore", "noteDuring", "noteAfter"]) {
    assert.equal(EXPORT_COLUMNS.includes(gone as never), false, `${gone} is still exported`)
  }
  // Last, where the three used to sit, so the structured columns stay together.
  assert.equal(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1], "notes")
})

test("a note full of commas, quotes and newlines survives a round trip", () => {
  // This is the whole reason the writer does real RFC 4180 escaping: journal
  // text is freeform and will contain every delimiter the format uses.
  const body = 'Entry at 3.5, "too big" a size\nStopped out; revenge-traded'
  const csv = buildTradesCsv([trade({ id: "1", exchange: "OKX" })], { "OKX|1": { notes: body } })
  const [header, row] = parseCsv(csv)
  assert.equal(row[header.indexOf("notes")], body)
  // And the escaping must not have leaked an extra record.
  assert.equal(parseCsv(csv).length, 2)
})

test("buildTradesCsv writes numbers raw so a spreadsheet reads them as numbers", () => {
  const [header, row] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "OKX", pnl: -1234.5, positionSize: 2000, tp: 70000 })])
  )
  assert.equal(row[header.indexOf("pnl")], "-1234.5")
  assert.equal(row[header.indexOf("positionSize")], "2000")
  // The exchange's single tp is exported as tp1 — the column was renamed when a
  // trade gained a second target.
  assert.equal(row[header.indexOf("tp1")], "70000")
  // sl is null on this trade — an empty cell, not the string "null"
  assert.equal(row[header.indexOf("sl")], "")
})

test("buildTradesCsv handles an empty trade list without losing the header", () => {
  assert.deepEqual(parseCsv(buildTradesCsv([])), [[...EXPORT_COLUMNS]])
})

test("exportFilename is date-stamped and sortable", () => {
  assert.equal(exportFilename(new Date("2026-08-15T22:00:00Z")), "trades-2026-08-15.csv")
})
