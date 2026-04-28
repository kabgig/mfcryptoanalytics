import { Navbar } from "@/components/layout/Navbar"
import { WMonView } from "@/components/wmon/WMonView"

export default function WMonPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <WMonView />
    </div>
  )
}
