import { getAllTrades } from "@/lib/services/tradesService"
import { computeStats } from "@/lib/services/statsService"
import { Navbar } from "@/components/layout/Navbar"
import { StatsBar } from "@/components/dashboard/StatsBar"
import { PnlChart } from "@/components/dashboard/PnlChart"
import { TradesTable } from "@/components/dashboard/TradesTable"

export default async function DashboardPage() {
  const trades = await getAllTrades()
  const stats = computeStats(trades)

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        <StatsBar stats={stats} />
        <PnlChart chartData={stats.chartData} />
        <TradesTable trades={trades} />
      </main>
    </div>
  )
}
