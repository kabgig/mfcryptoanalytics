'use client'

import { useUserStore } from '@/lib/store/userStore'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { LandingPage } from '@/components/home/LandingPage'
import type { StatsResult } from '@/types'
import type { Trade } from '@/types'

interface HomeViewProps {
  trades: Trade[]
  stats: StatsResult
}

export function HomeView({ trades, stats }: HomeViewProps) {
  const walletAddress = useUserStore((s) => s.walletAddress)

  if (!walletAddress) {
    return <LandingPage />
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      <StatsBar stats={stats} />
      <PnlChart chartData={stats.chartData} />
      <TradesTable trades={trades} />
    </main>
  )
}
