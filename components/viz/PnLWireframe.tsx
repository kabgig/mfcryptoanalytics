'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export interface PnLWireframeProps {
  pnl: number
  maxAbsPnl: number
  shapeId?: string
  darkMode?: boolean
}

function buildGeometry(shapeId: string): THREE.BufferGeometry {
  switch (shapeId) {
    case 'torus-knot-3-2':  return new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 3, 2)
    case 'torus-knot-5-3':  return new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 5, 3)
    case 'torus-knot-3-5':  return new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 3, 5)
    case 'torus-knot-7-4':  return new THREE.TorusKnotGeometry(1, 0.28, 320, 28, 7, 4)
    case 'torus':            return new THREE.TorusGeometry(1, 0.35, 32, 100)
    case 'sphere':           return new THREE.SphereGeometry(1.2, 32, 32)
    case 'icosahedron':      return new THREE.IcosahedronGeometry(1.3, 3)
    case 'octahedron':       return new THREE.OctahedronGeometry(1.4, 4)
    case 'dodecahedron':     return new THREE.DodecahedronGeometry(1.3, 2)
    default:                 return new THREE.TorusKnotGeometry(1, 0.3, 320, 28, 2, 3)
  }
}

const PARTICLE_COUNT = 420
const STAR_COUNT = 270

interface SceneState {
  speedRef:      { current: number }
  starSpeedRef:  { current: number }
  targetColor:   THREE.Color
  currentColor:  THREE.Color
  mesh:          THREE.Mesh
  bloomPass:     UnrealBloomPass
  particleGeo:   THREE.BufferGeometry
  particleVels:  Float32Array
  particleMat:   THREE.PointsMaterial
  starGeo:       THREE.BufferGeometry
  starDirs:      Float32Array
  starMat:       THREE.PointsMaterial
  renderer:      THREE.WebGLRenderer
  scene:         THREE.Scene
}

