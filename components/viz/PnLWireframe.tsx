'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface PnLWireframeProps {
  pnl: number
  maxAbsPnl: number
  shapeId?: string
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

export function PnLWireframe({ pnl, maxAbsPnl, shapeId = 'torus-knot-2-3' }: PnLWireframeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{
    speedRef: { current: number }
    targetColor: THREE.Color
    currentColor: THREE.Color
    mesh: THREE.Mesh
  } | null>(null)

  // Init Three.js scene once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth
    const h = container.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100)
    camera.position.z = 3.8

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const geometry = buildGeometry(shapeId)
    const initColor = new THREE.Color(0.0, 0.6, 0.35)
    const material = new THREE.MeshBasicMaterial({ wireframe: true, color: initColor })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const speedRef = { current: 0.003 }
    const targetColor = initColor.clone()
    const currentColor = initColor.clone()

    stateRef.current = { speedRef, targetColor, currentColor, mesh }

    let raf: number
    const animate = () => {
      raf = requestAnimationFrame(animate)
      mesh.rotation.y += speedRef.current
      mesh.rotation.x += speedRef.current * 0.28
      // Smoothly interpolate towards target color
      currentColor.lerp(targetColor, 0.04)
      ;(mesh.material as THREE.MeshBasicMaterial).color.copy(currentColor)
      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      stateRef.current = null
    }
  }, [shapeId])

  // Update speed + color when PnL changes (no scene rebuild)
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    const norm = maxAbsPnl > 0 ? Math.abs(pnl) / maxAbsPnl : 0.15
    const clamped = Math.max(0.04, Math.min(1, norm))

    // Rotation speed: near-zero PnL → very slow (0.0006), max PnL → fast (0.024)
    s.speedRef.current = 0.0006 + clamped * 0.0234

    // Brightness: dim (0.2) near zero → vivid (1.0) at max
    const brightness = 0.2 + clamped * 0.8

    if (pnl >= 0) {
      // Green family: (0, G, G*0.45)
      s.targetColor.setRGB(0, brightness * 0.85, brightness * 0.45)
    } else {
      // Red family: (R, very-little-green, 0)
      s.targetColor.setRGB(brightness * 0.9, brightness * 0.06, 0)
    }
  }, [pnl, maxAbsPnl])

  return <div ref={containerRef} className="w-full h-full" />
}
