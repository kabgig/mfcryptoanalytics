/**
 * Futures trade ids must be stable across partial closes.
 *
 * OKX, MEXC and Bitunix mutate a position-history record in place as a position
 * is closed down: pnl accumulates and the update time advances. Keying the id on
 * that update time made every partial close look like a brand-new trade, leaving
 * the intermediate snapshot behind as a ghost that inflated the user's stats.
 * These tests pin the fix: the id keys on the position's OPEN time instead.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { positionToTrade as okxToTrade } from "@/lib/exchanges/adapters/okx/futures"
import { positionToTrade as mexcToTrade } from "@/lib/exchanges/adapters/mexc/futures"
import { positionToTrade as bitunixToTrade } from "@/lib/exchanges/adapters/bitunix/futures"
import type { OKXPosition } from "@/lib/exchanges/adapters/okx/types"
import type { MEXCHistoryPosition } from "@/lib/exchanges/adapters/mexc/types"
import type { BitunixPositionRecord } from "@/lib/exchanges/adapters/bitunix/types"

// The real position behind the ghost trade this fix was built for.
const OPENED = 1786337034464 // 2026-08-10T04:43:54.464Z
const HALF_CLOSED = 1786380861201 // 2026-08-10T16:54:21.201Z
const FULLY_CLOSED = 1786522425070 // 2026-08-12T08:13:45.070Z

function okx(over: Partial<OKXPosition>): OKXPosition {
  return {
    posId: "3559128158201356288",
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    mgnMode: "cross",
    openMaxPos: "1",
    openAvgPx: "100",
    closeAvgPx: "110",
    pnl: "21.9032",
    lever: "10",
    cTime: String(OPENED),
    uTime: String(HALF_CLOSED),
    ...over,
  }
}

function mexc(over: Partial<MEXCHistoryPosition>): MEXCHistoryPosition {
  return {
    symbol: "BTC_USDT",
    positionId: "778899",
    holdSide: 1,
    openVol: "1",
    closeVol: "1",
    openAvgPrice: "100",
    closeAvgPrice: "110",
    realised: "21.9032",
    createTime: OPENED,
    updateTime: HALF_CLOSED,
    ...over,
  }
}

function bitunix(over: Partial<BitunixPositionRecord>): BitunixPositionRecord {
  return {
    positionId: "1026044262703957301",
    symbol: "BTCUSDT",
    maxQty: "1",
    entryPrice: "100",
    closePrice: "110",
    side: "LONG",
    marginMode: "CROSS",
    positionMode: "ONE_WAY",
    leverage: 10,
    fee: "0",
    funding: "0",
    realizedPNL: "21.9032",
    liqPrice: "0",
    ctime: String(OPENED),
    mtime: String(HALF_CLOSED),
    ...over,
  }
}

// ── the ghost-trade regression ───────────────────────────────────────────────
// One position, fetched twice: once after closing half, once after closing the
// rest. Both fetches must map to the SAME id so the second updates the first.

test("OKX: a partial close and the final close are one trade", () => {
  const half = okxToTrade(okx({}))
  const full = okxToTrade(okx({ uTime: String(FULLY_CLOSED), pnl: "44.74708" }))

  assert.equal(half.id, full.id)
  assert.equal(full.pnl, 44.74708)
  // The close time still tracks the real close, only the id is stable.
  assert.notEqual(half.closeTime, full.closeTime)
})

test("MEXC: a partial close and the final close are one trade", () => {
  const half = mexcToTrade(mexc({}))
  const full = mexcToTrade(mexc({ updateTime: FULLY_CLOSED, realised: "44.74708" }))

  assert.equal(half.id, full.id)
  assert.equal(full.pnl, 44.74708)
  assert.notEqual(half.closeTime, full.closeTime)
})

test("Bitunix: a partial close and the final close are one trade", () => {
  const half = bitunixToTrade(bitunix({}))!
  const full = bitunixToTrade(bitunix({ mtime: String(FULLY_CLOSED), realizedPNL: "44.74708" }))!

  assert.equal(half.id, full.id)
  assert.equal(full.pnl, 44.74708)
  assert.notEqual(half.closeTime, full.closeTime)
})

// ── the reason the timestamp is there at all ─────────────────────────────────
// Position ids get recycled — one OKX posId covered 18 separate positions on a
// single instrument over three months. Distinct positions must stay distinct.

test("OKX: a recycled posId still yields distinct trades", () => {
  const first = okxToTrade(okx({}))
  const second = okxToTrade(okx({ cTime: "1786600000000", uTime: "1786700000000" }))

  assert.notEqual(first.id, second.id)
})

test("MEXC: a recycled positionId still yields distinct trades", () => {
  const first = mexcToTrade(mexc({}))
  const second = mexcToTrade(mexc({ createTime: 1786600000000, updateTime: 1786700000000 }))

  assert.notEqual(first.id, second.id)
})

test("Bitunix: a recycled positionId still yields distinct trades", () => {
  const first = bitunixToTrade(bitunix({}))!
  const second = bitunixToTrade(bitunix({ ctime: "1786600000000", mtime: "1786700000000" }))!

  assert.notEqual(first.id, second.id)
})

// ── guards ───────────────────────────────────────────────────────────────────

test("no adapter leaks the mutable close timestamp into the id", () => {
  const ids = [
    okxToTrade(okx({})).id,
    mexcToTrade(mexc({})).id,
    bitunixToTrade(bitunix({}))!.id,
  ]
  for (const id of ids) {
    assert.ok(!id.includes(String(HALF_CLOSED)), `${id} still embeds the update time`)
    assert.ok(id.endsWith(`-${OPENED}`), `${id} should end with the open time`)
  }
})

test("Bitunix builds the same id whether ctime arrives as a string or a number", () => {
  // The field is typed `string | number`, so the id is built from parsed epoch ms.
  assert.equal(
    bitunixToTrade(bitunix({ ctime: String(OPENED) }))!.id,
    bitunixToTrade(bitunix({ ctime: OPENED }))!.id
  )
})

test("Bitunix skips records with unusable timestamps", () => {
  assert.equal(bitunixToTrade(bitunix({ ctime: "" })), null)
  assert.equal(bitunixToTrade(bitunix({ mtime: "not-a-date" })), null)
})
