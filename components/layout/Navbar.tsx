import { ThemeToggle } from "./ThemeToggle"
import { WalletButton } from "./WalletButton"

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <span className="text-lg font-semibold tracking-tight">
          MF Crypto Analytics
        </span>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  )
}
