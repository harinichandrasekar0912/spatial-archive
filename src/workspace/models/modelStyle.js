import * as THREE from 'three'
import { MODEL } from '../../app/constants.js'
import { featureEdgePositions } from './edges.js'

/*
 * Normalising and styling loaded models.
 *   - The model is centred on its bounding box inside a pivot group, so it turns and scales
 *     about its middle and can be positioned like a card.
 *   - "white": an architectural white model (off-white surfaces + fine dark edges), which sits
 *     calmly among drawings and photographs; "original": the file's own materials.
 */

const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'specularMap', 'lightMap']

const materialsOf = (material) => (Array.isArray(material) ? material : [material]).filter(Boolean)

// ── Edge lines, worked out in a worker (see edges.js) ───────────────────────────────

let worker = null
let workerFailed = false
let nextJob = 0
const jobs = new Map()

function edgeWorker() {
  if (worker || workerFailed || typeof Worker === 'undefined') {
    return worker
  }

  try {
    worker = new Worker(new URL('./edgesWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      jobs.get(data.id)?.resolve(data.results)
      jobs.delete(data.id)
    }
    worker.onerror = (event) => {
      workerFailed = true
      worker = null
      jobs.forEach((job) => job.reject(event))
      jobs.clear()
    }
  } catch {
    workerFailed = true
  }

  return worker
}

// Flat copies of a geometry's positions and index, to hand to the worker.
function arraysOf(geometry) {
  const attribute = geometry.attributes.position
  let position

  if (attribute.array instanceof Float32Array && attribute.itemSize === 3 && !attribute.isInterleavedBufferAttribute && !attribute.normalized) {
    position = attribute.array.slice(0, attribute.count * 3)
  } else {
    position = new Float32Array(attribute.count * 3)

    for (let i = 0; i < attribute.count; i += 1) {
      position[i * 3] = attribute.getX(i)
      position[i * 3 + 1] = attribute.getY(i)
      position[i * 3 + 2] = attribute.getZ(i)
    }
  }

  const index = geometry.index ? Uint32Array.from(geometry.index.array.subarray(0, geometry.index.count)) : null
  return { position, index }
}

function computeEdges(geometries) {
  const payload = geometries.map(arraysOf)
  const solveHere = () => payload.map(({ position, index }) => featureEdgePositions(position, index, MODEL.edgeThresholdDeg))
  const busy = edgeWorker()

  if (!busy) {
    return Promise.resolve(solveHere())
  }

  return new Promise((resolve) => {
    const id = (nextJob += 1)
    // If the worker fails, do the work here rather than lose the edges.
    jobs.set(id, { resolve, reject: () => resolve(solveHere()) })
    busy.postMessage({ id, jobs: payload, thresholdDeg: MODEL.edgeThresholdDeg })
  })
}

/*
 * Adds the white model's edge lines. Repeated components (chairs, windows) share geometry, so
 * their edges are computed once. Resolves to the model.
 */
export async function attachEdges(model) {
  const unique = [...new Set(model.meshes.map((mesh) => mesh.geometry))]
  const results = await computeEdges(unique)
  const lines = new Map(unique.map((geometry, i) => [geometry, new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(results[i], 3))]))

  model.meshes.forEach((mesh) => {
    const segments = new THREE.LineSegments(lines.get(mesh.geometry), model.edgeMaterial)
    segments.raycast = () => {}
    segments.visible = model.appearance !== 'original'
    mesh.add(segments)
    model.edges.push(segments)
  })

  model.hasEdges = true
  return model
}

// prepareModel + its edge lines.
export async function prepareModelAsync(object) {
  return attachEdges(prepareModel(object))
}

export function prepareModel(object) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    throw new Error('This model has no visible geometry.')
  }

  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  // Very flat models still need a usable extent in every direction.
  const floor = Math.max(size.x, size.y, size.z) * 0.02
  size.set(Math.max(size.x, floor), Math.max(size.y, floor), Math.max(size.z, floor))

  object.position.sub(centre)
  const pivot = new THREE.Group()
  pivot.add(object)

  const meshes = []
  object.traverse((child) => {
    if (child.isMesh) {
      meshes.push(child)
    }
  })

  const white = new THREE.MeshStandardMaterial({
    color: MODEL.whiteColor,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    // Pushes faces back slightly so the edge lines draw cleanly on top.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  // Light copies carry no normals (flat shading); their white surfaces are flat-shaded too.
  const whiteFlat = white.clone()
  whiteFlat.flatShading = true
  const edgeMaterial = new THREE.LineBasicMaterial({ color: MODEL.edgeColor, transparent: true, opacity: MODEL.edgeOpacity })
  // Filled in by attachEdges.
  const edges = []

  const originals = new Map(meshes.map((mesh) => [mesh, mesh.material]))
  // Faces are drawn from both sides: exported models often have faces turned the wrong way.
  // While a model fades it is drawn in a single pass (three otherwise draws see-through
  // double-sided faces back then front, each with its own shader to compile).
  ;[white, whiteFlat, ...meshes.flatMap((mesh) => materialsOf(mesh.material))].forEach((material) => {
    material.side = THREE.DoubleSide
    material.forceSinglePass = true
  })
  const materials = new Set([white, whiteFlat, edgeMaterial, ...meshes.flatMap((mesh) => materialsOf(mesh.material))])
  materials.forEach((material) => {
    material.userData.baseOpacity = material.opacity
    material.userData.baseTransparent = material.transparent
    material.userData.baseDepthWrite = material.depthWrite
  })

  return { pivot, object, size, meshes, originals, white, whiteFlat, edgeMaterial, edges, materials, appearance: null }
}

export function applyAppearance(model, appearance) {
  if (model.appearance === appearance) {
    return
  }

  model.meshes.forEach((mesh) => {
    const white = mesh.geometry.attributes.normal ? model.white : model.whiteFlat
    mesh.material = appearance === 'original' ? model.originals.get(mesh) : white
  })
  model.edges.forEach((lines) => {
    lines.visible = appearance !== 'original'
  })
  model.appearance = appearance
}

// Fades a model in or out (transitions, enter / delete animations).
export function setModelOpacity(model, opacity) {
  const fading = opacity < 0.995

  model.materials.forEach((material) => {
    material.opacity = material.userData.baseOpacity * opacity
    material.transparent = fading || material.userData.baseTransparent
    material.depthWrite = !fading && material.userData.baseDepthWrite
  })
}

export function disposeModel(model) {
  model.object.traverse((child) => {
    child.geometry?.dispose()
  })
  new Set(model.edges.map((lines) => lines.geometry)).forEach((geometry) => geometry.dispose())
  model.materials.forEach((material) => {
    textureKeys.forEach((key) => material[key]?.dispose?.())
    material.dispose()
  })
}
