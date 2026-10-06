import * as THREE from 'three'
import { CAMERA } from '../app/constants.js'
import { createCameraRig } from './CameraRig.js'
import { createDotField } from './DotField.js'

/*
 * The one persistent Three.js environment. The renderer, camera, scene and dot field are
 * created once and live for the whole session. This module also owns the app's single
 * requestAnimationFrame loop: UI controllers register frame hooks instead of running loops
 * of their own, so camera, DOM and WebGL always update from the same timestamp.
 */
export function createSpatialScene(mount, { startZ = 0 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'spatial-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  mount.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // No tone mapping: white dots and card colours are shown exactly as specified.
  renderer.toneMapping = THREE.NoToneMapping

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
  camera.position.set(0, 0, startZ)
  camera.updateMatrixWorld()

  const rig = createCameraRig(camera)
  const dotField = createDotField(scene)
  const hooks = []
  // Screen-space layers drawn after the 3D scene (the transition dust).
  const overlays = []
  const viewport = { width: 1, height: 1 }
  let overlayWasActive = false

  const lastMatrix = new Float64Array(16)
  let lastDotKey = ''
  let forceRender = true
  let frameId = null

  function resize() {
    viewport.width = window.innerWidth
    viewport.height = window.innerHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CAMERA.maxPixelRatio))
    renderer.setSize(viewport.width, viewport.height, false)
    dotField.setPixelScale(renderer.getPixelRatio() * viewport.height * 0.5)
    dotField.setViewport(viewport.width, viewport.height)
    camera.aspect = viewport.width / Math.max(1, viewport.height)
    camera.updateProjectionMatrix()
    forceRender = true
  }

  // Skip the WebGL draw when neither the camera nor the dot field changed (idle Projects/Workspace).
  function needsRender() {
    const elements = camera.matrixWorld.elements
    let changed = forceRender

    for (let index = 0; index < 16; index += 1) {
      if (elements[index] !== lastMatrix[index]) {
        lastMatrix[index] = elements[index]
        changed = true
      }
    }

    const dotKey = dotField.stateKey()

    if (dotKey !== lastDotKey) {
      lastDotKey = dotKey
      changed = true
    }

    forceRender = false
    return changed
  }

  function frame() {
    // Schedule first so an exception in one hook cannot stop the loop.
    frameId = requestAnimationFrame(frame)
    renderFrame()
  }

  // One frame of the loop: hooks, dot field, draw (also used to drive frames in tests).
  function renderFrame() {
    // One clock for everything: animations record their start times with performance.now().
    const now = performance.now()

    for (const hook of hooks) {
      hook(now)
    }

    dotField.update(camera)

    const overlayActive = overlays.some((overlay) => overlay.isActive())

    // An active overlay redraws every frame; one more frame after it ends clears it away.
    if (needsRender() || overlayActive || overlayWasActive) {
      renderer.render(scene, camera)

      if (overlayActive) {
        renderer.autoClear = false
        overlays.forEach((overlay) => overlay.isActive() && overlay.render(renderer))
        renderer.autoClear = true
      }
    }

    overlayWasActive = overlayActive
  }

  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault())
  canvas.addEventListener('webglcontextrestored', () => {
    forceRender = true
  })

  window.addEventListener('resize', resize)
  resize()

  return {
    camera,
    rig,
    dotField,
    viewport,
    // The Three.js scene graph and renderer, so the workspace can place cards in the same space.
    world: scene,
    renderer,
    onFrame(hook) {
      hooks.push(hook)
    },
    requestRender() {
      forceRender = true
    },
    renderFrame,
    addOverlay(overlay) {
      overlays.push(overlay)
    },
    /*
     * A copy of the current 3D frame (device pixels) for the dust effects. The scene is drawn
     * and copied in the same task, while the drawing buffer is still intact.
     */
    captureFrame() {
      dotField.update(camera)
      renderer.render(scene, camera)
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      copy.getContext('2d').drawImage(canvas, 0, 0)
      forceRender = true
      return copy
    },
    start() {
      if (frameId === null) {
        frameId = requestAnimationFrame(frame)
      }
    },
  }
}
