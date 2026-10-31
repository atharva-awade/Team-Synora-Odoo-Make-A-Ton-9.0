import { useEffect, useRef, type RefObject } from 'react'
import type * as ThreeTypes from 'three'

type RevenueEngineSceneProps = {
  activeIndex: number
  scrollSource: RefObject<HTMLElement | null>
}

const chapterColors = [0x7d76ee, 0x51bda6, 0x9a7be3, 0x59aeca, 0xd7a755, 0x8274dd]

export default function RevenueEngineScene({ activeIndex, scrollSource }: RevenueEngineSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(activeIndex)

  useEffect(() => { activeRef.current = activeIndex }, [activeIndex])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let renderer: ThreeTypes.WebGLRenderer | undefined
    let scene: ThreeTypes.Scene | undefined
    let drawFrame: ((now: number) => void) | undefined
    let frame = 0
    let observer: ResizeObserver | undefined
    let contextLost = false
    let initializeVersion = 0

    const clearCanvas = () => {
      observer?.disconnect()
      observer = undefined
      scene?.traverse((object) => {
        const renderable = object as ThreeTypes.Mesh | ThreeTypes.Points | ThreeTypes.LineSegments
        if (renderable.geometry) {
          renderable.geometry.dispose()
          const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
          materials.forEach((material) => material.dispose())
        }
      })
      scene = undefined
      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
        renderer = undefined
      }
      drawFrame = undefined
      host.classList.remove('webgl-ready')
    }

    const initialize = async () => {
      const version = ++initializeVersion
      cancelAnimationFrame(frame)
      contextLost = false
      clearCanvas()
      if (motionPreference.matches) return

      let three: typeof import('three')
      try {
        three = await import('three')
        if (version !== initializeVersion || motionPreference.matches) return
        renderer = new three.WebGLRenderer({ alpha: true, antialias: window.innerWidth > 760, powerPreference: 'low-power' })
      } catch {
        if (version === initializeVersion) clearCanvas()
        return
      }

      const canvas = renderer.domElement
      canvas.setAttribute('aria-hidden', 'true')
      canvas.className = 'revenue-engine-canvas'
      host.appendChild(canvas)
      host.classList.add('webgl-ready')
      renderer.outputColorSpace = three.SRGBColorSpace
      renderer.toneMapping = three.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.12
      renderer.setClearColor(0x000000, 0)

      const world = new three.Scene()
      scene = world
      const camera = new three.PerspectiveCamera(34, 1, 0.1, 40)
      camera.position.set(0, 0.04, 8.1)
      camera.lookAt(0, 0, 0)
      world.add(new three.HemisphereLight(0xffffff, 0xc9c8e5, 2.05))

      const keyLight = new three.PointLight(0xa9a4ff, 48, 15, 2)
      keyLight.position.set(-3.2, 3.8, 4.5)
      world.add(keyLight)
      const mintLight = new three.PointLight(0x79e0c6, 22, 12, 2)
      mintLight.position.set(3.4, -2.2, 1.4)
      world.add(mintLight)

      const assembly = new three.Group()
      const engine = new three.Group()
      const orbitSystem = new three.Group()
      engine.scale.setScalar(1)
      orbitSystem.scale.setScalar(0.93)
      assembly.add(engine, orbitSystem)
      world.add(assembly)

      const coreGeometry = new three.IcosahedronGeometry(1.12, 2)
      const coreMaterial = new three.MeshPhysicalMaterial({
        color: 0x7772df,
        emissive: 0x39358c,
        emissiveIntensity: 0.28,
        metalness: 0.28,
        roughness: 0.27,
        clearcoat: 0.92,
        clearcoatRoughness: 0.16,
        flatShading: false,
      })
      const core = new three.Mesh(coreGeometry, coreMaterial)
      engine.add(core)

      const energyLoop = new three.Mesh(
        new three.TorusGeometry(0.48, 0.017, 12, 96),
        new three.MeshStandardMaterial({ color: 0xb6ffe7, emissive: 0x4fd6b1, emissiveIntensity: 0.58, metalness: 0.5, roughness: 0.22, transparent: true, opacity: 0.76 }),
      )
      energyLoop.rotation.set(1.08, 0.38, -0.2)
      engine.add(energyLoop)

      const ringMaterials = [
        new three.MeshStandardMaterial({ color: 0xaaa4ff, emissive: 0x6962d4, emissiveIntensity: 0.32, metalness: 0.62, roughness: 0.26, transparent: true, opacity: 0.62 }),
        new three.MeshStandardMaterial({ color: 0x8edbc9, emissive: 0x378e7c, emissiveIntensity: 0.28, metalness: 0.56, roughness: 0.3, transparent: true, opacity: 0.56 }),
        new three.MeshStandardMaterial({ color: 0xc5a8ef, emissive: 0x7857b9, emissiveIntensity: 0.24, metalness: 0.52, roughness: 0.29, transparent: true, opacity: 0.52 }),
      ]
      const ringRotations: [number, number, number][] = [[1.08, 0.18, -0.34], [0.31, 1.14, 0.58], [0.75, -0.72, 1.18]]
      ringRotations.forEach((rotation, index) => {
        const ring = new three.Mesh(new three.TorusGeometry(1.68 + index * 0.15, 0.011, 10, 180), ringMaterials[index])
        ring.rotation.set(...rotation)
        orbitSystem.add(ring)
      })

      const nodes: ThreeTypes.Mesh[] = []
      chaptersPositions.forEach((position, index) => {
        const node = new three.Mesh(
          new three.SphereGeometry(0.105, 24, 16),
          new three.MeshStandardMaterial({
            color: chapterColors[index],
            emissive: chapterColors[index],
            emissiveIntensity: 0.26,
            metalness: 0.15,
            roughness: 0.2,
          }),
        )
        node.position.set(...position)
        const halo = new three.Mesh(
          new three.SphereGeometry(0.17, 20, 12),
          new three.MeshBasicMaterial({ color: chapterColors[index], transparent: true, opacity: 0.12 }),
        )
        node.add(halo)
        orbitSystem.add(node)
        nodes.push(node)
      })

      const resize = () => {
        if (!renderer) return
        const { width, height } = host.getBoundingClientRect()
        if (width <= 0 || height <= 0) return
        const mobile = window.innerWidth <= 760
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5))
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.fov = mobile ? 38 : 34
        camera.updateProjectionMatrix()
      }
      observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()

      const startedAt = performance.now()
      const onContextLost = (event: Event) => {
        event.preventDefault()
        contextLost = true
        cancelAnimationFrame(frame)
        clearCanvas()
      }
      canvas.addEventListener('webglcontextlost', onContextLost, { once: true })

      const render = (now: number) => {
        if (!renderer || contextLost) return
        const seconds = (now - startedAt) * 0.001
        const reduced = motionPreference.matches
        const source = scrollSource.current
        const rect = source?.getBoundingClientRect()
        const scrollable = rect ? Math.max(1, rect.height - window.innerHeight) : 1
        const progress = rect ? three.MathUtils.clamp((window.innerHeight * 0.34 - rect.top) / scrollable, 0, 1) : 0
        const active = Math.min(chapterColors.length - 1, Math.max(0, activeRef.current))
        const drift = reduced ? 0 : seconds * 0.1
        const scrollTurn = progress * Math.PI * 1.4

        assembly.position.y += ((reduced ? 0 : Math.sin(seconds * 0.58) * 0.1) - assembly.position.y) * 0.025
        assembly.rotation.z += ((reduced ? 0 : Math.sin(seconds * 0.24) * 0.025) - assembly.rotation.z) * 0.025
        engine.rotation.y += ((reduced ? 0 : drift * 0.28 + scrollTurn * 0.27) - engine.rotation.y) * 0.035
        engine.rotation.x += ((reduced ? 0.04 : Math.sin(seconds * 0.28) * 0.09 + (progress - 0.5) * 0.17) - engine.rotation.x) * 0.035
        energyLoop.rotation.y += ((reduced ? 0.2 : seconds * 0.18 + scrollTurn * 0.72) - energyLoop.rotation.y) * 0.035
        orbitSystem.rotation.y += ((reduced ? 0 : drift * 0.44 + scrollTurn) - orbitSystem.rotation.y) * 0.04
        orbitSystem.rotation.x += ((reduced ? 0.08 : 0.08 + Math.sin(scrollTurn * 0.7) * 0.11) - orbitSystem.rotation.x) * 0.04
        nodes.forEach((node, index) => {
          const material = node.material as ThreeTypes.MeshStandardMaterial
          const highlighted = index === active
          const targetScale = highlighted ? 1.42 : 0.78
          node.scale.x += (targetScale - node.scale.x) * 0.09
          node.scale.y = node.scale.x
          node.scale.z = node.scale.x
          material.emissiveIntensity += ((highlighted ? 1.15 : 0.23) - material.emissiveIntensity) * 0.12
        })

        const cameraAngle = progress * Math.PI * 1.15
        const targetX = reduced ? 0 : Math.sin(cameraAngle) * 0.34
        const targetY = reduced ? 0.04 : Math.cos(cameraAngle * 0.8) * 0.15
        const targetZ = 8.1 - Math.sin(progress * Math.PI) * 0.12
        camera.position.x += (targetX - camera.position.x) * 0.028
        camera.position.y += (targetY - camera.position.y) * 0.028
        camera.position.z += (targetZ - camera.position.z) * 0.028
        camera.lookAt(0, 0, 0)

        renderer.render(world, camera)
        frame = requestAnimationFrame(render)
      }
      drawFrame = render
      frame = requestAnimationFrame(render)
    }

    const onMotionChange = () => { void initialize() }
    const onVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(frame)
      else if (renderer && drawFrame && !contextLost) frame = requestAnimationFrame(drawFrame)
    }
    motionPreference.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void initialize()

    return () => {
      motionPreference.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      initializeVersion += 1
      cancelAnimationFrame(frame)
      observer?.disconnect()
      clearCanvas()
    }
  }, [scrollSource])

  return <div className="revenue-engine-renderer" ref={hostRef}>
    <svg className="revenue-engine-fallback" viewBox="0 0 600 600" role="img" aria-label="Brightloop revenue engine with a violet core and three feature orbits">
      <defs>
        <radialGradient id="engineCore" cx="35%" cy="28%" r="76%">
          <stop offset="0%" stopColor="#c4c0ff" />
          <stop offset="36%" stopColor="#817bea" />
          <stop offset="78%" stopColor="#5752c4" />
          <stop offset="100%" stopColor="#39388e" />
        </radialGradient>
        <radialGradient id="engineHighlight" cx="35%" cy="22%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".58" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="engineShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <ellipse cx="300" cy="440" rx="106" ry="18" fill="#615bca" opacity=".13" filter="url(#engineShadow)" />
      <g fill="none" strokeLinecap="round">
        <ellipse cx="300" cy="300" rx="220" ry="82" transform="rotate(-35 300 300)" stroke="#8d85ed" strokeWidth="5" opacity=".58" />
        <ellipse cx="300" cy="300" rx="218" ry="80" transform="rotate(34 300 300)" stroke="#76cbb8" strokeWidth="4" opacity=".52" />
        <ellipse cx="300" cy="300" rx="205" ry="74" transform="rotate(74 300 300)" stroke="#ad95df" strokeWidth="3" opacity=".42" />
      </g>
      <circle cx="300" cy="300" r="112" fill="url(#engineCore)" />
      <circle cx="300" cy="300" r="112" fill="url(#engineHighlight)" />
      <circle cx="300" cy="300" r="112" fill="none" stroke="#d7d3ff" strokeOpacity=".48" strokeWidth="1.5" />
      <g stroke="#ffffff" strokeOpacity=".5" strokeWidth="1.5">
        <path d="M257 223c25-18 57-24 82-17" fill="none" strokeLinecap="round" />
        <path d="M217 322c15 43 51 75 92 85" fill="none" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="133" cy="182" r="13" fill="#72cdb8" />
        <circle cx="475" cy="190" r="12" fill="#9d86df" />
        <circle cx="480" cy="402" r="13" fill="#72cdb8" />
        <circle cx="320" cy="522" r="12" fill="#d9b766" />
        <circle cx="116" cy="404" r="11" fill="#aaa0ed" />
        <circle cx="316" cy="76" r="12" fill="#78caba" />
      </g>
      <g fill="#ffffff" opacity=".8">
        <circle cx="128" cy="177" r="2.7" />
        <circle cx="470" cy="186" r="2.5" />
        <circle cx="475" cy="397" r="2.7" />
        <circle cx="315" cy="518" r="2.5" />
        <circle cx="112" cy="400" r="2.3" />
        <circle cx="311" cy="72" r="2.5" />
      </g>
    </svg>
  </div>
}

const chaptersPositions: [number, number, number][] = [
  [-1.92, 0.62, 0.08], [-0.75, 1.66, 0.23], [1.25, 1.22, -0.2],
  [1.88, -0.48, 0.16], [0.08, -1.82, -0.28], [-1.52, -1.12, 0.18],
]
