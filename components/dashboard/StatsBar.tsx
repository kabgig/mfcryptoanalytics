import { StatsResult } from "@/types"
import type { BalanceResult } from "@/lib/services/balanceService"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoTooltip } from "@/components/ui/tooltip"
import { TrendingUp, TrendingDown, Trophy, Wallet, Activity } from "lucide-react"

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
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {/* Total PnL + Total Trades (secondary) */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            Total PnL
            <InfoTooltip content="Sum of all realized PnL across every connected exchange and market." />
          </CardTitle>
          {pnlPositive ? (
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          <p
            className={`text-lg font-bold ${
              pnlPositive ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {pnlPositive ? "+" : ""}
            {stats.totalPnl.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </p>
          <p className="flex items-center gap-0.5 text-xs text-muted-foreground mt-1">
            {stats.tradeCount} trades
            <InfoTooltip content="Total number of closed trades fetched across all connected exchanges." />
          </p>
        </CardContent>
      </Card>

      {/* Win Rate + Profit Factor (secondary) */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            Win Rate
            <InfoTooltip content="Percentage of trades closed with a positive PnL. Formula: winning trades ÷ total trades × 100." />
          </CardTitle>
          <Trophy className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <p className="text-lg font-bold">{stats.winRate}%</p>
          <p className="flex items-center gap-0.5 text-xs text-muted-foreground mt-1">
            PF {pfDisplay}
            <InfoTooltip content="Profit Factor: total gross profit ÷ total gross loss. A value > 1 means the strategy earns more than it loses. ∞ means no losing trades." />
          </p>
        </CardContent>
      </Card>

      {/* RRR + Max Drawdown (secondary) */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            RRR / Max DD
            <InfoTooltip content="RRR — how much you earn on average per winning trade relative to what you lose on a losing one. E.g. RRR 2x means your average win is twice your average loss. Max DD — the deepest dip your account ever took from a peak before recovering (or not). Shows worst-case pain." />
          </CardTitle>
          <Activity className="h-4 w-4 text-violet-500" />
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-0.5 text-lg font-bold">
            {rrrDisplay}
            <InfoTooltip content="Risk/Reward Ratio = avg. win ÷ avg. loss. RRR 2x means every winning trade returns twice what a losing trade costs. Combined with Win Rate it determines whether the strategy is profitable long-term. ∞ = no losing trades yet." />
          </p>
          <p className="flex items-center gap-0.5 text-xs text-muted-foreground mt-1">
            <span className="text-red-500">-{ddDisplay}</span>
            <InfoTooltip content="Max Drawdown = the biggest drop your cumulative PnL has taken from any peak before reaching a new high (or today). E.g. if your PnL hit +$1 000 then fell to +$600, the drawdown is $400. Measures the worst losing streak in dollar terms." />
          </p>
        </CardContent>
      </Card>

      {/* Total Balance */}
      <Card className="overflow-visible">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            Total Balance
            <InfoTooltip content="Current combined wallet balance across all exchanges, fetched live via API keys. Updates on page load." />
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
              <p className="text-lg font-bold">
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
              <p className="text-2xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-1">No keys configured</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
