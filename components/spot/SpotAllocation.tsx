"use client"

import { useMemo } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { AllocationSlice } from "@/types/spot"
import { usd } from "./format"

interface Props {
  allocation: AllocationSlice[]
}

/**
 * Fixed slot order — assigned by position, never cycled. A 9th coin folds into
 * "Other" rather than reusing slot 1, so no two visible slices share a colour.
 */
const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--spot-series-${i})`)
const OTHER = "var(--muted-foreground)"
const MAX_SLICES = 7

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SliceTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as AllocationSlice & { fill: string }
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: d.fill }}
        />
        <span className="font-medium">{d.ticker}</span>
      </div>
      <div className="mt-1 tabular-nums text-muted-foreground">
        {usd(d.value)} · {d.pct.toFixed(1)}%
      </div>
    </div>
  )
}

export function SpotAllocation({ allocation }: Props) {
  // Beyond MAX_SLICES the tail is folded into a single neutral "Other" slice.
  const data = useMemo(() => {
    if (allocation.length <= MAX_SLICES) {
      return allocation.map((a, i) => ({ ...a, fill: SERIES[i] }))
    }
    const head = allocation.slice(0, MAX_SLICES).map((a, i) => ({ ...a, fill: SERIES[i] }))
    const tail = allocation.slice(MAX_SLICES)
    return [
      ...head,
      {
        ticker: `Other (${tail.length})`,
        value: tail.reduce((s, a) => s + a.value, 0),
        pct: tail.reduce((s, a) => s + a.pct, 0),
        fill: OTHER,
      },
    ]
  }, [allocation])

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-12 text-center text-sm text-muted-foreground">
            No priced holdings yet.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Allocation by value</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-[220px] w-full sm:w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="ticker"
                  innerRadius={58}
                  outerRadius={92}
                  // 2px surface gap between segments.
                  paddingAngle={1.5}
                  stroke="var(--card)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.ticker} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip content={<SliceTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend doubles as the table view — the relief channel for the
              light-mode slots that sit below 3:1 on this surface. */}
          <div className="w-full min-w-0 flex-1">
            <table className="w-full text-sm">
              <tbody>
                {data.map((d) => (
                  <tr key={d.ticker} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: d.fill }}
                        />
                        <span className="truncate">{d.ticker}</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {usd(d.value)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums font-medium">
                      {d.pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
