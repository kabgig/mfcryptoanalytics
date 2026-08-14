"use client"

import { motion } from "motion/react"
import { TrendingUp, TrendingDown, Wallet, Coins, PiggyBank } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SpotHolding } from "@/types/spot"
import { computeTotals } from "@/lib/services/spotService"
import { pct, price, qty, signedUsd, usd } from "./format"

interface Props {
  holdings: SpotHolding[]
}

function Tile({
  title,
  value,
  sub,
  icon,
  tone,
  delay,
  testId,
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  tone?: "up" | "down"
  delay: number
  testId: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          <p
            data-testid={testId}
            className={`text-2xl font-semibold tracking-tight ${
              tone === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : tone === "down"
                  ? "text-red-600 dark:text-red-400"
                  : ""
            }`}
          >
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function SpotSummary({ holdings }: Props) {
  const t = computeTotals(holdings)
  const up = t.unrealisedPnl >= 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          title="Portfolio value"
          value={usd(t.marketValue)}
          sub={`${t.openTickers} open position${t.openTickers === 1 ? "" : "s"}`}
          testId="spot-portfolio-value"
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
          delay={0}
        />
        <Tile
          title="Cost basis"
          value={usd(t.costBasis)}
          sub={`${usd(t.totalInvested)} invested all-time`}
          testId="spot-cost-basis"
          icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
          delay={0.05}
        />
        <Tile
          title="Unrealised PnL"
          value={signedUsd(t.unrealisedPnl)}
          sub={t.unrealisedPct != null ? pct(t.unrealisedPct) : "no priced holdings"}
          testId="spot-unrealised-pnl"
          tone={up ? "up" : "down"}
          icon={
            up ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )
          }
          delay={0.1}
        />
        <Tile
          title="Realised PnL"
          value={signedUsd(t.realisedPnl)}
          sub="banked from sells"
          testId="spot-realised-pnl"
          tone={t.realisedPnl >= 0 ? "up" : "down"}
          icon={<Coins className="h-4 w-4 text-muted-foreground" />}
          delay={0.15}
        />
      </div>

      {/* Per-coin cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {holdings
          .filter((h) => h.qty > 0)
          .map((h, i) => {
            const hUp = (h.unrealisedPnl ?? 0) >= 0
            return (
              <motion.div
                key={h.ticker}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 + i * 0.03 }}
              >
                <Card className="h-full" data-testid={`spot-coin-card-${h.ticker}`}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base font-semibold">{h.ticker}</CardTitle>
                    {h.unrealisedPct != null && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          hUp
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {pct(h.unrealisedPct)}
                      </span>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <Row
                      label="Holding"
                      value={`${qty(h.qty)} ${h.ticker}`}
                      testId={`spot-qty-${h.ticker}`}
                    />
                    <Row
                      label="Avg entry"
                      value={h.avgEntry != null ? price(h.avgEntry) : "—"}
                      testId={`spot-avg-entry-${h.ticker}`}
                    />
                    <Row
                      label="Market"
                      value={h.currentPrice != null ? price(h.currentPrice) : "no feed"}
                    />
                    <Row label="Invested" value={usd(h.costBasis)} />
                    <Row
                      label="Value"
                      value={h.marketValue != null ? usd(h.marketValue) : "—"}
                      strong
                    />
                    {h.unrealisedPnl != null && (
                      <Row
                        label="PnL"
                        value={signedUsd(h.unrealisedPnl)}
                        tone={hUp ? "up" : "down"}
                      />
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  tone,
  strong,
  testId,
}: {
  label: string
  value: string
  tone?: "up" | "down"
  strong?: boolean
  testId?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        data-testid={testId}
        className={`tabular-nums ${strong ? "font-semibold" : ""} ${
          tone === "up"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "down"
              ? "text-red-600 dark:text-red-400"
              : ""
        }`}
      >
        {value}
      </span>
    </div>
  )
}
