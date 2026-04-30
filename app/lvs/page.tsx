import { Navbar } from "@/components/layout/Navbar"
import { LvsSView } from "@/components/lvs/LvsSView"

export default function LvsSPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <LvsSView />
    </div>
  )
}