export function PnLWireframe({ pnl, maxAbsPnl, shapeId = 'torus-knot-2-3', darkMode = true }: PnLWireframeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef     = useRef<SceneState | null>(null)
  const darkModeRef  = useRef(darkMode)
  darkModeRef.current = darkMode

  // ── Build scene (re-runs only when shapeId changes) ──────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.toneMapping = THREE.ReinhardToneMapping
    renderer.toneMappingExposure = 1.2
    renderer.setClearColor(darkModeRef.current ? 0x000000 : 0xffffff, 1)
    container.appendChild(renderer.domElement)

    // Scene + fog
    const scene  = new THREE.Scene()
    scene.background = new THREE.Color(darkModeRef.current ? 0x000000 : 0xffffff)
    scene.fog    = new THREE.FogExp2(darkModeRef.current ? 0x000000 : 0xffffff, 0.1)
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100)
    camera.position.z = 3.8

    // ── Main wireframe mesh ──────────────────────────────────────────────────
    const geometry  = buildGeometry(shapeId)
    const initColor = new THREE.Color(0, 0.6, 0.35)
    const material  = new THREE.MeshBasicMaterial({ wireframe: true, color: initColor })
    const mesh      = new THREE.Mesh(geometry, material)
    mesh.scale.setScalar(0.8)
    scene.add(mesh)

    // ── Ambient particle field ───────────────────────────────────────────────
    const pPos  = new Float32Array(PARTICLE_COUNT * 3)
    const pCol  = new Float32Array(PARTICLE_COUNT * 3)
    const pVels = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      pPos[i3]     = (Math.random() - 0.5) * 14
      pPos[i3 + 1] = (Math.random() - 0.5) * 14
      pPos[i3 + 2] = (Math.random() - 0.5) * 14
      pCol[i3]     = 0;  pCol[i3 + 1] = 0.5;  pCol[i3 + 2] = 0.3
      pVels[i3]     = (Math.random() - 0.5) * 0.003
      pVels[i3 + 1] = (Math.random() - 0.5) * 0.003
      pVels[i3 + 2] = (Math.random() - 0.5) * 0.003
    }
    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos.slice(), 3))
    particleGeo.setAttribute('color',    new THREE.BufferAttribute(pCol.slice(), 3))
    const particleMat = new THREE.PointsMaterial({ size: 0.0125, vertexColors: true, transparent: true, opacity: 0.65 })
    scene.add(new THREE.Points(particleGeo, particleMat))

    // ── Star / warp field ────────────────────────────────────────────────────
    const sPos  = new Float32Array(STAR_COUNT * 3)
    const sDirs = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      const i3  = i * 3
      const r   = 1.5 + Math.random() * 9
      const th  = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      sPos[i3]     = r * Math.sin(phi) * Math.cos(th)
      sPos[i3 + 1] = r * Math.sin(phi) * Math.sin(th)
      sPos[i3 + 2] = r * Math.cos(phi)
      const len    = Math.sqrt(sPos[i3] ** 2 + sPos[i3 + 1] ** 2 + sPos[i3 + 2] ** 2)
      sDirs[i3]     = sPos[i3]     / len
      sDirs[i3 + 1] = sPos[i3 + 1] / len
      sDirs[i3 + 2] = sPos[i3 + 2] / len
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(sPos.slice(), 3))
    const starMat = new THREE.PointsMaterial({ size: 0.009, color: 0xffffff, transparent: true, opacity: 0.45 })
    scene.add(new THREE.Points(starGeo, starMat))

    // ── Bloom post-processing ────────────────────────────────────────────────
    const composer  = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.5, 0.1)
    composer.addPass(bloomPass)

    // ── State refs ────────────────────────────────────────────────────────────
    const speedRef     = { current: 0.003  }
    const starSpeedRef = { current: 0.002  }
    const targetColor  = initColor.clone()
    const currentColor = initColor.clone()
    stateRef.current   = { speedRef, starSpeedRef, targetColor, currentColor, mesh, bloomPass, particleGeo, particleVels: pVels, particleMat, starGeo, starDirs: sDirs, starMat, renderer, scene }

    // ── Animation loop ────────────────────────────────────────────────────────
    let t = 0, raf: number
    const animate = () => {
      raf = requestAnimationFrame(animate)
      t  += 0.01

      // Mesh
      mesh.rotation.y += speedRef.current
      mesh.rotation.x += speedRef.current * 0.28 + Math.sin(t * 0.6) * 0.0002
      mesh.scale.setScalar(0.8 * (1 + Math.sin(t * 0.5) * 0.022))
      currentColor.lerp(targetColor, 0.04)
      ;(mesh.material as THREE.MeshBasicMaterial).color.copy(currentColor)

      // Ambient particles — drift + follow color
      const ppa = particleGeo.attributes.position as THREE.BufferAttribute
      const pca = particleGeo.attributes.color    as THREE.BufferAttribute
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3
        ppa.array[i3]     += pVels[i3]
        ppa.array[i3 + 1] += pVels[i3 + 1]
        ppa.array[i3 + 2] += pVels[i3 + 2]
        for (let j = 0; j < 3; j++) {
          if (Math.abs(ppa.array[i3 + j] as number) > 7) (ppa.array as Float32Array)[i3 + j] *= -0.98
        }
        pca.array[i3]     = pca.array[i3]     + (currentColor.r * 1.1 - pca.array[i3])     * 0.015
        pca.array[i3 + 1] = pca.array[i3 + 1] + (currentColor.g * 1.1 - pca.array[i3 + 1]) * 0.015
        pca.array[i3 + 2] = pca.array[i3 + 2] + (currentColor.b * 1.1 - pca.array[i3 + 2]) * 0.015
      }
      ppa.needsUpdate = true
      pca.needsUpdate = true

      // Warp star field — fly outward, reset when too far
      const spa = starGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < STAR_COUNT; i++) {
        const i3 = i * 3
        spa.array[i3]     = (spa.array[i3]     as number) + sDirs[i3]     * starSpeedRef.current
        spa.array[i3 + 1] = (spa.array[i3 + 1] as number) + sDirs[i3 + 1] * starSpeedRef.current
        spa.array[i3 + 2] = (spa.array[i3 + 2] as number) + sDirs[i3 + 2] * starSpeedRef.current
        const cx = spa.array[i3] as number, cy = spa.array[i3 + 1] as number, cz = spa.array[i3 + 2] as number
        if (cx * cx + cy * cy + cz * cz > 225) {
          // Reset to a new random near-center position
          const r   = 0.5 + Math.random() * 1.5
          const th  = Math.random() * Math.PI * 2
          const phi = Math.acos(2 * Math.random() - 1)
          spa.array[i3]     = r * Math.sin(phi) * Math.cos(th)
          spa.array[i3 + 1] = r * Math.sin(phi) * Math.sin(th)
          spa.array[i3 + 2] = r * Math.cos(phi)
          const len = Math.sqrt((spa.array[i3] as number) ** 2 + (spa.array[i3 + 1] as number) ** 2 + (spa.array[i3 + 2] as number) ** 2)
          sDirs[i3]     = (spa.array[i3]     as number) / len
          sDirs[i3 + 1] = (spa.array[i3 + 1] as number) / len
          sDirs[i3 + 2] = (spa.array[i3 + 2] as number) / len
        }
      }
      spa.needsUpdate = true

      composer.render()
    }
    animate()

    // Resize
    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth, nh = container.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
      composer.setSize(nw, nh)
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geometry.dispose(); material.dispose()
      particleGeo.dispose(); particleMat.dispose()
      starGeo.dispose(); starMat.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [shapeId])

  // ── Update PnL-driven values (no scene rebuild) ───────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    const norm    = maxAbsPnl > 0 ? Math.abs(pnl) / maxAbsPnl : 0.15
    const clamped = Math.max(0.04, Math.min(1, norm))

    // Speed
    s.speedRef.current    = 0.0006 + clamped * 0.0234
    // Star warp: nearly static at zero, streaking at max
    s.starSpeedRef.current = 0.001 + clamped * 0.09

    // Color — vivid on dark bg, saturated deep colors on light bg
    if (darkMode) {
      const brightness = 0.2 + clamped * 0.8
      if (pnl >= 0) {
        s.targetColor.setRGB(0, brightness * 0.85, brightness * 0.45)
      } else {
        s.targetColor.setRGB(brightness * 0.9, brightness * 0.06, 0)
      }
    } else {
      const b = 0.35 + clamped * 0.55   // 0.35–0.90
      if (pnl >= 0) {
        s.targetColor.setRGB(0, b * 0.72, b * 0.28)   // deep green
      } else {
        s.targetColor.setRGB(b * 0.85, 0, 0)           // deep red
      }
    }

    // Particle appearance per theme
    if (s.particleMat) {
      s.particleMat.size    = darkMode ? 0.0125 : 0.022
      s.particleMat.opacity = darkMode ? 0.65   : 0.9
    }
    if (s.starMat) {
      s.starMat.color.set(darkMode ? 0xffffff : 0x333333)
      s.starMat.size    = darkMode ? 0.009 : 0.014
      s.starMat.opacity = darkMode ? 0.45  : 0.7
    }

    // Background + fog color based on theme
    const bgColor = darkMode ? 0x000000 : 0xffffff
    s.renderer?.setClearColor(bgColor, 1)
    if (s.scene?.background) (s.scene.background as THREE.Color).set(bgColor)
    // Disable fog on light mode so the shape doesn't vanish into white
    if (s.scene?.fog) {
      (s.scene.fog as THREE.FogExp2).color.set(bgColor)
      ;(s.scene.fog as THREE.FogExp2).density = darkMode ? 0.1 : 0
    }

    // Glow: only meaningful on dark bg; near-zero on light
    s.bloomPass.strength = darkMode ? 0.02 + clamped * 0.33 : 0.01
  }, [pnl, maxAbsPnl, darkMode])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: darkMode ? '#000000' : '#ffffff' }}
    />
  )
}
