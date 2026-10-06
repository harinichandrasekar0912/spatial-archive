import * as THREE from 'three'
import { MODEL } from '../../app/constants.js'

/*
 * The light copy of a 3D model that the workspace keeps.
 *
 * A workspace brings material together; it does not need every bolt of a 3D model. On import:
 *   1. every surface is baked into world space and grouped by look (one mesh per material);
 *   2. the outer shell is kept: the model is drawn from ~100 directions around it into an ID
 *      buffer on the GPU, and only faces seen from outside survive, so it looks the same from
 *      any outside angle with nothing inside;
 *   3. if it is still heavy, it is simplified to a triangle budget by vertex clustering: small
 *      detail (furniture, railings, plants) collapses while the massing stays put;
 *   4. the result is saved as one compact binary glTF (.glb) with flat shading (no normals)
 *      and textures capped in size.
 */

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

// A growable Float32 buffer: millions of pushes without boxing every number.
class FloatList {
  constructor(capacity = 4096) {
    this.array = new Float32Array(capacity)
    this.length = 0
  }

  push3(a, b, c) {
    if (this.length + 3 > this.array.length) {
      const next = new Float32Array(this.array.length * 2)
      next.set(this.array)
      this.array = next
    }

    this.array[this.length] = a
    this.array[this.length + 1] = b
    this.array[this.length + 2] = c
    this.length += 3
  }

  push2(a, b) {
    if (this.length + 2 > this.array.length) {
      const next = new Float32Array(this.array.length * 2)
      next.set(this.array)
      this.array = next
    }

    this.array[this.length] = a
    this.array[this.length + 1] = b
    this.length += 2
  }

  view() {
    return this.array.subarray(0, this.length)
  }
}

const materialsOf = (material) => (Array.isArray(material) ? material : [material]).filter(Boolean)

function isShown(object) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) {
      return false
    }
  }

  return true
}

// One simple, flat-shaded material per distinct look of the source.
function lightMaterial(source, nameOf) {
  const map = source.map?.image ? source.map : null
  const opacity = source.transparent ? THREE.MathUtils.clamp(source.opacity ?? 1, 0.05, 1) : 1

  if (map && !map.userData.mimeType) {
    // Photographs stay JPEG; anything else (alpha cut-outs) is saved as PNG.
    const name = String(nameOf(map.image.src) || map.name || map.image.src || '').toLowerCase()
    map.userData.mimeType = /\.jpe?g($|[?#])/.test(name) ? 'image/jpeg' : 'image/png'
  }

  return new THREE.MeshStandardMaterial({
    name: source.name || '',
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    map,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  })
}

function lookKey(source) {
  const map = source.map?.image ? source.map.source?.uuid || source.map.uuid : ''
  const color = source.color ? source.color.getHexString() : 'ffffff'
  const opacity = source.transparent ? Number(source.opacity ?? 1).toFixed(2) : '1'
  return `${color}|${map}|${opacity}`
}

// 1. All visible surfaces as world-space triangles, grouped by look.
function collectSurfaces(object) {
  object.updateMatrixWorld(true)
  const names = object.userData.sourceNames || new Map()
  const nameOf = (url) => names.get(url) || ''
  const looks = new Map()
  const point = new THREE.Vector3()
  let triangles = 0

  object.traverse((mesh) => {
    if (!mesh.isMesh || !isShown(mesh)) {
      return
    }

    const { geometry } = mesh
    const position = geometry.attributes.position
    const uv = geometry.attributes.uv
    const index = geometry.index
    const total = index ? index.count : position.count
    const materials = materialsOf(mesh.material)
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: total, materialIndex: 0 }]

    for (const group of groups) {
      const source = materials[group.materialIndex] ?? materials[0]

      if (!source || source.visible === false) {
        continue
      }

      const key = lookKey(source)

      if (!looks.has(key)) {
        looks.set(key, { material: lightMaterial(source, nameOf), positions: new FloatList(), uvs: source.map?.image ? new FloatList() : null })
      }

      const look = looks.get(key)
      const end = Math.min(group.start + group.count, total)

      for (let i = group.start; i + 2 < end; i += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = index ? index.getX(i + corner) : i + corner
          point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld)
          look.positions.push3(point.x, point.y, point.z)

          if (look.uvs) {
            look.uvs.push2(uv ? uv.getX(vertex) : 0, uv ? uv.getY(vertex) : 0)
          }
        }

        triangles += 1
      }
    }
  })

  return { looks: [...looks.values()].filter((look) => look.positions.length), triangles }
}

// Even directions over the sphere (Fibonacci lattice).
function directionsAround(count) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count
    const radius = Math.sqrt(1 - y * y)
    return new THREE.Vector3(Math.cos(golden * i) * radius, y, Math.sin(golden * i) * radius)
  })
}

const idVertexShader = /* glsl */ `
  attribute float triangleId;
  flat varying float vId;

  void main() {
    vId = triangleId;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Triangle id + 1 written as a 24-bit colour (0 stays "nothing here").
const idFragmentShader = /* glsl */ `
  flat varying float vId;

  void main() {
    float id = vId + 1.0;
    float r = mod(id, 256.0);
    float g = mod(floor(id / 256.0), 256.0);
    float b = floor(id / 65536.0);
    gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
  }
