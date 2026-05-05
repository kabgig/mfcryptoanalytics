'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import * as THREE from 'three'
import { ArrowLeft, Check } from 'lucide-react'

const SHAPES = [
  { id: 'torus-knot-2-3',  label: 'Knot 2:3',     desc: 'Current — elongated figure-8',  geo: () => new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 2, 3) },
  { id: 'torus-knot-3-2',  label: 'Knot 3:2',     desc: 'Wide trefoil',                  geo: () => new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 3, 2) },
  { id: 'torus-knot-5-3',  label: 'Knot 5:3',     desc: 'Star burst',                    geo: () => new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 5, 3) },
  { id: 'torus-knot-3-5',  label: 'Knot 3:5',     desc: 'Cinquefoil',                    geo: () => new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 3, 5) },
  { id: 'torus-knot-7-4',  label: 'Knot 7:4',     desc: 'Extremely complex',             geo: () => new THREE.TorusKnotGeometry(1, 0.28, 320, 28, 7, 4) },
  { id: 'torus',           label: 'Torus',         desc: 'Clean donut',                   geo: () => new THREE.TorusGeometry(1, 0.35, 32, 100) },
  { id: 'sphere',          label: 'Sphere',        desc: 'Globe wireframe',               geo: () => new THREE.SphereGeometry(1.2, 32, 32) },
  { id: 'icosahedron',     label: 'Icosahedron',   desc: 'Geodesic sphere',               geo: () => new THREE.IcosahedronGeometry(1.3, 3) },
  { id: 'octahedron',      label: 'Octahedron',    desc: 'Subdivided diamond',            geo: () => new THREE.OctahedronGeometry(1.4, 4) },
  { id: 'dodecahedron',    label: 'Dodecahedron',  desc: 'Pentagon crystal',              geo: () => new THREE.DodecahedronGeometry(1.3, 2) },
] as const

type ShapeId = typeof SHAPES[number]['id']

function ShapeCanvas({ shape, selected, onSelect }: {
  shape: typeof SHAPES[number]
  selected: boolean
  onSelect: (id: ShapeId) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100)
    camera.position.z = 3.4

    const geo = shape.geo()
    const mat = new THREE.MeshBasicMaterial({ wireframe: true, color: new THREE.Color(0, 0.75, 0.45) })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh)

    let raf: number
    const animate = () => {
      raf = requestAnimationFrame(animate)
      mesh.rotation.y += 0.008
      mesh.rotation.x += 0.003
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      geo.dispose()
      mat.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [shape])

  return (
    <button
      onClick={() => onSelect(shape.id)}
      className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
        selected
          ? 'border-emerald-400 shadow-[0_0_24px_2px_rgba(52,211,153,0.4)]'
          : 'border-white/10 hover:border-white/30'
      }`}
    >
      <div ref={containerRef} className="w-full aspect-square bg-black" />
      {selected && (
        <div className="absolute top-2 right-2 rounded-full bg-emerald-400 p-0.5">
          <Check className="h-3 w-3 text-black" />
        </div>
      )}
      <div className="bg-black/80 px-3 py-2 text-left">
        <p className="text-white text-sm font-mono font-semibold">{shape.label}</p>
        <p className="text-white/40 text-xs font-mono">{shape.desc}</p>
      </div>
    </button>
  )
}

export default function ShapesPage() {
  const [selected, setSelected] = useState<ShapeId>('torus-knot-2-3')

  return (
    <div className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/viz"
            className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/80 transition-colors tracking-widest uppercase"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Viz
          </Link>
          <h1 className="text-sm font-mono text-white/50 tracking-widest uppercase">Shape Preview</h1>
          <Link
            href={`/viz?shape=${selected}`}
            className="text-xs font-mono px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors tracking-widest uppercase"
          >
            Use Selected →
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {SHAPES.map((shape) => (
            <ShapeCanvas
              key={shape.id}
              shape={shape}
              selected={selected === shape.id}
              onSelect={(id) => setSelected(id as ShapeId)}
            />
          ))}
        </div>

        <p className="mt-6 text-center text-white/20 text-xs font-mono tracking-widest">
          CLICK A SHAPE TO SELECT · {selected.toUpperCase()}
        </p>
      </div>
    </div>
  )
}
