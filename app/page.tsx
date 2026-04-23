import { getAllTrades } from "@/lib/services/tradesService"
import { computeStats } from "@/lib/services/statsService"
import { Navbar } from "@/components/layout/Navbar"
import { HomeView } from "@/components/home/HomeView"

export default async function DashboardPage() {
  const trades = await getAllTrades()
  const stats = computeStats(trades)

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <HomeView trades={trades} stats={stats} />
    </div>
  )
}
