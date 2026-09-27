import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { fetchCurrentPrices, fetchDailyCloses, fetchUsdTickers } from "@/lib/prices/spot"
import * as kraken from "@/lib/prices/kraken"

/**
 * Fake exchanges. BTC is listed on Coinbase (and on Kraken as "XBT"); XDC only
 * on Kraken; NOPE nowhere. `coinbaseDown` simulates an outage (HTTP 503).
 */
let calls: string[] = []
let coinbaseDown = false
let krakenDown = false

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  calls = []
  coinbaseDown = false
  krakenDown = false
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const DAY = 86_400
const T0 = Date.UTC(2026, 8, 20) / 1000 // 2026-09-20

function install() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    const u = new URL(url)

    if (u.hostname === "api.exchange.coinbase.com") {
      if (coinbaseDown) return json({ message: "down" }, 503)
      if (u.pathname === "/products") {
        return json([
          { id: "BTC-USD", base_currency: "BTC", quote_currency: "USD", status: "online" },
          { id: "ETH-USD", base_currency: "ETH", quote_currency: "USD", status: "online" },
        ])
      }
      const m = u.pathname.match(/^\/products\/([A-Z0-9.-]+)-USD(\/.*)?$/)
      if (!m || !["BTC", "ETH"].includes(m[1])) return json({ message: "NotFound" }, 404)
      if (m[2] === "/ticker") return json({ price: "100000" })
      if (m[2] === "/candles") return json([[T0 + DAY, 1, 1, 1, 101, 1], [T0, 1, 1, 1, 100, 1]])
      return json({ id: `${m[1]}-USD` })
    }

    if (u.hostname === "api.kraken.com") {
      if (krakenDown) return json({ error: "down" }, 503)
      if (u.pathname === "/0/public/AssetPairs") {
        return json({
          error: [],
          result: {
            XXBTZUSD: { wsname: "XBT/USD", status: "online" },
            XDCUSD: { wsname: "XDC/USD", status: "online" },
            XDCEUR: { wsname: "XDC/EUR", status: "online" },
            DEADUSD: { wsname: "DEAD/USD", status: "cancel_only" },
          },
        })
      }
      const pair = u.searchParams.get("pair")
      if (pair !== "XDCUSD" && pair !== "XBTUSD") {
        return json({ error: ["EQuery:Unknown asset pair"] })
      }
      const key = pair === "XBTUSD" ? "XXBTZUSD" : "XDCUSD"
      if (u.pathname === "/0/public/Ticker") {
        return json({ error: [], result: { [key]: { c: ["0.0306", "1"] } } })
      }
      if (u.pathname === "/0/public/OHLC") {
        const candle = (t: number, close: string) => [t, "0", "0", "0", close, "0", "0", 1]
        return json({
          error: [],
          result: {
            [key]: [
              candle(T0 - DAY, "0.0290"),
              candle(T0, "0.0300"),
              candle(T0 + DAY, "0.0310"),
              candle(T0 + 2 * DAY, "0.0320"),
            ],
            last: T0 + 2 * DAY,
          },
        })
      }
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
}

const krakenCalls = () => calls.filter((c) => c.includes("api.kraken.com"))
const start = new Date(T0 * 1000)
const end = new Date((T0 + DAY) * 1000)

test("a coin Coinbase does not list (XDC) gets its closes from Kraken", async () => {
  install()
  const points = await fetchDailyCloses("XDC", start, end)
  assert.deepEqual(points, [
    { day: "2026-09-20", close: 0.03 },
    { day: "2026-09-21", close: 0.031 },
  ])
  assert.ok(krakenCalls().some((c) => c.includes("pair=XDCUSD")))
})

test("a Coinbase coin (BTC) keeps using Coinbase and never touches Kraken", async () => {
  install()
  const points = await fetchDailyCloses("BTC", start, end)
  assert.deepEqual(points, [
    { day: "2026-09-20", close: 100 },
    { day: "2026-09-21", close: 101 },
  ])
  const prices = await fetchCurrentPrices(["BTC"])
  assert.deepEqual(prices, { BTC: 100000 })
  assert.deepEqual(krakenCalls(), [])
})

test("a Coinbase outage does not fall back to Kraken for cached history", async () => {
  install()
  coinbaseDown = true
  // Throwing lets the route log it and retry next visit, rather than writing
  // Kraken closes permanently into a Coinbase coin's cache.
  await assert.rejects(() => fetchDailyCloses("BTC", start, end))
  assert.deepEqual(krakenCalls(), [])
})

test("a Coinbase outage does not reroute live prices to Kraken either", async () => {
  install()
  coinbaseDown = true
  assert.deepEqual(await fetchCurrentPrices(["BTC"]), {})
  assert.deepEqual(krakenCalls(), [])
})

test("live prices mix sources per ticker", async () => {
  install()
  assert.deepEqual(await fetchCurrentPrices(["BTC", "XDC"]), { BTC: 100000, XDC: 0.0306 })
})

test("a ticker no source knows stays unpriced and has no history", async () => {
  install()
  assert.deepEqual(await fetchCurrentPrices(["NOPE"]), {})
  assert.deepEqual(await fetchDailyCloses("NOPE", start, end), [])
})

test("the ticker list is the union of both, deduped, with XBT shown as BTC", async () => {
  install()
  const list = await fetchUsdTickers()
  assert.deepEqual(list, ["BTC", "ETH", "XDC"])
  assert.ok(!list.includes("XBT"), "Kraken alias leaked")
  assert.ok(!list.includes("DEAD"), "non-online pair listed")
})

test("the ticker list survives one source being down, and fails only when both are", async () => {
  install()
  krakenDown = true
  assert.deepEqual(await fetchUsdTickers(), ["BTC", "ETH"])
  coinbaseDown = true
  await assert.rejects(() => fetchUsdTickers())
  krakenDown = false
  assert.deepEqual(await fetchUsdTickers(), ["BTC", "XDC"])
})

test("the Kraken client asks for XBTUSD when given BTC", async () => {
  install()
  assert.deepEqual(await kraken.fetchCurrentPrices(["BTC"]), { BTC: 0.0306 })
  assert.ok(krakenCalls().some((c) => c.includes("pair=XBTUSD")))
})

test("Kraken's HTTP-200 error payload yields no closes rather than throwing", async () => {
  install()
  assert.deepEqual(await kraken.fetchDailyCloses("NOPE", start, end), [])
})
