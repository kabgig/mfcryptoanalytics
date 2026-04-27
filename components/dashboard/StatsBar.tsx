import { StatsResult } from "@/types"
import type { BalanceResult } from "@/lib/services/balanceService"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip } from "@/components/ui/tooltip"
import { TrendingUp, TrendingDown, BarChart2, Trophy, Wallet, Activity } from "lucide-react"

interface StatsBarProps {
  stats: StatsResult
  balanceResult?: BalanceResult | null
  balanceLoading?: boolean
}

export function StatsBar({ stats, balanceResult, balanceLoading }: StatsBarProps) {
  const pnlPositive = stats.totalPnl >= 0

  const pfDisplay = stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : "∞"
  const rrrDisplay = stats.rrr !== null ? `${stats.rrr.toFixed(2)}x` : "∞"
  const ddDisplay = stats.maxDrawdown.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      {/* Total PnL */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <Tooltip content="Sum of all realized PnL across every connected exchange and market.">
              Total PnL
            </Tooltip>
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

      {/* Win Rate + Profit Factor */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <Tooltip content="Win Rate: % of trades closed in profit. Profit Factor (PF): total gross profit ÷ total gross loss. PF > 1 means the strategy is profitable overall.">
              Win Rate
            </Tooltip>
          </CardTitle>
          <Trophy className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <p className="text-sm sm:text-2xl font-bold">{stats.winRate}%</p>
            <p className="text-xs text-muted-foreground font-medium">PF {pfDisplay}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Profitable trades</p>
        </CardContent>
      </Card>

      {/* Total Trades */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <Tooltip content="Total number of closed trades across all connected exchanges.">
              Total Trades
            </Tooltip>
          </CardTitle>
          <BarChart2 className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <p className="text-sm sm:text-2xl font-bold">{stats.tradeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Across all exchanges</p>
        </CardContent>
      </Card>

      {/* RRR + Max Drawdown */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <Tooltip content="RRR (Risk/Reward Ratio): average winning trade ÷ average losing trade. Max Drawdown: largest peak-to-trough decline in cumulative PnL over the period.">
              RRR / Max DD
            </Tooltip>
          </CardTitle>
          <Activity className="h-4 w-4 text-violet-500" />
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <p className="text-sm sm:text-xl font-bold">{rrrDisplay}</p>
            <p className="text-xs text-muted-foreground font-medium">
              <span className="text-red-500">-{ddDisplay}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Risk metrics</p>
        </CardContent>
      </Card>

      {/* Total Balance */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <Tooltip content="Current sum of all exchange wallet balances fetched via API.">
              Total Balance
            </Tooltip>
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
