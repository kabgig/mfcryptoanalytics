'use client'

import { useAppKit } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'
import { Wallet, BarChart2, TrendingUp, ShieldCheck } from 'lucide-react'

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
    title: 'Non-Custodial',
    description: 'Your wallet is your identity. No email, no password, no data stored on our servers.',
  },
]

export function LandingPage() {
  const { open } = useAppKit()

  return (
    <main className="flex-1 flex flex-col">
      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center text-center px-4 py-24 gap-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
          <BarChart2 className="h-3.5 w-3.5" />
          Crypto PnL Analytics
        </div>

        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Track your trading performance{' '}
          <span className="text-emerald-500">across every exchange</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground">
          Connect your wallet to see your unified PnL dashboard — trades, win rate, and equity
          curve from Binance, Bybit, and more, all in one place.
        </p>

        <Button size="lg" className="gap-2 text-base px-8" onClick={() => open()}>
          <Wallet className="h-5 w-5" />
          Connect Wallet to Start
        </Button>
      </section>

      {/* Features */}
      <section className="border-t border-border/60 bg-muted/30 px-4 py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                <Icon className="h-5 w-5 text-emerald-500" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
