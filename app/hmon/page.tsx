import { Navbar } from "@/components/layout/Navbar"
import { HMonView } from "@/components/hmon/HMonView"

export default function HMonPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <HMonView />
    </div>
  )
}
