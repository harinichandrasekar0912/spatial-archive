import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyAppearance, setModelOpacity } from './modelStyle.js'

const FOV = 35
// The first view: a little to the right of the front and from above, like a model on a table.
const AZIMUTH = 32 * (Math.PI / 180)
const ELEVATION = 26 * (Math.PI / 180)

/*
 * Inspector for a 3D model inside the focus view. The workspace lends the model's own object
 * while the focus view is open (nothing is loaded twice); this small scene has the same light
 * as the workspace and orbits with OrbitControls. It is drawn from the app's single frame
 * loop (workspace → focus view → frame); its WebGL context exists only while it is open.
 */
export function createModelViewer(container, model) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 0)

  const canvas = renderer.domElement
  canvas.setAttribute('aria-label', 'Drag to orbit, right-drag to pan, scroll to zoom')
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  const sky = new THREE.HemisphereLight(0xffffff, 0x1c1c1b, 1.15)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(-4, 9, 7)
  const holder = new THREE.Group()
  scene.add(sky, sun, holder)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.rotateSpeed = 0.75
  controls.screenSpacePanning = true

  let width = 0
  let height = 0
  let framed = false

  // The closest view (from the first-view direction) that shows every corner of the model's box.
  function frameModel() {
    const box = new THREE.Box3().setFromObject(holder)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length() || 1
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
    const direction = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION))
    const projected = new THREE.Vector3()
    let near = size * 0.05
    let far = size * 20

    camera.near = size / 1000
    camera.far = size * 100
    camera.updateProjectionMatrix()

    for (let step = 0; step < 28; step += 1) {
      const distance = (near + far) / 2
      camera.position.copy(center).addScaledVector(direction, distance)
      camera.lookAt(center)
      camera.updateMatrixWorld()
      const fits = corners.every((corner) => {
        projected.copy(corner).project(camera)
        return projected.z < 1 && Math.abs(projected.x) < 0.84 && Math.abs(projected.y) < 0.8
      })

      if (fits) {
        far = distance
      } else {
        near = distance
      }
    }

    camera.position.copy(center).addScaledVector(direction, far)
    controls.target.copy(center)
    controls.minDistance = size * 0.05
    controls.maxDistance = far * 4
    controls.update()
  }

  if (model) {
    setModelOpacity(model, 1)
    holder.add(model.pivot)
  }

  return {
    setAppearance(appearance) {
      if (model) {
        applyAppearance(model, appearance)
      }
    },

    frame() {
      // clientWidth / clientHeight ignore the focus view's opening transform.
      if (container.clientWidth !== width || container.clientHeight !== height) {
        width = container.clientWidth
        height = container.clientHeight
        renderer.setSize(width, height, false)
        camera.aspect = width / Math.max(1, height)
        camera.updateProjectionMatrix()
      }

      // Framed once the stage has its size (the view depends on its proportions).
      if (model && !framed && width > 0 && height > 0) {
        frameModel()
        framed = true
      }

      controls.update()
      renderer.render(scene, camera)
    },

    // Returns the lent object to the workspace (the caller re-attaches it).
    dispose() {
      controls.dispose()

      if (model) {
        holder.remove(model.pivot)
      }

      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
