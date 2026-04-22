import { StatsResult } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, BarChart2, Trophy } from "lucide-react"

interface StatsBarProps {
  stats: StatsResult
}

export function StatsBar({ stats }: StatsBarProps) {
  const pnlPositive = stats.totalPnl >= 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total PnL
          </CardTitle>
          {pnlPositive ? (
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          <p
            className={`text-2xl font-bold ${
              pnlPositive ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {pnlPositive ? "+" : ""}
            {stats.totalPnl.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">All exchanges combined</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Win Rate
          </CardTitle>
          <Trophy className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{stats.winRate}%</p>
          <p className="text-xs text-muted-foreground mt-1">Profitable trades</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Trades
          </CardTitle>
          <BarChart2 className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{stats.tradeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Across all exchanges</p>
        </CardContent>
      </Card>
    </div>
  )
}
