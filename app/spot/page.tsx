import { Navbar } from "@/components/layout/Navbar"
import { SpotView } from "@/components/spot/SpotView"

export default function SpotPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <SpotView />
    </div>
  )
}
