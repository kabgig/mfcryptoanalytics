import test from "node:test"
import assert from "node:assert/strict"
import { tradeKey } from "@/lib/db/trades"
import { rowsToOverridesMap } from "@/lib/db/tradeOverrides"
import {
  isBias,
  isStorablePrice,
  mergeOverride,
  resolveTrade,
  resolveTrades,
  sideToBias,
  OVERRIDE_FIELDS,
  PRICE_FIELDS,
} from "@/lib/services/overridesService"
import { buildTradesCsv, EXPORT_COLUMNS } from "@/lib/services/exportService"
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

// -------------------------------------------------------------------- guards

test("isBias accepts exactly buy and sell", () => {
  assert.deepEqual(OVERRIDE_FIELDS, ["tp", "sl", "bias"])
  assert.deepEqual(PRICE_FIELDS, ["tp", "sl"])
  for (const good of ["buy", "sell"]) assert.ok(isBias(good))
  for (const bad of ["BUY", "long", "", null, undefined, 1]) {
    assert.equal(isBias(bad), false, `${String(bad)} should not be a bias`)
  }
})

test("isStorablePrice rejects what a NUMERIC column cannot hold", () => {
  for (const good of [0, 0.00000001, 70000]) assert.ok(isStorablePrice(good))
  for (const bad of [-1, NaN, Infinity, -Infinity, "70000", null, undefined]) {
    assert.equal(isStorablePrice(bad), false, `${String(bad)} should not be storable`)
  }
})

// ---------------------------------------------------------------- derivation

test("sideToBias maps the exchange's side onto a bias", () => {
  assert.equal(sideToBias("long"), "buy")
  assert.equal(sideToBias("short"), "sell")
  // Only Bybit and Bitunix report a side at all.
  assert.equal(sideToBias(undefined), null)
})

test("bias is derived from side when the user has not set one", () => {
  assert.equal(resolveTrade(trade({ id: "1", exchange: "Bybit", side: "long" })).bias, "buy")
  assert.equal(resolveTrade(trade({ id: "2", exchange: "Bybit", side: "short" })).bias, "sell")
  assert.equal(resolveTrade(trade({ id: "3", exchange: "OKX" })).bias, null)
})

test("a manual bias wins over the one derived from side, without touching side", () => {
  const t = trade({ id: "1", exchange: "Bybit", side: "long" })
  const resolved = resolveTrade(t, { bias: "sell" })
  assert.equal(resolved.bias, "sell")
  assert.equal(resolved.overridden.bias, true)
  // side must survive untouched: the LVS view still reads the exchange's answer.
  assert.equal(resolved.side, "long")
})

// ----------------------------------------------------------------- precedence

test("an override always wins over the exchange's tp/sl", () => {
  // No adapter reports tp/sl today, but if one starts, the user's number stands.
  const resolved = resolveTrade(trade({ id: "1", exchange: "OKX", tp: 100, sl: 90 }), {
    tp: 111,
    sl: 88,
  })
  assert.equal(resolved.tp, 111)
  assert.equal(resolved.sl, 88)
  assert.deepEqual(resolved.overridden, { tp: true, sl: true, bias: false })
})

test("an absent override leaves the exchange value in place", () => {
  const resolved = resolveTrade(trade({ id: "1", exchange: "OKX", tp: 100 }), { sl: 88 })
  assert.equal(resolved.tp, 100)
  assert.equal(resolved.sl, 88)
  assert.deepEqual(resolved.overridden, { tp: false, sl: true, bias: false })
})

test("an override of 0 is honoured rather than treated as absent", () => {
  const resolved = resolveTrade(trade({ id: "1", exchange: "OKX", tp: 100 }), { tp: 0 })
  assert.equal(resolved.tp, 0)
  assert.equal(resolved.overridden.tp, true)
})

test("resolveTrades keys overrides by exchange|id, not id alone", () => {
  const trades = [
    trade({ id: "1", exchange: "OKX" }),
    trade({ id: "1", exchange: "Bybit" }),
  ]
  const overrides: TradeOverridesMap = { [tradeKey("OKX", "1")]: { tp: 70000 } }
  const [okx, bybit] = resolveTrades(trades, overrides)
  assert.equal(okx.tp, 70000)
  assert.equal(bybit.tp, null, "an OKX override leaked onto the same-id Bybit trade")
})

