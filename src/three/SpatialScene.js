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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function easeInOutCubic(value) {
  if (value < 0.5) {
    return 4 * value * value * value
  }

  return 1 - Math.pow(-2 * value + 2, 3) / 2
}

export function initSpatialScene(sceneState = {}) {
  const mount = document.querySelector('[data-spatial-scene]')

  if (!mount || mount.dataset.initialized === 'true') {
    return null
  }

  mount.dataset.initialized = 'true'

  const debugMode = Boolean(window.__SPATIAL_DEBUG__ === true)
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
  scene.fog = new THREE.Fog(0xf5f4f0, 24, 120)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
  const startDepth = Number(sceneState.cameraZ ?? 0)
  camera.position.set(0, 0, startDepth)
  camera.lookAt(0, 0, -1)

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const transitionState = {
    isTransitioning: false,
    reducedMotion,
    currentDepth: startDepth,
    fromDepth: startDepth,
    targetDepth: startDepth,
    startTime: 0,
    duration: reducedMotion ? 900 : 1500,
  }

  const { layers, layerDepths } = buildDotField({ layers: 7, debugMode })
  const layeringSpacing = 8
  const layerMeshes = layers.map(({ positions, colors, opacity, size, depth: localDepth }) => {
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
    dots.position.z = localDepth - localDepth
    scene.add(dots)

    return {
      geometry,
      material,
      dots,
      localDepth,
      depth: localDepth,
    }
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

  let controller

  const handleDebugTravel = (event) => {
    if (event.key?.toLowerCase() !== 't') {
      return
    }

    controller?.startEntryTransition({
      targetZ: camera.position.z - 16,
      duration: reducedMotion ? 800 : 1500,
    })
  }

  controller = {
    getCameraDepth() {
      return camera.position.z
    },
    startEntryTransition({ targetZ = transitionState.targetDepth, duration = transitionState.duration } = {}) {
      const nextTarget = Number(targetZ)

      if (!Number.isFinite(nextTarget) || Math.abs(camera.position.z - nextTarget) < 0.05) {
        return
      }

      transitionState.fromDepth = camera.position.z
      transitionState.targetDepth = nextTarget
      transitionState.startTime = performance.now()
      transitionState.duration = Math.max(500, Number(duration) || transitionState.duration)
      transitionState.isTransitioning = true
    },
    destroy() {
      window.removeEventListener('resize', resize)
      document.removeEventListener('keydown', handleDebugTravel)

      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      layerMeshes.forEach(({ geometry, material }) => {
        geometry.dispose()
        material.dispose()
      })

      sceneState.cameraZ = camera.position.z
      renderer.dispose()
    },
  }

  resize()
  window.addEventListener('resize', resize)
  document.addEventListener('keydown', handleDebugTravel)

  const animate = () => {
    const elapsed = clock.getElapsedTime()

    if (transitionState.isTransitioning) {
      const elapsedMs = performance.now() - transitionState.startTime
      const progress = clamp(elapsedMs / transitionState.duration, 0, 1)
      const eased = easeInOutCubic(progress)

      transitionState.currentDepth = THREE.MathUtils.lerp(transitionState.fromDepth, transitionState.targetDepth, eased)
      camera.position.z = transitionState.currentDepth

      if (progress >= 1) {
        transitionState.isTransitioning = false
        transitionState.currentDepth = transitionState.targetDepth
      }
    }

    const farthestDepth = Math.min(...layerMeshes.map((layer) => layer.depth))

    layerMeshes.forEach((layer) => {
      if (layer.depth > camera.position.z + 4) {
        const nextDepth = farthestDepth - layeringSpacing

        layer.depth = nextDepth
        layer.dots.position.z = layer.depth - layer.localDepth
      }
    })

    cameraRig.update(elapsed)
    renderer.render(scene, camera)

    animationFrameId = requestAnimationFrame(animate)
  }

  animate()

  console.info('SpatialScene ready', {
    dotPlanes: layerDepths.length,
    cameraZ: startDepth,
    debugMode,
  })

  return controller
}
