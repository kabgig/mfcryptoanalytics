import { ImageResponse } from 'next/og'
import { getSql } from '@/lib/db'

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
const d3 = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): number => {
  const dx = ax - bx, dy = ay - by, dz = az - bz
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
const cross3 = ([ax,ay,az]: Vec3, [bx,by,bz]: Vec3): Vec3 => [ay*bz - az*by, az*bx - ax*bz, ax*by - ay*bx]
const dot3   = ([ax,ay,az]: Vec3, [bx,by,bz]: Vec3) => ax*bx + ay*by + az*bz
const norm3  = (v: Vec3): Vec3 => { const l = Math.sqrt(dot3(v,v)); return l > 1e-9 ? [v[0]/l, v[1]/l, v[2]/l] : v }

// ── Shape generators ──────────────────────────────────────────────────────
const polyEdges = (verts: Vec3[], len: number, tol = 0.07): Edge[] => {
  const out: Edge[] = []
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++)
      if (Math.abs(d3(verts[i], verts[j]) - len) < tol)
        out.push([verts[i], verts[j]])
  return out
}

const PHI = (1 + Math.sqrt(5)) / 2

// Subdivide edges once, projecting midpoints back onto sphere
const subdivideEdges = (edges: Edge[], levels: number): Edge[] => {
  for (let l = 0; l < levels; l++) {
    const next: Edge[] = []
    for (const [a, b] of edges) {
      const mid: Vec3 = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2]
      const ra = Math.sqrt(a[0]**2 + a[1]**2 + a[2]**2)
      const rm = Math.sqrt(mid[0]**2 + mid[1]**2 + mid[2]**2)
      if (rm > 1e-9) { const sc = ra/rm; mid[0]*=sc; mid[1]*=sc; mid[2]*=sc }
      next.push([a, mid], [mid, b])
    }
    edges = next
  }
  return edges
}

const icosahedronEdges = (): Edge[] => {
  const s = 0.9
  return polyEdges([
    [0,s,s*PHI],[0,-s,s*PHI],[0,s,-s*PHI],[0,-s,-s*PHI],
    [s,s*PHI,0],[-s,s*PHI,0],[s,-s*PHI,0],[-s,-s*PHI,0],
    [s*PHI,0,s],[-s*PHI,0,s],[s*PHI,0,-s],[-s*PHI,0,-s],
  ], 2 * s)
}
const octahedronEdges = (): Edge[] => {
  const s = 1.5
  return polyEdges([[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]], s * Math.SQRT2)
}
const dodecahedronEdges = (): Edge[] => {
  const s = 0.9
  return polyEdges([
    [s,s,s],[s,s,-s],[s,-s,s],[s,-s,-s],
    [-s,s,s],[-s,s,-s],[-s,-s,s],[-s,-s,-s],
    [0,s/PHI,s*PHI],[0,s/PHI,-s*PHI],[0,-s/PHI,s*PHI],[0,-s/PHI,-s*PHI],
    [s/PHI,s*PHI,0],[-s/PHI,s*PHI,0],[s/PHI,-s*PHI,0],[-s/PHI,-s*PHI,0],
    [s*PHI,0,s/PHI],[s*PHI,0,-s/PHI],[-s*PHI,0,s/PHI],[-s*PHI,0,-s/PHI],
  ], 2 * s / PHI, 0.07)
}
const torusKnotEdges = (p: number, q: number, TS = 56, RS = 10): Edge[] => {
  const R = 0.9, tubeR = 0.22
  // Center curve + numerical tangents
  const centers: Vec3[] = [], tangents: Vec3[] = []
  for (let i = 0; i < TS; i++) {
    const t = (i / TS) * 2 * Math.PI
    const qt = q * t, pt = p * t
    const r = 0.5 * (2 + Math.cos(qt)) * R
    centers.push([r * Math.cos(pt), r * Math.sin(pt), -0.5 * Math.sin(qt) * R])
    const t2 = t + 0.001, r2 = 0.5 * (2 + Math.cos(q*t2)) * R
    const dt: Vec3 = [r2*Math.cos(p*t2) - centers[i][0], r2*Math.sin(p*t2) - centers[i][1], -0.5*Math.sin(q*t2)*R - centers[i][2]]
    tangents.push(norm3(dt))
  }
  // Rotation minimizing frames (parallel transport)
  const normals: Vec3[] = new Array(TS)
  const T0 = tangents[0]
  normals[0] = norm3(cross3(T0, Math.abs(T0[1]) < 0.9 ? [0,1,0] : [1,0,0]))
  for (let i = 1; i < TS; i++) {
    const Tc = tangents[i], Np = normals[i-1]
    const d = dot3(Np, Tc)
    const r: Vec3 = [Np[0]-d*Tc[0], Np[1]-d*Tc[1], Np[2]-d*Tc[2]]
    const l = Math.sqrt(r[0]**2+r[1]**2+r[2]**2)
    normals[i] = l > 1e-9 ? [r[0]/l, r[1]/l, r[2]/l] : Np
  }
  // Build rings
  const rings: Vec3[][] = []
  for (let i = 0; i < TS; i++) {
    const C = centers[i], T = tangents[i], N = normals[i]
    const B = norm3(cross3(T, N))
    const ring: Vec3[] = []
    for (let j = 0; j < RS; j++) {
      const a = (j / RS) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a)
      ring.push([C[0]+tubeR*(N[0]*c+B[0]*s), C[1]+tubeR*(N[1]*c+B[1]*s), C[2]+tubeR*(N[2]*c+B[2]*s)])
    }
    rings.push(ring)
  }
  // Edges: along tube + around each ring
  const out: Edge[] = []
  for (let i = 0; i < TS; i++) {
    const ni = (i+1) % TS
    for (let j = 0; j < RS; j++) {
      out.push([rings[i][j], rings[ni][j]])
      out.push([rings[i][j], rings[i][(j+1) % RS]])
    }
  }
  return out
}
const torusEdges = (): Edge[] => {
  const R = 1.2, r = 0.42, s = 0.8, NU = 28, NV = 14
  const out: Edge[] = []
  for (let j = 0; j < NV; j++) {
    const v = (j / NV) * 2 * Math.PI
    const pts: Vec3[] = Array.from({ length: NU + 1 }, (_, i) => {
      const u = (i / NU) * 2 * Math.PI
      return [(R + r * Math.cos(v)) * Math.cos(u) * s, (R + r * Math.cos(v)) * Math.sin(u) * s, r * Math.sin(v) * s]
    })
    for (let i = 0; i < NU; i++) out.push([pts[i], pts[i + 1]])
  }
  for (let i = 0; i < NU; i++) {
    const u = (i / NU) * 2 * Math.PI
    const pts: Vec3[] = Array.from({ length: NV + 1 }, (_, j) => {
      const v = (j / NV) * 2 * Math.PI
      return [(R + r * Math.cos(v)) * Math.cos(u) * s, (R + r * Math.cos(v)) * Math.sin(u) * s, r * Math.sin(v) * s]
    })
    for (let j = 0; j < NV; j++) out.push([pts[j], pts[j + 1]])
  }
  return out
}
const sphereEdges = (): Edge[] => {
  const R = 1.4, NLat = 8, NLon = 14
  const out: Edge[] = []
  for (let i = 1; i < NLat; i++) {
    const phi = (i / NLat) * Math.PI, y = R * Math.cos(phi), rr = R * Math.sin(phi)
    const pts: Vec3[] = Array.from({ length: NLon + 1 }, (_, j) => {
      const theta = (j / NLon) * 2 * Math.PI
      return [rr * Math.cos(theta), y, rr * Math.sin(theta)]
    })
    for (let j = 0; j < NLon; j++) out.push([pts[j], pts[j + 1]])
  }
  for (let j = 0; j < NLon; j++) {
    const theta = (j / NLon) * 2 * Math.PI
    const pts: Vec3[] = Array.from({ length: NLat + 1 }, (_, i) => {
      const phi = (i / NLat) * Math.PI
      return [R * Math.sin(phi) * Math.cos(theta), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta)]
    })
    for (let i = 0; i < NLat; i++) out.push([pts[i], pts[i + 1]])
  }
  return out
}

