import { ImageResponse } from 'next/og'
import { getSql } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CUTOFF_DAYS = 90

function fmt(n: number) {
  return (n >= 0 ? '+' : '') +
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const sql = getSql()

    const userRows = await sql`
      SELECT id FROM users WHERE share_token = ${token} LIMIT 1
    ` as { id: string }[]

    if (userRows.length === 0) return new Response('Not found', { status: 404 })

    const userId = userRows[0].id
    const cutoff = new Date(Date.now() - CUTOFF_DAYS * 86_400_000).toISOString()

    const rows = await sql`
      SELECT ct.pnl, ct.exchange, ct.close_time
      FROM cached_trades ct
      JOIN users u ON u.telegram_id = ct.telegram_id
      WHERE u.id = ${userId}
        AND ct.close_time >= ${cutoff}
      ORDER BY ct.close_time DESC
    ` as { pnl: string; exchange: string; close_time: Date }[]

    const trades = rows.map(r => ({ pnl: Number(r.pnl), exchange: r.exchange }))
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const wins = trades.filter(t => t.pnl > 0).length
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0

    // Top exchanges by absolute PnL
    const byExchange: Record<string, number> = {}
    for (const t of trades) byExchange[t.exchange] = (byExchange[t.exchange] ?? 0) + t.pnl
    const topExchanges = Object.entries(byExchange)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4)

    const pnlPositive = totalPnl >= 0
    const pnlColor = pnlPositive ? '#34d399' : '#f87171' // emerald-400 / red-400

    return new ImageResponse(
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#09090b',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 64px',
          fontFamily: 'monospace',
        }}
      >
        {/* Top row: brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#ffffff', fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            MF Crypto Analytics
          </span>
          <span style={{ color: '#3f3f46', fontSize: '22px' }}>·</span>
          <span style={{ color: '#71717a', fontSize: '18px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Shared PnL · 3M
          </span>
        </div>

        {/* Main PnL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ color: '#71717a', fontSize: '20px', letterSpacing: '0.25em', textTransform: 'uppercase' }}>
            Total PnL
          </span>
          <span style={{ color: pnlColor, fontSize: '96px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
            {fmt(totalPnl)}
          </span>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '48px', alignItems: 'flex-end' }}>
          {/* Win rate */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: '#52525b', fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Win Rate</span>
            <span style={{ color: '#e4e4e7', fontSize: '36px', fontWeight: 600 }}>{winRate.toFixed(1)}%</span>
          </div>

          {/* Trade count */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: '#52525b', fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Trades</span>
            <span style={{ color: '#e4e4e7', fontSize: '36px', fontWeight: 600 }}>{trades.length}</span>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Exchange breakdown */}
          {topExchanges.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
              {topExchanges.map(([ex, pnl]) => (
                <div key={ex} style={{ display: 'flex', gap: '20px', alignItems: 'baseline' }}>
                  <span style={{ color: '#52525b', fontSize: '16px', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{ex}</span>
                  <span style={{ color: pnl >= 0 ? '#34d399' : '#f87171', fontSize: '20px', fontWeight: 600, minWidth: '120px', textAlign: 'right' }}>
                    {fmt(pnl)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>,
      { width: 1200, height: 630 }
    )
  } catch (err) {
    console.error('[og/share] error:', err)
    return new Response('Error', { status: 500 })
  }
}
