import * as THREE from 'three'
import { GROUP, THEME } from '../app/constants.js'
import { clamp } from '../utils/easing.js'
import { sharedUniforms } from './cardMaterials.js'

/*
 * Group bubbles (spec §103–104): a thin grey boundary that follows its contents, like a soft
 * territory rather than a folder box. The outline is the edge of a softened union of rounded
 * rectangles, computed per pixel from a signed distance field: one rectangle per member (padded),
 * plus a "bridge" across the gap between neighbours, so the bubble holds the group as one shape
 * and reshapes live as things move. Each group also leaves a matching zone on the floor around
 * its members' footprints, so groups read on the plan too.
 */

// Members drawn exactly, plus the bridges between them.
const MAX = GROUP.maxMembers * 2

const vertexShader = /* glsl */ `
  uniform float uOnFloor;
  varying vec2 vPoint;
  varying float vDistance;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Upright bubbles work in (x, y); floor zones in (x, z).
    vPoint = uOnFloor > 0.5 ? world.xz : world.xy;
    vec4 mvPosition = viewMatrix * world;
    vDistance = length(mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  #define MAX ${MAX}
  uniform vec4 uRects[MAX];
  uniform int uCount;
  uniform vec3 uColor;
  uniform float uOutline;
  uniform float uFill;
  uniform float uOpacity;
  uniform float uLift;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uPresence;
  varying vec2 vPoint;
  varying float vDistance;

  float roundedBox(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  // Polynomial smooth minimum: neighbouring outlines melt into one.
  float smoothMin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }

  void main() {
    float d = 1e4;

    for (int i = 0; i < MAX; i++) {
      if (i >= uCount) break;
      vec4 rect = uRects[i];
      d = smoothMin(d, roundedBox(vPoint - rect.xy, rect.zw + ${GROUP.padding.toFixed(3)}, ${GROUP.radius.toFixed(3)}), ${GROUP.smoothing.toFixed(3)});
    }

    float pixel = max(fwidth(d), 1e-5);
    float line = 1.0 - smoothstep(0.35 * pixel, 1.15 * pixel, abs(d));
    float inside = 1.0 - smoothstep(-pixel, pixel, d);
    float fog = smoothstep(uFogNear, uFogFar, vDistance) * 0.85;
    float strength = max(line * uOutline * (1.0 + 0.9 * uLift), inside * uFill * (1.0 + 1.2 * uLift));
    float alpha = strength * uOpacity * uPresence * (1.0 - fog) * smoothstep(0.45, 1.7, vDistance);

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(uColor, min(alpha, 1.0));
    #include <colorspace_fragment>
  }
`

const unitPlane = new THREE.PlaneGeometry(1, 1)

function createShapeMesh({ onFloor }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uOnFloor: { value: onFloor ? 1 : 0 },
      uRects: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uCount: { value: 0 },
      uColor: { value: new THREE.Color(THEME.ink) },
      uOutline: { value: onFloor ? GROUP.floorOutlineOpacity : GROUP.outlineOpacity },
      uFill: { value: onFloor ? GROUP.floorFillOpacity : GROUP.fillOpacity },
      uOpacity: { value: 0 },
      uLift: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(unitPlane, material)
  mesh.frustumCulled = false
  mesh.renderOrder = onFloor ? 1 : 0

  if (onFloor) {
    mesh.rotation.x = -Math.PI / 2
  }

  return mesh
}

/*
 * Bridges between neighbouring members (within the leave distance): side by side, a band across
 * the gap as tall as both share; one above the other, as wide as both share.
 */
export function withBridges(rects) {
  const bridges = []

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      const gapX = Math.abs(a.x - b.x) - a.hx - b.hx
      const gapY = Math.abs(a.y - b.y) - a.hy - b.hy
      const shareY = [Math.max(a.y - a.hy, b.y - b.hy), Math.min(a.y + a.hy, b.y + b.hy)]
      const shareX = [Math.max(a.x - a.hx, b.x - b.hx), Math.min(a.x + a.hx, b.x + b.hx)]

      if (gapX > 0 && gapX <= GROUP.leaveGap && shareY[1] > shareY[0]) {
        const [left, right] = a.x < b.x ? [a.x + a.hx, b.x - b.hx] : [b.x + b.hx, a.x - a.hx]
        bridges.push({ x: (left + right) / 2, y: (shareY[0] + shareY[1]) / 2, hx: (right - left) / 2 + 0.01, hy: (shareY[1] - shareY[0]) / 2 })
      } else if (gapY > 0 && gapY <= GROUP.leaveGap && shareX[1] > shareX[0]) {
        const [low, high] = a.y < b.y ? [a.y + a.hy, b.y - b.hy] : [b.y + b.hy, a.y - a.hy]
        bridges.push({ x: (shareX[0] + shareX[1]) / 2, y: (low + high) / 2, hx: (shareX[1] - shareX[0]) / 2, hy: (high - low) / 2 + 0.01 })
      }
    }
  }

  return [...rects, ...bridges]
}

