import { Navbar } from "@/components/layout/Navbar"
import { TMonView } from "@/components/tmon/TMonView"

export default function TMonPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <TMonView />
    </div>
  )
}
