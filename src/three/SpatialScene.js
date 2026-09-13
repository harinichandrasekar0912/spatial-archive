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

export function initSpatialScene(root = document.querySelector('#spatial-root'), sceneState = {}) {
  const mount = root

  if (!mount || mount.dataset.initialized === 'true') {
    return null
  }

  mount.dataset.initialized = 'true'

  const debugMode = true

  const sceneShell = document.createElement('div')
  sceneShell.className = 'spatial-scene'
  sceneShell.dataset.spatialScene = 'true'
  sceneShell.setAttribute('aria-label', 'Spatial archive scene')

  const sceneGlow = document.createElement('div')
  sceneGlow.className = 'scene-glow'

  const canvas = document.createElement('canvas')
  canvas.className = 'spatial-canvas'

  sceneShell.append(sceneGlow, canvas)
  mount.appendChild(sceneShell)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const scene = new THREE.Scene()
  scene.fog = null

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
    onProgress: null,
    onComplete: null,
    targetYaw: 0,
    targetPitch: 0,
    ambientStrength: 1,
    ambientStrengthTarget: 1,
    maxYaw: 0.012,
    maxPitch: 0.002,
    ambientSpeed: 0.38,
    ambientPitchSpeed: 0.22,
    recenterDuration: reducedMotion ? 260 : 600,
    microSettle: reducedMotion ? 30 : 100,
  }
  const introState = {
    startedAt: performance.now(),
    duration: reducedMotion ? 420 : 1100,
  }

  const { layers } = buildDotField({ layers: 8, spread: 60, step: 1.25, debugMode })
  const layeringSpacing = 10
  const layerMeshes = layers
    .map(({ positions, colors, opacity, size, depth: localDepth }) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

      const material = new THREE.PointsMaterial({
        size,
        color: 0x666666,
        transparent: true,
        opacity,
        vertexColors: false,
        depthWrite: false,
        sizeAttenuation: true,
      })

      const dots = new THREE.Points(geometry, material)
      dots.position.z = localDepth
      scene.add(dots)

      return {
        geometry,
        material,
        dots,
        depth: localDepth,
        baseOpacity: opacity,
        baseSize: size,
      }
    })
    .sort((a, b) => a.depth - b.depth)

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

  controller = {
    getCameraDepth() {
      return camera.position.z
    },
    startEntryTransition({ targetZ = transitionState.targetDepth, duration = transitionState.duration, onProgress, onComplete } = {}) {
      const nextTarget = Number(targetZ)

      if (!Number.isFinite(nextTarget)) {
        return
      }

      transitionState.fromDepth = camera.position.z
      transitionState.targetDepth = nextTarget
      transitionState.targetYaw = 0
      transitionState.targetPitch = 0
      transitionState.startTime = performance.now()
      transitionState.duration = Math.max(500, Number(duration) || transitionState.duration)
      transitionState.onProgress = typeof onProgress === 'function' ? onProgress : null
      transitionState.onComplete = typeof onComplete === 'function' ? onComplete : null
      transitionState.recenterDuration = transitionState.reducedMotion ? 260 : 600
      transitionState.microSettle = transitionState.reducedMotion ? 30 : 100
      transitionState.ambientStrengthTarget = nextTarget >= 0 ? 1 : 0
      transitionState.isTransitioning = true
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

      sceneState.cameraZ = camera.position.z
      renderer.dispose()
    },
  }

  resize()
  window.addEventListener('resize', resize)

  const animate = () => {
    const elapsed = clock.getElapsedTime()

    if (transitionState.isTransitioning) {
      const now = performance.now()
      const totalTransitionDuration = transitionState.duration + transitionState.recenterDuration + transitionState.microSettle
      const overallProgress = clamp((now - transitionState.startTime) / totalTransitionDuration, 0, 1)
      const recenterEndTime = transitionState.startTime + transitionState.recenterDuration
      const travelStartTime = recenterEndTime + transitionState.microSettle
      const travelProgress = clamp((now - travelStartTime) / transitionState.duration, 0, 1)

      if (transitionState.targetDepth >= 0 && now >= travelStartTime + transitionState.duration) {
        transitionState.ambientStrengthTarget = 1
      }

      transitionState.ambientStrength = THREE.MathUtils.lerp(
        transitionState.ambientStrength,
        transitionState.ambientStrengthTarget,
        0.06,
      )

      if (now < travelStartTime) {
        transitionState.currentDepth = transitionState.fromDepth
      } else {
        const eased = easeInOutCubic(travelProgress)
        transitionState.currentDepth = THREE.MathUtils.lerp(transitionState.fromDepth, transitionState.targetDepth, eased)
      }

      camera.position.z = transitionState.currentDepth
      transitionState.onProgress?.(overallProgress)

      if (overallProgress >= 1) {
        transitionState.isTransitioning = false
        transitionState.currentDepth = transitionState.targetDepth
        transitionState.ambientStrength = transitionState.ambientStrengthTarget
        transitionState.onProgress?.(1)
        transitionState.onComplete?.()
      }
    }

    const orderedLayers = [...layerMeshes].sort((a, b) => a.depth - b.depth)
    const farthestDepth = orderedLayers[0]?.depth ?? 0
    const shiftThreshold = camera.position.z + 6
    let nextDepth = farthestDepth - layeringSpacing

    const introProgress = clamp((performance.now() - introState.startedAt) / introState.duration, 0, 1)
    const introFade = easeInOutCubic(introProgress)

    for (let index = orderedLayers.length - 1; index >= 0; index -= 1) {
      const layer = orderedLayers[index]

      if (layer.depth > shiftThreshold) {
        layer.depth = nextDepth
        layer.dots.position.z = nextDepth
        nextDepth -= layeringSpacing
      }

      const fadeStrength = reducedMotion ? 1 : introFade

      layer.material.opacity = clamp(layer.baseOpacity * fadeStrength, 0.02, layer.baseOpacity)
      layer.material.size = layer.baseSize
    }

    cameraRig.update(elapsed)
    renderer.render(scene, camera)

    animationFrameId = requestAnimationFrame(animate)
  }

  animate()

  return controller
}