// Rects as { x, y, hx, hy }; past MAX, the rest are covered by one rect around them all.
function packRects(rects) {
  if (rects.length <= MAX) {
    return rects
  }

  const rest = rects.slice(MAX - 1)
  const left = Math.min(...rest.map((rect) => rect.x - rect.hx))
  const right = Math.max(...rest.map((rect) => rect.x + rect.hx))
  const bottom = Math.min(...rest.map((rect) => rect.y - rect.hy))
  const top = Math.max(...rest.map((rect) => rect.y + rect.hy))
  return [...rects.slice(0, MAX - 1), { x: (left + right) / 2, y: (bottom + top) / 2, hx: (right - left) / 2, hy: (top - bottom) / 2 }]
}

function writeRects(mesh, rects, place) {
  const packed = packRects(rects)
  const uniforms = mesh.material.uniforms
  uniforms.uCount.value = packed.length
  packed.forEach((rect, index) => uniforms.uRects.value[index].set(rect.x, rect.y, rect.hx, rect.hy))

  // The quad covers the shape with room for its padding and soft joins.
  const margin = GROUP.padding + GROUP.smoothing + 0.1
  const left = Math.min(...packed.map((rect) => rect.x - rect.hx)) - margin
  const right = Math.max(...packed.map((rect) => rect.x + rect.hx)) + margin
  const low = Math.min(...packed.map((rect) => rect.y - rect.hy)) - margin
  const high = Math.max(...packed.map((rect) => rect.y + rect.hy)) + margin
  place(mesh, (left + right) / 2, (low + high) / 2, right - left, high - low)
}

// The same field in JavaScript (rects with their bridges), for hit testing: negative inside.
export function bubbleDistance(point, rects) {
  let d = 1e4

  for (const rect of packRects(rects)) {
    const qx = Math.abs(point.x - rect.x) - (rect.hx + GROUP.padding) + GROUP.radius
    const qy = Math.abs(point.y - rect.y) - (rect.hy + GROUP.padding) + GROUP.radius
    const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - GROUP.radius
    const h = Math.max(GROUP.smoothing - Math.abs(d - box), 0) / GROUP.smoothing
    d = Math.min(d, box) - h * h * GROUP.smoothing * 0.25
  }

  return d
}

export function createGroupShapes(spatial) {
  const root = new THREE.Group()
  spatial.world.add(root)
  const shapes = new Map()
  let lastNow = null

  function create(id) {
    const shape = { id, wall: createShapeMesh({ onFloor: false }), floor: createShapeMesh({ onFloor: true }), opacity: 0, target: 1, lift: 0 }
    root.add(shape.wall, shape.floor)
    shapes.set(id, shape)
    return shape
  }

  function dispose(shape) {
    root.remove(shape.wall, shape.floor)
    shape.wall.material.dispose()
    shape.floor.material.dispose()
  }

  return {
    /*
     * groups: [{ id, rects, floorRects, z, visibility, selected }] — rects upright in (x, y),
     * floorRects in (x, z), z the plane the bubble lies in. Returns true while anything fades.
     */
    update(now, groups, { floorY }) {
      const dtMs = lastNow === null ? 16 : clamp(now - lastNow, 0, 100)
      lastNow = now
      const wanted = new Set()
      let busy = false

      groups.forEach((group) => {
        wanted.add(group.id)
        const shape = shapes.get(group.id) || create(group.id)
        shape.target = group.visibility
        const lift = group.selected ? 1 : 0
        shape.lift += (lift - shape.lift) * (1 - Math.exp(-dtMs / 70))

        if (Math.abs(lift - shape.lift) < 0.003) {
          shape.lift = lift
        } else {
          busy = true
        }

        writeRects(shape.wall, withBridges(group.rects), (mesh, x, y, width, height) => {
          // Just behind the items, so they cover the bubble's faint fill.
          mesh.position.set(x, y, group.z - 0.03)
          mesh.scale.set(width, height, 1)
        })
        writeRects(shape.floor, withBridges(group.floorRects), (mesh, x, z, width, depth) => {
          mesh.position.set(x, floorY + 0.003, z)
          mesh.scale.set(width, depth, 1)
        })
      })

      shapes.forEach((shape, id) => {
        if (!wanted.has(id)) {
          shape.target = 0
        }

        const step = dtMs / GROUP.fadeMs
        const before = shape.opacity
        shape.opacity = shape.opacity < shape.target ? Math.min(shape.target, shape.opacity + step) : Math.max(shape.target, shape.opacity - step)
        busy ||= before !== shape.opacity

        ;[shape.wall, shape.floor].forEach((mesh) => {
          mesh.material.uniforms.uOpacity.value = shape.opacity
          mesh.material.uniforms.uLift.value = shape.lift
          mesh.visible = shape.opacity > 0.002
        })

        if (!wanted.has(id) && shape.opacity <= 0) {
          dispose(shape)
          shapes.delete(id)
        }
      })

      return busy
    },

    clear() {
      shapes.forEach(dispose)
      shapes.clear()
    },
  }
}
