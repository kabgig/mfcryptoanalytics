"use client"

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PortfolioPoint } from "@/types/spot"
import { usd } from "./format"

interface Props {
  series: PortfolioPoint[]
}

const VALUE = "var(--spot-series-1)"
const INVESTED = "var(--spot-series-2)"

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

const compactUsd = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PortfolioTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as PortfolioPoint
  const pnl = p.value != null ? p.value - p.invested : null

  return (
    <div className="min-w-[180px] rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{shortDate(label as string)}</p>
      <Row color={VALUE} label="Value" value={p.value != null ? usd(p.value) : "no price"} />
      <Row color={INVESTED} label="Invested" value={usd(p.invested)} />
      {pnl != null && (
        <div className="mt-1.5 flex items-center justify-between border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">PnL</span>
          <span
            className={`tabular-nums font-medium ${
              pnl >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {pnl >= 0 ? "+" : "-"}
            {usd(Math.abs(pnl))}
          </span>
        </div>
      )}
    </div>
  )
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Portfolio market value against cumulative cash invested.
 *
 * Both series are USD on one shared axis — deliberately never a second y-axis,
 * which would let the two lines be scaled into any relationship you like.
 */
export function SpotPortfolioChart({ series }: Props) {
  const empty = series.length === 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Portfolio value vs invested</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Add an entry to see your portfolio over time.
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spotValueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VALUE} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={VALUE} stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={compactUsd}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip content={<PortfolioTooltip />} />
                <Legend
                  verticalAlign="top"
                  height={28}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12 }}
                />

                <Area
                  type="monotone"
                  dataKey="value"
                  name="Value"
                  stroke={VALUE}
                  strokeWidth={2}
                  fill="url(#spotValueFill)"
                  // Null on days with no cached price — the line breaks rather
                  // than interpolating a value we never knew.
                  connectNulls={false}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="invested"
                  name="Invested"
                  stroke={INVESTED}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
