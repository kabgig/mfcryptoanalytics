"use client"

import { Trade, StatsResult } from "@/types"
import {
  ChartConfig,
  ChartContainer,
} from "@/components/ui/chart"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface PnlChartProps {
  chartData: StatsResult["chartData"]
  trades?: Trade[]
}

const chartConfig: ChartConfig = {
  cumulativePnl: {
    label: "Cumulative PnL",
    color: "hsl(var(--chart-1))",
  },
}

// Build a Set of indexes that are the last trade of each unique date
function buildLastPerDayIndexes(data: StatsResult["chartData"]): Set<number> {
  const lastIndex = new Map<string, number>()
  data.forEach((point, i) => lastIndex.set(point.date, i))
  return new Set(lastIndex.values())
}

// Group trades by date (YYYY-MM-DD of closeTime)
function groupTradesByDate(trades: Trade[]): Map<string, Trade[]> {
  const map = new Map<string, Trade[]>()
  for (const t of trades) {
    const day = t.closeTime.slice(0, 10)
    const arr = map.get(day) ?? []
    arr.push(t)
    map.set(day, arr)
  }
  return map
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, tradesByDate }: any) {
  if (!active || !payload?.length) return null
  const { date, cumulativePnl } = payload[0].payload as { date: string; cumulativePnl: number }
  const dayTrades: Trade[] = tradesByDate?.get(date) ?? []

  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs min-w-[200px] max-w-[280px]">
      <p className="font-semibold text-foreground mb-1">{date}</p>
      <p className="text-muted-foreground mb-2">
        Cumulative PnL:{" "}
        <span className={cumulativePnl >= 0 ? "text-green-500 font-medium" : "text-red-500 font-medium"}>
          {cumulativePnl.toLocaleString("en-US", { style: "currency", currency: "USD" })}
        </span>
      </p>
      {dayTrades.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium border-t pt-1">
            {dayTrades.length} trade{dayTrades.length > 1 ? "s" : ""} closed:
          </p>
          {dayTrades.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <span className="text-foreground font-medium truncate">{t.ticker}</span>
              {t.side && (
                <span className={`capitalize ${t.side === "long" ? "text-green-500" : "text-red-500"}`}>
                  {t.side}
                </span>
              )}
              <span className={t.pnl >= 0 ? "text-green-500 font-medium" : "text-red-500 font-medium"}>
                {t.pnl >= 0 ? "+" : ""}
                {t.pnl.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PnlChart({ chartData, trades }: PnlChartProps) {
  const lastPerDayIndexes = buildLastPerDayIndexes(chartData)
  const tradesByDate = trades ? groupTradesByDate(trades) : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const { cx, cy, index } = props
    if (!lastPerDayIndexes.has(index)) return <g key={index} />
    return (
      <circle
        key={index}
        cx={cx}
        cy={cy}
        r={3}
        fill="#3b82f6"
        fillOpacity={0.85}
        strokeWidth={0}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cumulative PnL</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[230px] sm:h-72 w-full">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v}`}
              className="fill-muted-foreground"
            />
            <Tooltip
              content={(props) => <DayTooltip {...props} tradesByDate={tradesByDate} />}
              cursor={{ stroke: "currentColor", strokeOpacity: 0.15, strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="cumulativePnl"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#pnlGradient)"
              dot={renderDot}
              activeDot={{ r: 5, fill: "#3b82f6" }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
