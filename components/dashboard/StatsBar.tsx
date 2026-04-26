import { StatsResult } from "@/types"
import type { BalanceResult } from "@/lib/services/balanceService"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, BarChart2, Trophy, Wallet } from "lucide-react"

interface StatsBarProps {
  stats: StatsResult
  balanceResult?: BalanceResult | null
  balanceLoading?: boolean
}

export function StatsBar({ stats, balanceResult, balanceLoading }: StatsBarProps) {
  const pnlPositive = stats.totalPnl >= 0

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            className={`text-sm sm:text-2xl font-bold ${
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
          <p className="text-sm sm:text-2xl font-bold">{stats.winRate}%</p>
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
          <p className="text-sm sm:text-2xl font-bold">{stats.tradeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Across all exchanges</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Balance
          </CardTitle>
          <Wallet className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          {balanceLoading && !balanceResult ? (
            <>
              <div className="h-8 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted mt-2" />
            </>
          ) : balanceResult ? (
            <>
              <p className="text-sm sm:text-2xl font-bold">
                {balanceResult.total.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {balanceResult.exchanges
                  .filter((e) => e.balance > 1)
                  .map((e) =>
                    `${e.exchange} ${e.balance.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`
                  )
                  .join(" · ")}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-2xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-1">No keys configured</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
