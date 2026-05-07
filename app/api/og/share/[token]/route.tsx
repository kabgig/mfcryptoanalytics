import { ImageResponse } from 'next/og'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const CUTOFF_DAYS = 90

function fmtUsd(n: number) {
  return (n >= 0 ? '+' : '') +
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ── 3D math (no Three.js — runs on Edge) ─────────────────────────────────
type Vec3 = [number, number, number]
type Edge = [Vec3, Vec3]

const rotX = ([x, y, z]: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a)
  return [x, y * c - z * s, y * s + z * c]
}
const rotY = ([x, y, z]: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a)
  return [x * c + z * s, y, -x * s + z * c]
}
const perspProj = ([x, y, z]: Vec3, fov: number, scale: number): [number, number] => {
  const d = z + fov
  return d > 0 ? [(x / d) * scale, -(y / d) * scale] : [0, 0]
}

// Geodesic sphere — matches Three.js IcosahedronGeometry(r, 2)
function geodesicSphere(r: number, levels: number): Edge[] {
  const t = (1 + Math.sqrt(5)) / 2
  const proj = (v: Vec3): Vec3 => { const l = Math.sqrt(v[0]**2+v[1]**2+v[2]**2); return l>1e-9?[v[0]*r/l,v[1]*r/l,v[2]*r/l]:v }
  const verts: Vec3[] = ([ [-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1] ] as Vec3[]).map(proj)
  let faces: [number,number,number][] = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ]
  for (let l = 0; l < levels; l++) {
    const cache = new Map<string,number>()
    const getMid = (a: number, b: number): number => {
      const key = a<b?`${a}_${b}`:`${b}_${a}`
      if (cache.has(key)) return cache.get(key)!
      const va=verts[a],vb=verts[b],idx=verts.length
      verts.push(proj([(va[0]+vb[0])/2,(va[1]+vb[1])/2,(va[2]+vb[2])/2]))
      cache.set(key,idx); return idx
    }
    const next: [number,number,number][] = []
    for (const [a,b,c] of faces) {
      const ab=getMid(a,b),bc=getMid(b,c),ca=getMid(c,a)
      next.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca])
    }
    faces = next
  }
  const seen = new Set<string>(), edges: Edge[] = []
  for (const [a,b,c] of faces) {
    for (const [i,j] of [[a,b],[b,c],[c,a]] as [number,number][]) {
      const key=i<j?`${i}_${j}`:`${j}_${i}`
      if (!seen.has(key)) { seen.add(key); edges.push([verts[i],verts[j]]) }
    }
  }
  return edges
}

function buildWireframePaths() {
  const edges = geodesicSphere(1.3, 2)
  const rx = -0.3, ry = 0.6, fov = 5, scale = 500
  const front: string[] = []
  const back: string[] = []
  for (const [a, b] of edges) {
    const ra = rotY(rotX(a, rx), ry)
    const rb = rotY(rotX(b, rx), ry)
    const [ax, ay] = perspProj(ra, fov, scale)
    const [bx, by] = perspProj(rb, fov, scale)
    const avgZ = (ra[2] + rb[2]) / 2
    const seg = `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`
    if (avgZ > -0.5) front.push(seg)
    else back.push(seg)
  }
  return { front: front.join(''), back: back.join('') }
}

