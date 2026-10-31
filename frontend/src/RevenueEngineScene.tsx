import { useEffect, useRef, type RefObject } from 'react'
import type * as ThreeTypes from 'three'
import revenueEngine from './assets/brightloop-revenue-engine.png'

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
      camera.position.set(0, 0.04, 6.7)
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
      engine.scale.setScalar(1.08)
      assembly.add(engine, orbitSystem)
      world.add(assembly)

      const coreGeometry = new three.IcosahedronGeometry(1.16, 2)
      const coreMaterial = new three.MeshPhysicalMaterial({
        color: 0x7772df,
        emissive: 0x39358c,
        emissiveIntensity: 0.44,
        metalness: 0.28,
        roughness: 0.23,
        clearcoat: 0.85,
        clearcoatRoughness: 0.18,
        flatShading: true,
      })
      const core = new three.Mesh(coreGeometry, coreMaterial)
      engine.add(core)

      const crystalGeometry = new three.IcosahedronGeometry(1.35, 1)
      const crystalShell = new three.Mesh(
        crystalGeometry,
        new three.MeshPhysicalMaterial({
          color: 0xbcb9ff,
          emissive: 0x332d7d,
          emissiveIntensity: 0.2,
          metalness: 0.72,
          roughness: 0.22,
          clearcoat: 1,
          clearcoatRoughness: 0.13,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: three.DoubleSide,
          flatShading: true,
        }),
      )
      engine.add(crystalShell)
      const crystalEdges = new three.LineSegments(
        new three.EdgesGeometry(crystalGeometry, 19),
        new three.LineBasicMaterial({ color: 0xe2e0ff, transparent: true, opacity: 0.28, depthWrite: false }),
      )
      engine.add(crystalEdges)

      const innerCore = new three.Mesh(
        new three.IcosahedronGeometry(0.69, 1),
        new three.MeshBasicMaterial({ color: 0xe0ddff, wireframe: true, transparent: true, opacity: 0.21 }),
      )
      innerCore.scale.set(1.02, 1.08, 0.96)
      engine.add(innerCore)

      const energyLoop = new three.Mesh(
        new three.TorusGeometry(0.48, 0.017, 12, 96),
        new three.MeshStandardMaterial({ color: 0xb6ffe7, emissive: 0x4fd6b1, emissiveIntensity: 0.85, metalness: 0.42, roughness: 0.2, transparent: true, opacity: 0.86 }),
      )
      energyLoop.rotation.set(1.08, 0.38, -0.2)
      engine.add(energyLoop)

      const ringMaterials = [
        new three.MeshStandardMaterial({ color: 0xaaa4ff, emissive: 0x6962d4, emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.28, transparent: true, opacity: 0.82 }),
        new three.MeshStandardMaterial({ color: 0x8edbc9, emissive: 0x378e7c, emissiveIntensity: 0.48, metalness: 0.4, roughness: 0.32, transparent: true, opacity: 0.74 }),
        new three.MeshStandardMaterial({ color: 0xc5a8ef, emissive: 0x7857b9, emissiveIntensity: 0.42, metalness: 0.35, roughness: 0.3, transparent: true, opacity: 0.68 }),
      ]
      const ringRotations: [number, number, number][] = [[1.08, 0.18, -0.34], [0.31, 1.14, 0.58], [0.75, -0.72, 1.18]]
      ringRotations.forEach((rotation, index) => {
        const ring = new three.Mesh(new three.TorusGeometry(1.72 + index * 0.18, 0.014, 8, 180), ringMaterials[index])
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

      const particlePositions = new Float32Array(180 * 3)
      for (let i = 0; i < 180; i += 1) {
        const radius = 2.45 + ((i * 37) % 100) / 100 * 1.4
        const theta = i * 2.399963
        const phi = Math.acos(1 - 2 * ((i * 29) % 180) / 180)
        particlePositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
        particlePositions[i * 3 + 1] = radius * Math.cos(phi)
        particlePositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
      }
      const particleGeometry = new three.BufferGeometry()
      particleGeometry.setAttribute('position', new three.BufferAttribute(particlePositions, 3))
      const particles = new three.Points(particleGeometry, new three.PointsMaterial({ color: 0x9e9ae5, size: 0.018, transparent: true, opacity: 0.54, sizeAttenuation: true }))
      world.add(particles)

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
        particles.rotation.y += ((reduced ? 0 : progress * 0.4) - particles.rotation.y) * 0.025

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
        const targetZ = 6.7 - Math.sin(progress * Math.PI) * 0.3
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
    <img className="revenue-engine-fallback" src={revenueEngine} alt="Luminous violet and mint revenue engine" />
    <div className="revenue-engine-vignette" aria-hidden="true" />
  </div>
}

const chaptersPositions: [number, number, number][] = [
  [-1.92, 0.62, 0.08], [-0.75, 1.66, 0.23], [1.25, 1.22, -0.2],
  [1.88, -0.48, 0.16], [0.08, -1.82, -0.28], [-1.52, -1.12, 0.18],
]