`

// 2. Which triangles can be seen from outside the model.
async function findOuterShell(renderer, looks, triangles, onProgress) {
  const positions = new Float32Array(triangles * 9)
  const ids = new Float32Array(triangles * 3)
  let offset = 0

  looks.forEach((look) => {
    positions.set(look.positions.view(), offset * 9)
    offset += look.positions.length / 9
  })

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    ids[triangle * 3] = triangle
    ids[triangle * 3 + 1] = triangle
    ids[triangle * 3 + 2] = triangle
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('triangleId', new THREE.BufferAttribute(ids, 1))
  geometry.computeBoundingSphere()

  const material = new THREE.ShaderMaterial({ vertexShader: idVertexShader, fragmentShader: idFragmentShader, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)

  const { center, radius } = geometry.boundingSphere
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, radius * 0.5, radius * 3.5)
  const size = MODEL.shellResolution
  const target = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false })
  const pixels = new Uint8Array(size * size * 4)
  const seen = new Uint8Array(triangles)
  const previousTarget = renderer.getRenderTarget()
  const previousColor = renderer.getClearColor(new THREE.Color())
  const previousAlpha = renderer.getClearAlpha()
  const directions = directionsAround(MODEL.shellViews)

  try {
    for (let view = 0; view < directions.length; view += 1) {
      const direction = directions[view]
      camera.position.copy(center).addScaledVector(direction, radius * 2)
      camera.up.set(0, 1, 0)

      if (Math.abs(direction.y) > 0.99) {
        camera.up.set(0, 0, 1)
      }

      camera.lookAt(center)
      camera.updateMatrixWorld()

      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)

      for (let p = 0; p < pixels.length; p += 4) {
        const id = pixels[p] | (pixels[p + 1] << 8) | (pixels[p + 2] << 16)

        if (id) {
          seen[id - 1] = 1
        }
      }

      if (view % 8 === 7) {
        renderer.setRenderTarget(previousTarget)
        onProgress(view / directions.length)
        await yieldToBrowser()
      }
    }
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.setClearColor(previousColor, previousAlpha)
    target.dispose()
    geometry.dispose()
    material.dispose()
  }

  return seen
}

// Keeps only the triangles marked in `keep` (indexed across all looks, in order).
function filterTriangles(looks, keep) {
  let triangle = 0

  return looks
    .map((look) => {
      const positions = new FloatList(Math.max(9, look.positions.length))
      const uvs = look.uvs ? new FloatList(Math.max(6, look.uvs.length)) : null
      const source = look.positions.array
      const sourceUvs = look.uvs?.array
      const count = look.positions.length / 9

      for (let i = 0; i < count; i += 1, triangle += 1) {
        if (!keep[triangle]) {
          continue
        }

        for (let corner = 0; corner < 3; corner += 1) {
          const at = i * 9 + corner * 3
          positions.push3(source[at], source[at + 1], source[at + 2])

          if (uvs) {
            const uvAt = i * 6 + corner * 2
            uvs.push2(sourceUvs[uvAt], sourceUvs[uvAt + 1])
          }
        }
      }

      return { material: look.material, positions, uvs }
    })
    .filter((look) => look.positions.length)
}

/*
 * 3. Vertex clustering on a grid of `resolution` cells along the model's longest side. Each
 * cell's vertices merge into their average (shared by every material, so no cracks open between
 * them); triangles that collapse are dropped. Without a resolution, identical vertices are merged.
 */
function indexLooks(looks, box, resolution) {
  const size = box.getSize(new THREE.Vector3())
  const cell = resolution ? Math.max(size.x, size.y, size.z) / resolution : 0
  const ny = resolution ? Math.ceil(size.y / cell) + 1 : 0
  const nz = resolution ? Math.ceil(size.z / cell) + 1 : 0
  const quantum = Math.max(size.length(), 1e-9) * 1e-7
  const keyOf = resolution
    ? (x, y, z) => (Math.floor((x - box.min.x) / cell) * ny + Math.floor((y - box.min.y) / cell)) * nz + Math.floor((z - box.min.z) / cell)
    : (x, y, z) => `${Math.round(x / quantum)},${Math.round(y / quantum)},${Math.round(z / quantum)}`

  // Shared representative positions (cell averages).
  const cells = new Map()
  let sums = new Float64Array(4 * 65536)

  looks.forEach((look) => {
    const array = look.positions.array

    for (let at = 0; at < look.positions.length; at += 3) {
      const key = keyOf(array[at], array[at + 1], array[at + 2])
      let id = cells.get(key)

      if (id === undefined) {
        id = cells.size
        cells.set(key, id)

        if ((id + 1) * 4 > sums.length) {
          const next = new Float64Array(sums.length * 2)
          next.set(sums)
          sums = next
        }
      }

      sums[id * 4] += array[at]
      sums[id * 4 + 1] += array[at + 1]
      sums[id * 4 + 2] += array[at + 2]
      sums[id * 4 + 3] += 1
    }
  })

  let triangles = 0

  const meshes = looks
    .map((look) => {
      const array = look.positions.array
      const uvArray = look.uvs?.array
      const local = new Map()
      const positions = new FloatList()
      const uvs = look.uvs ? new FloatList() : null
      const indices = []
      const seen = new Set()
      const corners = [0, 0, 0]
      const cellIds = [0, 0, 0]

      for (let i = 0; i < look.positions.length / 9; i += 1) {
        for (let corner = 0; corner < 3; corner += 1) {
          const at = i * 9 + corner * 3
          cellIds[corner] = cells.get(keyOf(array[at], array[at + 1], array[at + 2]))
        }

        const [a, b, c] = cellIds

        if (a === b || b === c || a === c) {
          continue
        }

        const sorted = [a, b, c].sort((x, y) => x - y).join('|')

        if (seen.has(sorted)) {
          continue
        }

        seen.add(sorted)

        for (let corner = 0; corner < 3; corner += 1) {
          const id = cellIds[corner]
          const uvAt = i * 6 + corner * 2
          // Vertices on a texture seam share a position but keep their own coordinates.
          const key = uvs ? `${id}|${uvArray[uvAt]}|${uvArray[uvAt + 1]}` : id
          let vertex = local.get(key)

          if (vertex === undefined) {
            vertex = positions.length / 3
            local.set(key, vertex)
            const count = sums[id * 4 + 3]
            positions.push3(sums[id * 4] / count, sums[id * 4 + 1] / count, sums[id * 4 + 2] / count)

            if (uvs) {
              uvs.push2(uvArray[uvAt], uvArray[uvAt + 1])
            }
          }

          corners[corner] = vertex
        }

        indices.push(corners[0], corners[1], corners[2])
      }

      triangles += indices.length / 3
      return { material: look.material, positions: positions.view().slice(), uvs: uvs ? uvs.view().slice() : null, indices }
    })
    .filter((mesh) => mesh.indices.length)

  return { meshes, triangles }
}

function boundsOf(looks) {
  const box = new THREE.Box3()
  const point = new THREE.Vector3()

  looks.forEach((look) => {
    const array = look.positions.array

    for (let at = 0; at < look.positions.length; at += 3) {
      box.expandByPoint(point.set(array[at], array[at + 1], array[at + 2]))
    }
  })

  return box
}

// Finds a grid resolution that brings the model under the triangle budget.
async function simplifyToBudget(looks, box, triangles, onProgress) {
  if (triangles <= MODEL.triangleBudget) {
    return indexLooks(looks, box, 0)
  }

  let resolution = 512
  let result = indexLooks(looks, box, resolution)

  for (let attempt = 0; attempt < 5 && result.triangles > MODEL.triangleBudget; attempt += 1) {
    onProgress(attempt / 5)
    await yieldToBrowser()
    // Surface triangles grow roughly with the square of the grid resolution.
    resolution = Math.max(24, Math.floor(resolution * Math.min(0.85, Math.sqrt(MODEL.triangleBudget / result.triangles) * 0.97)))
    result = indexLooks(looks, box, resolution)
  }

  return result
}

function buildScene(meshes) {
  const group = new THREE.Group()
  group.name = 'Spatial Archive light copy'

  meshes.forEach(({ material, positions, uvs, indices }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    if (uvs) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    }

    geometry.setIndex(indices)
    group.add(new THREE.Mesh(geometry, material))
  })

  return group
}

export function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose()
    materialsOf(child.material).forEach((material) => {
      material.map?.dispose()
      material.dispose()
    })
  })
}

/*
 * Makes the light copy of a loaded model. Resolves to { glb: ArrayBuffer, stats }.
 * `renderer` is the app's WebGL renderer (borrowed for the outer-shell pass).
 */
export async function makeLightCopy(object, { renderer, onProgress = () => {} }) {
  const { looks, triangles } = collectSurfaces(object)

  if (!triangles) {
    throw new Error('This model has no surfaces to show.')
  }

  onProgress('shell', 0)
  await yieldToBrowser()
  const keep = MODEL.keepOuterShellOnly ? await findOuterShell(renderer, looks, triangles, (t) => onProgress('shell', t)) : null
  const shell = keep ? filterTriangles(looks, keep) : looks
  const shellTriangles = shell.reduce((sum, look) => sum + look.positions.length / 9, 0)

  if (!shellTriangles) {
    throw new Error('No outer surfaces were found in this model.')
  }

  onProgress('simplify', 0)
  await yieldToBrowser()
  const { meshes, triangles: lightTriangles } = await simplifyToBudget(shell, boundsOf(shell), shellTriangles, (t) => onProgress('simplify', t))
  const scene = buildScene(meshes)

  onProgress('save', 0)
  await yieldToBrowser()
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: MODEL.textureMaxPx })
  scene.traverse((child) => {
    child.geometry?.dispose()
    child.material?.dispose()
  })

  return {
    glb,
    stats: { sourceTriangles: triangles, shellTriangles, triangles: lightTriangles },
  }
}
