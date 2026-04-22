import { Trade } from "@/types"

const EXCHANGES = ["Binance", "Bybit"]
const TICKERS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ARBUSDT", "LINKUSDT"]

function randomBetween(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

export function generateDummyTrades(): Trade[] {
  const trades: Trade[] = []
  // Start 30 days ago
  let cursor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const rawTrades: Omit<Trade, "id">[] = [
    { exchange: "Binance", ticker: "BTCUSDT", positionSize: 0.5,  tp: 67500, sl: 63000, openTime: "", closeTime: "", pnl:  420.0 },
    { exchange: "Bybit",   ticker: "ETHUSDT", positionSize: 2.0,  tp: 3600,  sl: 3100,  openTime: "", closeTime: "", pnl: -180.5 },
    { exchange: "Binance", ticker: "SOLUSDT", positionSize: 10.0, tp: 195,   sl: 155,   openTime: "", closeTime: "", pnl:  310.0 },
    { exchange: "Bybit",   ticker: "BTCUSDT", positionSize: 0.25, tp: 70000, sl: 64000, openTime: "", closeTime: "", pnl:  850.0 },
    { exchange: "Binance", ticker: "ARBUSDT", positionSize: 500,  tp: 1.8,   sl: 1.1,   openTime: "", closeTime: "", pnl: -95.0  },
    { exchange: "Bybit",   ticker: "LINKUSDT",positionSize: 50.0, tp: 22,    sl: 15,    openTime: "", closeTime: "", pnl:  230.0 },
    { exchange: "Binance", ticker: "BNBUSDT", positionSize: 5.0,  tp: 580,   sl: 490,   openTime: "", closeTime: "", pnl: -412.0 },
    { exchange: "Bybit",   ticker: "ETHUSDT", positionSize: 1.5,  tp: 3900,  sl: 3300,  openTime: "", closeTime: "", pnl:  670.0 },
    { exchange: "Binance", ticker: "SOLUSDT", positionSize: 8.0,  tp: 210,   sl: 165,   openTime: "", closeTime: "", pnl: -55.0  },
    { exchange: "Bybit",   ticker: "BTCUSDT", positionSize: 0.1,  tp: 72000, sl: 67000, openTime: "", closeTime: "", pnl:  125.0 },
    { exchange: "Binance", ticker: "ARBUSDT", positionSize: 300,  tp: 2.0,   sl: 1.4,   openTime: "", closeTime: "", pnl:  390.0 },
    { exchange: "Bybit",   ticker: "LINKUSDT",positionSize: 30.0, tp: 25,    sl: 18,    openTime: "", closeTime: "", pnl: -140.0 },
    { exchange: "Binance", ticker: "BTCUSDT", positionSize: 0.3,  tp: 68000, sl: 62000, openTime: "", closeTime: "", pnl:  560.0 },
    { exchange: "Bybit",   ticker: "BNBUSDT", positionSize: 3.0,  tp: 610,   sl: 520,   openTime: "", closeTime: "", pnl:  210.0 },
    { exchange: "Binance", ticker: "ETHUSDT", positionSize: 1.0,  tp: 4100,  sl: 3500,  openTime: "", closeTime: "", pnl: -320.0 },
    { exchange: "Bybit",   ticker: "SOLUSDT", positionSize: 15.0, tp: 220,   sl: 175,   openTime: "", closeTime: "", pnl:  475.0 },
    { exchange: "Binance", ticker: "ARBUSDT", positionSize: 200,  tp: 2.2,   sl: 1.6,   openTime: "", closeTime: "", pnl:  88.0  },
    { exchange: "Bybit",   ticker: "BTCUSDT", positionSize: 0.2,  tp: 74000, sl: 68000, openTime: "", closeTime: "", pnl: -260.0 },
    { exchange: "Binance", ticker: "LINKUSDT",positionSize: 40.0, tp: 28,    sl: 20,    openTime: "", closeTime: "", pnl:  195.0 },
    { exchange: "Bybit",   ticker: "ETHUSDT", positionSize: 2.5,  tp: 4200,  sl: 3600,  openTime: "", closeTime: "", pnl:  740.0 },
  ]

  rawTrades.forEach((t, i) => {
    const openTime = new Date(cursor)
    const duration = randomBetween(2, 48, 0)
    const closeTime = addHours(openTime, duration)
    cursor = addHours(closeTime, randomBetween(1, 12, 0))

    trades.push({
      ...t,
      id: `trade-${i + 1}`,
      openTime: openTime.toISOString(),
      closeTime: closeTime.toISOString(),
    })
  })

  return trades
}