function generateStars(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.sin(i * 127.1 + 1.3) * 0.5 + 0.5) * 2 * Math.PI
    const dist  = 95 + (Math.sin(i * 311.7 + 2.7) * 0.5 + 0.5) * 145
    const x     = +(Math.cos(angle) * dist).toFixed(1)
    const y     = +(Math.sin(angle) * dist).toFixed(1)
    const size  = +(0.4 + (Math.sin(i * 74.9) * 0.5 + 0.5) * 1.4).toFixed(2)
    const op    = +(0.2 + (Math.sin(i * 43.3 + 0.5) * 0.5 + 0.5) * 0.55).toFixed(2)
    return { x, y, size, op }
  })
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
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) return new Response('misconfigured', { status: 500 })

    const neonHttpUrl = dbUrl
      .replace(/^postgres(ql)?:\/\//, 'https://')
      .replace(/(\/[^?]*)?(\?.*)?$/, '/sql')

    const query = async (sql: string, params: unknown[]) => {
      const res = await fetch(neonHttpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': dbUrl },
        body: JSON.stringify({ query: sql, params }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = await res.json() as { rows: Record<string, string>[] }
      return j.rows
    }

    const userRows = await query(
      'SELECT id FROM users WHERE share_token = $1 LIMIT 1',
      [token]
    )

    if (userRows.length === 0) return new Response('Not found', { status: 404 })

    const userId = userRows[0].id
    const cutoff = new Date(Date.now() - CUTOFF_DAYS * 86_400_000).toISOString()

    const rows = await query(
      `SELECT ct.pnl, ct.exchange
       FROM cached_trades ct
       JOIN users u ON u.telegram_id = ct.telegram_id
       WHERE u.id = $1 AND ct.close_time >= $2`,
      [userId, cutoff]
    ) as { pnl: string; exchange: string }[]

    const trades = rows.map(r => ({ pnl: Number(r.pnl), exchange: r.exchange }))
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const wins = trades.filter(t => t.pnl > 0).length
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0

    const byExchange: Record<string, number> = {}
    for (const t of trades) byExchange[t.exchange] = (byExchange[t.exchange] ?? 0) + t.pnl
    const topExchanges = Object.entries(byExchange)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4)

    const pnlPositive = totalPnl >= 0
    const pnlColor = pnlPositive ? '#34d399' : '#f87171'

    const { front, back } = buildWireframePaths()
    const stars = generateStars(90)

    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: '#09090b', display: 'flex', fontFamily: 'monospace' }}>

        {/* ── Left column: stats ── */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '700px', height: '630px', padding: '52px 60px' }}>

          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: '#ffffff', fontSize: '21px', fontWeight: 600, letterSpacing: '-0.02em' }}>
              MF Crypto Analytics
            </span>
            <span style={{ color: '#3f3f46', fontSize: '21px' }}>·</span>
            <span style={{ color: '#52525b', fontSize: '16px', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Shared PnL · 3M
            </span>
          </div>

          {/* PnL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ color: '#52525b', fontSize: '17px', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Total PnL
            </span>
            <span style={{ color: pnlColor, fontSize: '86px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
              {fmtUsd(totalPnl)}
            </span>
          </div>

          {/* Bottom stats */}
          <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: '#3f3f46', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Win Rate</span>
              <span style={{ color: '#e4e4e7', fontSize: '34px', fontWeight: 600 }}>{winRate.toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: '#3f3f46', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Trades</span>
              <span style={{ color: '#e4e4e7', fontSize: '34px', fontWeight: 600 }}>{trades.length}</span>
            </div>
            <div style={{ flex: 1 }} />
            {topExchanges.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end' }}>
                {topExchanges.map(([ex, v]) => (
                  <div key={ex} style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                    <span style={{ color: '#3f3f46', fontSize: '14px', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{ex}</span>
                    <span style={{ color: v >= 0 ? '#34d399' : '#f87171', fontSize: '18px', fontWeight: 600, minWidth: '110px', textAlign: 'right' }}>
                      {fmtUsd(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div style={{ width: '1px', background: '#1c1c1e', height: '100%' }} />

        {/* ── Right column: wireframe shape ── */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${pnlColor}04 0%, #09090b 68%)` }}>
          <svg width={480} height={480} viewBox="-240 -240 480 480">
            {/* Space particles */}
            {stars.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.size} fill={pnlColor} opacity={s.op * 0.55} />
            ))}
            {/* Back edges — dim */}
            {back && (
              <path d={back} stroke={pnlColor} strokeWidth="1" fill="none" opacity="0.22" />
            )}
            {/* Front glow — widest bloom */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="12" fill="none" opacity="0.04" />
            )}
            {/* Front glow — wide */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="6" fill="none" opacity="0.10" />
            )}
            {/* Front glow — medium */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="2.5" fill="none" opacity="0.30" />
            )}
            {/* Front crisp line */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="1.1" fill="none" opacity="0.90" />
            )}
          </svg>
        </div>

      </div>,
      { width: 1200, height: 630 }
    )
  } catch (err) {
    console.error('[og/share] error:', err)
    return new Response('Error', { status: 500 })
  }
}