test("resolveTrades with no overrides returns the trades unchanged", () => {
  const trades = [trade({ id: "1", exchange: "OKX", tp: 5, sl: 4, side: "long" })]
  const [r] = resolveTrades(trades)
  assert.equal(r.tp, 5)
  assert.equal(r.sl, 4)
  assert.equal(r.bias, "buy")
  assert.deepEqual(r.overridden, { tp: false, sl: false, bias: false })
})

// --------------------------------------------------------------- patch merge

test("a patch only touches the fields it carries", () => {
  const merged = mergeOverride({ tp: 100, sl: 90, bias: "buy" }, { sl: 95 })
  assert.deepEqual(merged, { tp: 100, sl: 95, bias: "buy" })
})

test("a null in a patch clears that field and hands it back to the exchange", () => {
  const merged = mergeOverride({ tp: 100, sl: 90 }, { tp: null })
  assert.deepEqual(merged, { sl: 90 })
})

test("clearing the last override returns null, the signal to delete the row", () => {
  assert.equal(mergeOverride({ tp: 100 }, { tp: null }), null)
  assert.equal(mergeOverride({}, { bias: null }), null)
})

test("mergeOverride ignores unusable values instead of storing them", () => {
  assert.equal(mergeOverride({}, { tp: NaN }), null)
  assert.equal(mergeOverride({}, { tp: -5 }), null)
  // @ts-expect-error — deliberately wrong, mirrors an unvalidated client payload
  assert.equal(mergeOverride({}, { bias: "long" }), null)
})

// ------------------------------------------------------------------ db rows

test("rowsToOverridesMap converts NUMERIC strings into numbers", () => {
  // The driver hands NUMERIC back as a string; "70000" would render fine but
  // compare and sort as text.
  const map = rowsToOverridesMap([
    { exchange: "OKX", trade_id: "1", tp: "70000", sl: "68000.5", bias: "buy" },
  ])
  assert.deepEqual(map[tradeKey("OKX", "1")], { tp: 70000, sl: 68000.5, bias: "buy" })
})

test("rowsToOverridesMap omits null columns rather than emitting undefined keys", () => {
  const map = rowsToOverridesMap([
    { exchange: "OKX", trade_id: "1", tp: null, sl: null, bias: "sell" },
  ])
  assert.deepEqual(map[tradeKey("OKX", "1")], { bias: "sell" })
  assert.equal("tp" in map[tradeKey("OKX", "1")], false)
})

test("rowsToOverridesMap keeps same-id trades from different exchanges apart", () => {
  const map = rowsToOverridesMap([
    { exchange: "OKX", trade_id: "1", tp: "1", sl: null, bias: null },
    { exchange: "Bybit", trade_id: "1", tp: "2", sl: null, bias: null },
  ])
  assert.equal(map[tradeKey("OKX", "1")].tp, 1)
  assert.equal(map[tradeKey("Bybit", "1")].tp, 2)
})

test("rowsToOverridesMap drops a row carrying nothing usable", () => {
  const map = rowsToOverridesMap([
    { exchange: "OKX", trade_id: "1", tp: null, sl: null, bias: "sideways" },
  ])
  assert.deepEqual(map, {})
})

// ---------------------------------------------------------------------- csv

test("the csv carries bias alongside the exchange's own side", () => {
  assert.ok(EXPORT_COLUMNS.includes("bias"))
  const [header, row] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "Bybit", side: "long" })])
  )
  assert.equal(row[header.indexOf("side")], "long")
  assert.equal(row[header.indexOf("bias")], "buy")
})

test("the csv exports the overridden tp/sl, not the exchange's nulls", () => {
  const [header, row] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "OKX" })], {}, {
      "OKX|1": { tp: 70000, sl: 65000, bias: "sell" },
    })
  )
  assert.equal(row[header.indexOf("tp")], "70000")
  assert.equal(row[header.indexOf("sl")], "65000")
  assert.equal(row[header.indexOf("bias")], "sell")
  // side was never reported, and an override must not invent one.
  assert.equal(row[header.indexOf("side")], "")
})

test("a trade with no override still exports empty tp/sl/bias cells", () => {
  const [header, row] = parseCsv(buildTradesCsv([trade({ id: "1", exchange: "OKX" })]))
  assert.equal(row[header.indexOf("tp")], "")
  assert.equal(row[header.indexOf("sl")], "")
  assert.equal(row[header.indexOf("bias")], "")
})
