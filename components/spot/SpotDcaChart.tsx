"use client"

import { useMemo, useState } from "react"
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildDcaSeries } from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"
import { price } from "./format"

interface Props {
  entries: SpotEntry[]
  tickers: string[]
  history: Record<string, { day: string; close: number }[]>
  today: string
}

const AVG = "var(--spot-series-1)"
const MARKET = "var(--spot-series-2)"
// Buys and sells are polarity, not identity, so they wear the app's existing
// semantic green/red rather than categorical slots.
const BUY = "#059669"
const SELL = "#dc2626"

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DcaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as {
    avgEntry: number | null
    market: number | null
    buyPrice?: number
    sellPrice?: number
  }
  const diff =
    p.avgEntry != null && p.market != null ? ((p.market - p.avgEntry) / p.avgEntry) * 100 : null

  return (
    <div className="min-w-[190px] rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{shortDate(label as string)}</p>
      <Row color={MARKET} label="Market" value={p.market != null ? price(p.market) : "—"} />
      <Row
        color={AVG}
        label="Avg entry"
        value={p.avgEntry != null ? price(p.avgEntry) : "not held"}
      />
      {diff != null && (
        <div className="mt-1.5 flex items-center justify-between border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">vs entry</span>
          <span
            className={`tabular-nums font-medium ${
              diff >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {diff >= 0 ? "+" : ""}
            {diff.toFixed(2)}%
          </span>
        </div>
      )}
      {p.buyPrice != null && (
        <p className="mt-1.5 border-t border-border/50 pt-1.5" style={{ color: BUY }}>
          Bought at {price(p.buyPrice)}
        </p>
      )}
      {p.sellPrice != null && (
        <p className="mt-1.5 border-t border-border/50 pt-1.5" style={{ color: SELL }}>
          Sold at {price(p.sellPrice)}
        </p>
      )}
    </div>
  )
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Running average entry against market price for one coin, with the individual
 * buys and sells marked.
 *
 * `avgEntry` is null on days the position was flat, and `connectNulls` stays
 * false, so a sold-then-rebought coin draws as separate segments instead of one
 * line sloping through a period nothing was held.
 */
export function SpotDcaChart({ entries, tickers, history, today }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const active = selected && tickers.includes(selected) ? selected : (tickers[0] ?? null)

  const series = useMemo(
    () => (active ? buildDcaSeries(active, entries, history[active] ?? [], today) : []),
    [active, entries, history, today]
  )

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm font-medium">DCA entry vs market</CardTitle>
        {tickers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tickers.map((t) => (
              <button
                key={t}
                onClick={() => setSelected(t)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  t === active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Add an entry to see your average entry against the market.
          </p>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={(v: number) => price(v)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<DcaTooltip />} />
                <Legend
                  verticalAlign="top"
                  height={28}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12 }}
                />

                <Line
                  type="monotone"
                  dataKey="market"
                  name="Market"
                  stroke={MARKET}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="avgEntry"
                  name="Avg entry"
                  stroke={AVG}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Scatter
                  dataKey="buyPrice"
                  name="Buy"
                  fill={BUY}
                  shape="circle"
                  isAnimationActive={false}
                />
                <Scatter
                  dataKey="sellPrice"
                  name="Sell"
                  fill={SELL}
                  shape="triangle"
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