const SHAPE_BUILDERS: Record<string, () => Edge[]> = {
  'torus-knot-2-3': () => torusKnotEdges(2, 3),
  'torus-knot-3-2': () => torusKnotEdges(3, 2),
  'torus-knot-5-3': () => torusKnotEdges(5, 3),
  'torus-knot-3-5': () => torusKnotEdges(3, 5),
  'torus-knot-7-4': () => torusKnotEdges(7, 4),
  'torus':          torusEdges,
  'sphere':         sphereEdges,
  'icosahedron':    () => subdivideEdges(icosahedronEdges(), 3),
  'octahedron':     () => subdivideEdges(octahedronEdges(), 2),
  'dodecahedron':   () => subdivideEdges(dodecahedronEdges(), 1),
}

function buildWireframePaths(shapeId: string) {
  const edges = (SHAPE_BUILDERS[shapeId] ?? SHAPE_BUILDERS['icosahedron'])()
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const shapeId = new URL(_req.url).searchParams.get('shape') ?? 'icosahedron'

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
      SELECT ct.pnl, ct.exchange
      FROM cached_trades ct
      JOIN users u ON u.telegram_id = ct.telegram_id
      WHERE u.id = ${userId}
        AND ct.close_time >= ${cutoff}
    ` as { pnl: string; exchange: string }[]

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

    const { front, back } = buildWireframePaths(shapeId)

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
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <svg width={480} height={480} viewBox="-240 -240 480 480">
            {/* Back edges — dim */}
            {back && (
              <path d={back} stroke={pnlColor} strokeWidth="0.8" fill="none" opacity="0.12" />
            )}
            {/* Front glow — wide soft layer */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="5" fill="none" opacity="0.06" />
            )}
            {/* Front glow — medium layer */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="2.5" fill="none" opacity="0.18" />
            )}
            {/* Front crisp line */}
            {front && (
              <path d={front} stroke={pnlColor} strokeWidth="1.2" fill="none" opacity="0.65" />
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
