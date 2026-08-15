import test from "node:test"
import assert from "node:assert/strict"
import { tradeKey } from "@/lib/db/trades"
import { rowsToNotesMap, isNotePhase, NOTE_PHASES } from "@/lib/db/tradeNotes"
import {
  buildTradesCsv,
  escapeCsvField,
  exportFilename,
  EXPORT_COLUMNS,
} from "@/lib/services/exportService"
import type { Trade, TradeNotesMap } from "@/types"

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

// ---------------------------------------------------------------- note phases

test("isNotePhase accepts exactly the three journalling moments", () => {
  assert.deepEqual(NOTE_PHASES, ["before", "during", "after"])
  for (const p of NOTE_PHASES) assert.ok(isNotePhase(p))
  for (const bad of ["BEFORE", "midway", "", null, undefined, 1]) {
    assert.equal(isNotePhase(bad), false, `${String(bad)} should not be a phase`)
  }
})

test("rowsToNotesMap groups the three phases onto one trade key", () => {
  const map = rowsToNotesMap([
    { exchange: "OKX", trade_id: "1", phase: "before", body: "breakout setup" },
    { exchange: "OKX", trade_id: "1", phase: "after", body: "took profit early" },
  ])
  assert.deepEqual(map, {
    "OKX|1": { before: "breakout setup", after: "took profit early" },
  })
  // during was never written, so it must be absent rather than empty-string
  assert.equal("during" in map["OKX|1"], false)
})

test("rowsToNotesMap keeps notes on same-id trades from different exchanges apart", () => {
  // Trade ids are only unique per exchange (see the cached_trades PK), so a note
  // on OKX|1 must not show up on Bybit|1.
  const map = rowsToNotesMap([
    { exchange: "OKX", trade_id: "1", phase: "before", body: "okx note" },
    { exchange: "Bybit", trade_id: "1", phase: "before", body: "bybit note" },
  ])
  assert.equal(map[tradeKey("OKX", "1")].before, "okx note")
  assert.equal(map[tradeKey("Bybit", "1")].before, "bybit note")
})

test("rowsToNotesMap drops rows with an unknown phase instead of throwing", () => {
  const map = rowsToNotesMap([
    { exchange: "OKX", trade_id: "1", phase: "sideways", body: "junk" },
    { exchange: "OKX", trade_id: "1", phase: "before", body: "real" },
  ])
  assert.deepEqual(map["OKX|1"], { before: "real" })
})

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

test("buildTradesCsv joins each trade's notes onto its own row", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX", ticker: "BTCUSDT" }),
    trade({ id: "2", exchange: "OKX", ticker: "ETHUSDT" }),
  ]
  const notes: TradeNotesMap = {
    "OKX|1": { before: "b1", during: "d1", after: "a1" },
    "OKX|2": { after: "a2" },
  }
  const [header, ...rows] = parseCsv(buildTradesCsv(trades, notes))
  const col = (row: string[], name: string) => row[header.indexOf(name)]

  assert.equal(col(rows[0], "ticker"), "BTCUSDT")
  assert.equal(col(rows[0], "noteBefore"), "b1")
  assert.equal(col(rows[0], "noteDuring"), "d1")
  assert.equal(col(rows[0], "noteAfter"), "a1")

  assert.equal(col(rows[1], "ticker"), "ETHUSDT")
  assert.equal(col(rows[1], "noteBefore"), "")
  assert.equal(col(rows[1], "noteAfter"), "a2")
})

test("a note full of commas, quotes and newlines survives a round trip", () => {
  // This is the whole reason the writer does real RFC 4180 escaping: journal
  // text is freeform and will contain every delimiter the format uses.
  const body = 'Entry at 3.5, "too big" a size\nStopped out; revenge-traded'
  const [header, row] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "OKX" })], { "OKX|1": { before: body } })
  )
  assert.equal(row[header.indexOf("noteBefore")], body)
  // And the escaping must not have leaked an extra record.
  assert.equal(parseCsv(buildTradesCsv([trade({ id: "1", exchange: "OKX" })], { "OKX|1": { before: body } })).length, 2)
})

test("buildTradesCsv writes numbers raw so a spreadsheet reads them as numbers", () => {
  const [header, row] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "OKX", pnl: -1234.5, positionSize: 2000, tp: 70000 })])
  )
  assert.equal(row[header.indexOf("pnl")], "-1234.5")
  assert.equal(row[header.indexOf("positionSize")], "2000")
  assert.equal(row[header.indexOf("tp")], "70000")
  // sl is null on this trade — an empty cell, not the string "null"
  assert.equal(row[header.indexOf("sl")], "")
})

test("buildTradesCsv handles an empty trade list without losing the header", () => {
  assert.deepEqual(parseCsv(buildTradesCsv([])), [[...EXPORT_COLUMNS]])
})

test("exportFilename is date-stamped and sortable", () => {
  assert.equal(exportFilename(new Date("2026-08-15T22:00:00Z")), "trades-2026-08-15.csv")
})
