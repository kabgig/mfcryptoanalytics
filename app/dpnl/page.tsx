import { Navbar } from "@/components/layout/Navbar"
import { DPnLView } from "@/components/dpnl/DPnLView"

export default function DPnLPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <DPnLView />
    </div>
  )
}
