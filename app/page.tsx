import { Navbar } from "@/components/layout/Navbar"
import { HomeView } from "@/components/home/HomeView"

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <HomeView />
    </div>
  )
}
