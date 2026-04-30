'use client'

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { ThemeToggle } from "./ThemeToggle"
import { ApiKeysModal } from "@/components/settings/ApiKeysModal"
import { useUserStore } from "@/lib/store/userStore"
import { LogOut, Settings, Moon, Sun, Menu, X } from "lucide-react"

// Telegram SVG logo
function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}

// Shared nav link list — used by both desktop and mobile
interface NavLink { label: string; href: string; adminOnly?: boolean }
const NAV_LINKS: NavLink[] = [
  { label: "Main",  href: "/" },
  { label: "WMon",  href: "/wmon" },
  { label: "HMon",  href: "/hmon" },
  { label: "TMon",  href: "/tmon" },
  { label: "EMon",  href: "/emon" },
  { label: "admin", href: "/admin", adminOnly: true },
]

function MobileThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent rounded-md transition-colors"
    >
      {theme === "dark"
        ? <Sun className="h-4 w-4 shrink-0" />
        : <Moon className="h-4 w-4 shrink-0" />}
      Dark mode
    </button>
  )
}

export function Navbar() {
  const pathname = usePathname()
  const telegramId = useUserStore((s) => s.telegramId)
  const telegramName = useUserStore((s) => s.telegramName)
  const role = useUserStore((s) => s.role)
  const clear = useUserStore((s) => s.clear)
  const [mobileOpen, setMobileOpen] = useState(false)

  const visibleLinks = NAV_LINKS.filter((l) => !l.adminOnly || role === "ADMIN")

  const linkClass = (href: string) =>
    `text-sm font-medium transition-colors hover:text-foreground ${
      pathname === href ? "text-foreground" : "text-muted-foreground"
    }`

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/30 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Brand + nav links (left side) */}
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium tracking-tight sm:text-lg shrink-0">
            MF Crypto Analytics
          </span>
          <nav className="hidden sm:flex items-center gap-5">
            {visibleLinks.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(l.href)}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Desktop right controls */}
        <div className="hidden sm:flex items-center gap-2">
          <ThemeToggle />
          {telegramId ? (
            <>
              <ApiKeysModal />
              <span className="text-sm text-muted-foreground hidden md:inline">
                {telegramName}
              </span>
              <button
                onClick={clear}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </>
          ) : (
            <a
              href="https://t.me/mfcryptoanalyticsbot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              <TelegramIcon className="h-4 w-4 text-[#2AABEE]" />
              Login
            </a>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-border/30 bg-background/95 backdrop-blur-sm px-4 py-3 flex flex-col gap-1">
          {/* Nav links */}
          {visibleLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center px-4 py-2.5 text-sm font-medium rounded-md transition-colors hover:bg-accent ${
                pathname === l.href ? "text-foreground bg-accent/50" : "text-muted-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}

          <div className="my-1.5 h-px bg-border/50" />

          {/* Settings */}
          {telegramId && (
            <div className="px-1">
              <ApiKeysModal
                trigger={
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors">
                    <Settings className="h-4 w-4 shrink-0" />
                    Settings
                  </button>
                }
              />
            </div>
          )}

          {/* Dark mode */}
          <div className="px-1">
            <MobileThemeToggle />
          </div>

          <div className="my-1.5 h-px bg-border/50" />

          {/* Auth */}
          <div className="px-1">
            {telegramId ? (
              <>
                {telegramName && (
                  <p className="px-4 py-1.5 text-xs text-muted-foreground">{telegramName}</p>
                )}
                <button
                  onClick={() => { clear(); setMobileOpen(false) }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Logout
                </button>
              </>
            ) : (
              <a
                href="https://t.me/mfcryptoanalyticsbot"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
              >
                <TelegramIcon className="h-4 w-4 text-[#2AABEE] shrink-0" />
                Login with Telegram
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
