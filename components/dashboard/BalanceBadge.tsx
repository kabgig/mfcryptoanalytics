'use client'

import type { BalanceResult } from "@/lib/services/balanceService"
import { Wallet } from "lucide-react"

interface BalanceBadgeProps {
  result: BalanceResult | null
  loading: boolean
}

export function BalanceBadge({ result, loading }: BalanceBadgeProps) {
  if (loading && !result) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-blue-400/40 bg-blue-400/10 px-4 py-2.5 text-sm text-blue-600 dark:text-blue-400">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
        </span>
        <span className="font-medium">Fetching balances…</span>
      </div>
    )
  }

  if (!result) return null

  const { total, exchanges, errors } = result

  const significant = exchanges.filter((e) => e.balance > 1)
  const errorNames = Object.keys(errors)

  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="text-base font-bold text-emerald-700 dark:text-emerald-300">
          {total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}
        </span>
        <span className="text-xs text-muted-foreground">total balance</span>
      </div>

      {significant.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {significant.map((e) => (
            <span key={e.exchange} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">{e.exchange}</span>{" "}
              {e.balance.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
            </span>
          ))}
        </div>
      )}

      {errorNames.length > 0 && (
        <span className="text-xs text-destructive/70">
          {errorNames.join(", ")} unavailable
        </span>
      )}
    </div>
  )
}
