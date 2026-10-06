/*
 * Feature edges of a triangle mesh, for the white model: open boundaries and creases sharper
 * than thresholdDeg. Unlike THREE.EdgesGeometry this ignores face winding and skips duplicated
 * (back) faces, which many exports contain (SketchUp's double-sided faces among them), so a flat
 * face never shows the diagonals of its triangulation. Vertices are matched by position,
 * relative to the mesh size.
 *
 * Plain arrays in, plain arrays out, so it can run in a worker (see edgesWorker.js).
 * position: Float32Array (x, y, z per vertex); index: integer array or null.
 * Returns a Float32Array of line segments (two points per edge).
 */
export function featureEdgePositions(position, index, thresholdDeg) {
  const vertexCount = position.length / 3
  const count = index ? index.length : vertexCount
  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (let i = 0; i < position.length; i += 3) {
    minX = Math.min(minX, position[i])
    minY = Math.min(minY, position[i + 1])
    minZ = Math.min(minZ, position[i + 2])
    maxX = Math.max(maxX, position[i])
    maxY = Math.max(maxY, position[i + 1])
    maxZ = Math.max(maxZ, position[i + 2])
  }

  const quantum = Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ), 1e-9) * 1e-6
  const keys = new Array(vertexCount)

  for (let i = 0; i < vertexCount; i += 1) {
    keys[i] = `${Math.round(position[i * 3] / quantum)},${Math.round(position[i * 3 + 1] / quantum)},${Math.round(position[i * 3 + 2] / quantum)}`
  }

  const seen = new Set()
  const edges = new Map()

  for (let i = 0; i + 2 < count; i += 3) {
    const a = index ? index[i] : i
    const b = index ? index[i + 1] : i + 1
    const c = index ? index[i + 2] : i + 2
    const ka = keys[a]
    const kb = keys[b]
    const kc = keys[c]

    if (ka === kb || kb === kc || ka === kc) {
      continue
    }

    const triangle = [ka, kb, kc].sort().join('|')

    if (seen.has(triangle)) {
      continue
    }

    seen.add(triangle)

    // Normal = (c - b) × (a - b).
    const bx = position[b * 3]
    const by = position[b * 3 + 1]
    const bz = position[b * 3 + 2]
    const ux = position[c * 3] - bx
    const uy = position[c * 3 + 1] - by
    const uz = position[c * 3 + 2] - bz
    const vx = position[a * 3] - bx
    const vy = position[a * 3 + 1] - by
    const vz = position[a * 3 + 2] - bz
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)

    if (!length) {
      continue
    }

    nx /= length
    ny /= length
    nz /= length

    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const keyFrom = keys[from]
      const keyTo = keys[to]
      const key = keyFrom < keyTo ? `${keyFrom}#${keyTo}` : `${keyTo}#${keyFrom}`
      const edge = edges.get(key)

      if (edge) {
        edge.normals.push(nx, ny, nz)
      } else {
        edges.set(key, { from, to, normals: [nx, ny, nz] })
      }
    }
  }

  const out = []

  edges.forEach(({ from, to, normals }) => {
    // An open boundary, or two faces meeting at a crease (whichever way they face).
    let keep = normals.length === 3

    for (let k = 3; !keep && k < normals.length; k += 3) {
      keep = Math.abs(normals[0] * normals[k] + normals[1] * normals[k + 1] + normals[2] * normals[k + 2]) < cosThreshold
    }

    if (keep) {
      out.push(position[from * 3], position[from * 3 + 1], position[from * 3 + 2], position[to * 3], position[to * 3 + 1], position[to * 3 + 2])
    }
  })

  return new Float32Array(out)
}
