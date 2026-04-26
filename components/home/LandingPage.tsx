'use client'

import { BarChart2, TrendingUp, ShieldCheck } from 'lucide-react'

const features = [
  {
    icon: BarChart2,
    title: 'Multi-Exchange PnL',
    description: 'Aggregate your trading performance across Binance, Bybit, and more in one view.',
  },
  {
    icon: TrendingUp,
    title: 'Cumulative Charts',
    description: 'Visualise your equity curve and spot performance trends over time.',
  },
  {
    icon: ShieldCheck,
    title: 'Read-Only API Keys',
    description: 'Your keys never leave your device. All data is fetched directly from exchange APIs.',
  },
]

export function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center text-center px-4 py-24 gap-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
          <BarChart2 className="h-3.5 w-3.5" />
          Crypto PnL Analytics
        </div>

        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
          Track your trading performance{' '}
          <span className="text-emerald-500">across every exchange</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground">
          Connect via Telegram to see your unified PnL dashboard — closed trades, win rate, and equity
          curve from Binance, Bybit, BingX, MEXC and more, all in one place.
        </p>

        <a
          href="https://t.me/mfcryptoanalyticsbot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-base font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          Login with Telegram
        </a>
      </section>

      {/* Features */}
      <section className="border-t border-border/30 bg-muted/20 px-4 py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-3 rounded-2xl bg-card p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
