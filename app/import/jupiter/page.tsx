import { Navbar } from "@/components/layout/Navbar"
import { JupiterImportView } from "@/components/import/jupiter/JupiterImportView"

export default function JupiterImportPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <JupiterImportView />
    </div>
  )
}
