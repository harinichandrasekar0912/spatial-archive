import * as THREE from 'three'
import { buildDotField } from './DotField.js'
import { createCameraRig } from './CameraRig.js'

export function SpatialScene() {
  return `
    <div class="spatial-scene" data-spatial-scene aria-label="Spatial archive scene">
      <div class="scene-glow"></div>
    </div>
  `
}

export function initSpatialScene() {
  const mount = document.querySelector('[data-spatial-scene]')

  if (!mount || mount.dataset.initialized === 'true') {
    return null
  }

  mount.dataset.initialized = 'true'

  const canvas = document.createElement('canvas')
  canvas.className = 'spatial-canvas'
  mount.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xf5f4f0, 25, 90)

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 150)
  camera.position.set(0, 0, 24)

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const transitionState = {
    isTransitioning: false,
    entryProgress: 0,
    reducedMotion,
  }

  const { layers } = buildDotField()
  const layerMeshes = layers.map(({ positions, colors, opacity, size }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size,
      transparent: true,
      opacity,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true,
    })

    const dots = new THREE.Points(geometry, material)
    scene.add(dots)

    return { geometry, material, dots }
  })

  const cameraRig = createCameraRig(camera, transitionState)
  const clock = new THREE.Clock()
  let animationFrameId = null

  const resize = () => {
    const { width, height } = mount.getBoundingClientRect()

    renderer.setSize(width, height, false)
    camera.aspect = width / (height || 1)
    camera.updateProjectionMatrix()
  }

  const controller = {
    startEntryTransition() {
      if (transitionState.isTransitioning || transitionState.entryProgress > 0) {
        return
      }

      transitionState.isTransitioning = true
      transitionState.entryProgress = 0
    },
    destroy() {
      window.removeEventListener('resize', resize)

      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      layerMeshes.forEach(({ geometry, material }) => {
        geometry.dispose()
        material.dispose()
      })

      renderer.dispose()
    },
  }

  resize()
  window.addEventListener('resize', resize)

  const animate = () => {
    const elapsed = clock.getElapsedTime()

    if (transitionState.isTransitioning) {
      transitionState.entryProgress = Math.min(1, transitionState.entryProgress + (transitionState.reducedMotion ? 0.08 : 0.018))

      if (transitionState.entryProgress >= 1) {
        transitionState.isTransitioning = false
      }
    }

    cameraRig.update(elapsed)
    renderer.render(scene, camera)

    animationFrameId = requestAnimationFrame(animate)
  }

  animate()

  return controller
}
