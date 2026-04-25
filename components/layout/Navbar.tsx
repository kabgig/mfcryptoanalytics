import { ThemeToggle } from "./ThemeToggle"
import { WalletButton } from "./WalletButton"
import { ApiKeysModal } from "@/components/settings/ApiKeysModal"

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/30 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <span className="text-lg font-medium tracking-tight">
          MF Crypto Analytics
        </span>

        <div className="flex items-center gap-2">
          <ApiKeysModal />
          <ThemeToggle />
          {/* <WalletButton /> */}
        </div>
      </div>
    </header>
  )
}
