"use client"

import { StatsResult } from "@/types"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface PnlChartProps {
  chartData: StatsResult["chartData"]
}

const chartConfig: ChartConfig = {
  cumulativePnl: {
    label: "Cumulative PnL",
    color: "hsl(var(--chart-1))",
  },
}

export function PnlChart({ chartData }: PnlChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cumulative PnL Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-72 w-full">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
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
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    typeof value === "number"
                      ? value.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })
                      : value
                  }
                />
              }
            />
            <Area
              type="monotone"
              dataKey="cumulativePnl"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              fill="url(#pnlGradient)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
