import { Navbar } from "@/components/layout/Navbar"
import { EMonView } from "@/components/emon/EMonView"

export default function EMonPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <EMonView />
    </div>
  )
}
