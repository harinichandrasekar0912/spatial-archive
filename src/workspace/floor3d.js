import * as THREE from 'three'
import { DOT_FIELD, FLOOR, THEME, WORKSPACE } from '../app/constants.js'
import { clamp, easeInOutCubic, lerp } from '../utils/easing.js'

/*
 * The workspace floor ("dots + floor"): a grid receding under the dot volume, plus a footprint
 * and dotted drop lines for every item. The footprint is the item's plan, projected straight
 * down: a card (a plane) becomes a line lying on its layer's grid line; a 3D model stamps its
 * base rectangle. Depth relationships can then be read at a glance.
 *
 * The floor sits on a row of the dot lattice, so the lattice rests on it, and (FLOOR.clipDotsBelow)
 * the dots below it are removed: the floor is the bottom of the space. Its front edge can be
 * moved (setFrontZ) so it meets the bottom of the screen when a workspace opens.
 *
 * Every line carries an "along" value (0 → 1) so it can be drawn progressively: footprints
 * from their left end to their right end, drop lines from the floor up (see setReveal).
 * The selected item's turn dial lies flat on the floor in front of its footprint.
 */

const vertexShader = /* glsl */ `
  attribute float alpha;
  attribute float along;
  varying float vAlpha;
  varying float vAlong;
  varying float vWorldZ;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPosition;
    float distance = length(mvPosition.xyz);
    // Quieter with depth, invisible before the far edge, dissolving very close to the camera.
    float depthFade = mix(1.0, 0.35, smoothstep(8.0, 60.0, distance)) * (1.0 - smoothstep(60.0, 92.0, distance));
    vAlpha = alpha * depthFade * smoothstep(0.25, 1.0, distance);
    vAlong = along;
    vWorldZ = worldPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDraw;
  uniform float uFrontZ;
  varying float vAlpha;
  varying float vAlong;
  varying float vWorldZ;

  void main() {
    float alpha = vAlpha * uOpacity;

    if (alpha < 0.002 || vAlong > uDraw || vWorldZ > uFrontZ) discard;

    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

function material(opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(THEME.ink) },
      uOpacity: { value: opacity },
      uDraw: { value: 1.0001 },
      uFrontZ: { value: 1e6 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
}

// Layers of grid drawn in front of layer 0, so the floor can reach towards the camera.
const FRONT_LAYERS = FLOOR.frontLayers

// Static grid in local space (floor at y = 0, layer 0 at z = 0). Lines running back are
// split per layer so the per-vertex distance fade follows the depth smoothly.
function createGridGeometry() {
  const { step } = DOT_FIELD
  const half = FLOOR.halfWidthSteps * step
  const spacing = WORKSPACE.layerSpacing
  const positions = []

  for (let i = -FLOOR.halfWidthSteps; i <= FLOOR.halfWidthSteps; i += FLOOR.lineEverySteps) {
    for (let layer = -FRONT_LAYERS; layer < FLOOR.depthLayers; layer += 1) {
      positions.push(i * step, 0, -layer * spacing, i * step, 0, -(layer + 1) * spacing)
    }
  }

  for (let layer = -FRONT_LAYERS; layer <= FLOOR.depthLayers; layer += 1) {
    const z = -layer * spacing
    // Cross lines are split too, so they fade sideways as well as with depth.
    for (let i = -FLOOR.halfWidthSteps; i < FLOOR.halfWidthSteps; i += 4) {
      positions.push(i * step, 0, z, Math.min(half, (i + 4) * step), 0, z)
    }
  }

  const vertexCount = positions.length / 3
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(new Array(vertexCount).fill(1), 1))
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(new Array(vertexCount).fill(0), 1))
  const depth = (FLOOR.depthLayers + FRONT_LAYERS) * spacing
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -depth / 2 + FRONT_LAYERS * spacing), half + depth)
  return geometry
}

function dynamicGeometry(vertexCount) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(vertexCount), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('along', new THREE.BufferAttribute(new Float32Array(vertexCount), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setDrawRange(0, 0)
  // Updated every sync; skip culling rather than recomputing bounds.
  return geometry
}

// The turn dial: an open ring with an arrowhead, drawn once into a texture.
function createDialTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const centre = size / 2
  const radius = size * 0.34
  const start = -Math.PI * 0.18
  const end = Math.PI * 1.42
  ctx.strokeStyle = THEME.ink
  ctx.fillStyle = THEME.ink
  ctx.lineWidth = size * 0.05
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(centre, centre, radius, start, end)
  ctx.stroke()

  // Arrowhead at the end of the arc, pointing along it.
  const tipX = centre + Math.cos(end) * radius
  const tipY = centre + Math.sin(end) * radius
  const along = end + Math.PI / 2
  const head = size * 0.11
  ctx.beginPath()
  ctx.moveTo(tipX + Math.cos(along) * head, tipY + Math.sin(along) * head)
  ctx.lineTo(tipX + Math.cos(along + 2.4) * head, tipY + Math.sin(along + 2.4) * head)
  ctx.lineTo(tipX + Math.cos(along - 2.4) * head, tipY + Math.sin(along - 2.4) * head)
  ctx.closePath()
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export function createFloor(spatial) {
  const root = new THREE.Group()
  root.visible = false
  root.renderOrder = 1

  const gridMaterial = material(FLOOR.gridOpacity)
  gridMaterial.uniforms.uFrontZ.value = WORKSPACE.layer0Z + 1e-3
  const grid = new THREE.LineSegments(createGridGeometry(), gridMaterial)
  grid.renderOrder = 1

  // Footprints: filled quads (up to 30 vertices per item: a model's fill plus four edges).
  const footprintGeometry = dynamicGeometry(FLOOR.maxItems * 30)
  const footprintMaterial = material(FLOOR.footprintOpacity)
  footprintMaterial.side = THREE.DoubleSide
  const footprints = new THREE.Mesh(footprintGeometry, footprintMaterial)
  footprints.frustumCulled = false
  footprints.renderOrder = 1

  const maxDashes = FLOOR.maxItems * 64
  const dropGeometry = dynamicGeometry(maxDashes * 2)
  const dropMaterial = material(FLOOR.dropOpacity)
  const drops = new THREE.LineSegments(dropGeometry, dropMaterial)
  drops.frustumCulled = false
  drops.renderOrder = 1

  const dialMaterial = new THREE.MeshBasicMaterial({ map: createDialTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0 })
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dialMaterial)
  dial.rotation.x = -Math.PI / 2
  dial.scale.setScalar(FLOOR.dialSize)
  dial.renderOrder = 2
  dial.visible = false

  root.add(grid, footprints, drops, dial)
  spatial.world.add(root)

  // A lattice row at or below y (the dots sit on whole multiples of the lattice step).
  const snap = (y) => (FLOOR.snapToLattice ? Math.floor(y / DOT_FIELD.step + 1e-6) * DOT_FIELD.step : y)
  const restingY = snap(FLOOR.defaultY)

  let presence = 0
  const reveal = { grid: 1, footprints: 1, drops: 1 }
  let level = { from: restingY, to: restingY, start: 0 }
  let floorY = restingY
  let dialState = { visible: false, hover: false, x: 0, z: 0 }
  const raycaster = new THREE.Raycaster()
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()

  // The clip follows the floor's presence, not its drawing, so no dot shows below the floor
  // even while the grid is still being drawn.
  function syncDots() {
    spatial.dotField.setFloor(floorY, FLOOR.clipDotsBelow ? presence : 0)
  }

  function setOpacity() {
    gridMaterial.uniforms.uOpacity.value = FLOOR.gridOpacity * presence * reveal.grid
    footprintMaterial.uniforms.uOpacity.value = FLOOR.footprintOpacity * presence
    dropMaterial.uniforms.uOpacity.value = FLOOR.dropOpacity * presence
    // Lines are drawn up to their "along" value; slightly over 1 so finished lines are whole.
    footprintMaterial.uniforms.uDraw.value = reveal.footprints >= 1 ? 1.0001 : reveal.footprints
    dropMaterial.uniforms.uDraw.value = reveal.drops >= 1 ? 1.0001 : reveal.drops
    root.visible = presence > 0.001
    dialMaterial.opacity = dialState.visible ? (dialState.hover ? 0.95 : FLOOR.dialOpacity) * presence : 0
    dial.visible = dialState.visible && presence > 0.001
    syncDots()
  }

  return {
    setPresence(value) {
      presence = value
      setOpacity()
    },

    // Progressive drawing for the workspace entry: grid opacity, footprint and drop progress.
    setReveal(next) {
      Object.assign(reveal, next)
      setOpacity()
    },

    // Nothing of the grid is drawn in front of this depth (the floor's front edge).
    setFrontZ(z) {
      gridMaterial.uniforms.uFrontZ.value = z + 1e-3
    },

    // Keep the floor below the lowest item; the change is eased rather than jumped.
    // `immediate` places the floor without easing (e.g. when a workspace has just loaded).
    setTargetLevel(lowestBottom, now, { immediate = false } = {}) {
      const target = this.levelFor(lowestBottom)

      if (immediate) {
        level = { from: target, to: target, start: now }
        floorY = target
      } else if (Math.abs(target - level.to) > 1e-3) {
        level = { from: floorY, to: target, start: now }
      }
    },

    // The floor level for a lowest item bottom (world units).
    levelFor(lowestBottom) {
      return Number.isFinite(lowestBottom) ? snap(lowestBottom - FLOOR.clearance) : restingY
    },

    getLevel() {
      return floorY
    },

    // Returns true while the floor level is still easing.
    update(camera, now) {
      const t = clamp((now - level.start) / FLOOR.levelChangeMs)
      floorY = lerp(level.from, level.to, easeInOutCubic(t))
      // Grid is infinite sideways: snap it to whole lattice steps under the camera.
      const spacing = DOT_FIELD.step * FLOOR.lineEverySteps
      grid.position.set(Math.round(camera.position.x / spacing) * spacing, floorY, WORKSPACE.layer0Z)
      dial.position.set(dialState.x, floorY + 0.004, dialState.z)
      syncDots()
      return t < 1
    },

    // The turn dial of the selected item: { x, z } on the floor, or null to hide it.
    // Returns whether anything changed.
    setDial(place, { hover = false } = {}) {
      const visible = Boolean(place)
      const changed = visible !== dialState.visible || hover !== dialState.hover || (visible && (place.x !== dialState.x || place.z !== dialState.z))
      dialState = { visible, hover, x: visible ? place.x : dialState.x, z: visible ? place.z : dialState.z }
      dial.position.set(dialState.x, floorY + 0.004, dialState.z)
      setOpacity()
      return changed
    },

    // Whether a screen point (NDC) lands on the dial (a generous circle on the floor).
    hitsDial(ndc, camera) {
      if (!dialState.visible || presence < 0.5) {
        return false
      }

      raycaster.setFromCamera(ndc, camera)
      floorPlane.constant = -floorY

      if (!raycaster.ray.intersectPlane(floorPlane, hit)) {
        return false
      }

      return Math.hypot(hit.x - dialState.x, hit.z - dialState.z) < FLOOR.dialSize * 0.62
    },

    /*
     * shapes: [{ x, y, z, halfWidth, halfHeight, halfDepth, rotation, opacity }] in world units.
     * z is the item's layer plane; rotation is its turn around the vertical axis (radians);
     * halfDepth is 0 for cards and half the plan depth for 3D models.
     */
    syncFootprints(shapes) {
      const footprintPositions = footprintGeometry.attributes.position.array
      const footprintAlpha = footprintGeometry.attributes.alpha.array
      const footprintAlong = footprintGeometry.attributes.along.array
      const dropPositions = dropGeometry.attributes.position.array
      const dropAlpha = dropGeometry.attributes.alpha.array
      const dropAlong = dropGeometry.attributes.along.array
      const y = floorY + 0.002
      let vertex = 0
      let dash = 0
      // Left-to-right drawing is measured across each footprint's own width.
      let left = 0
      let width = 1

      const alongOf = (x) => clamp((x - left) / width)

      // A flat quad on the floor from four (x, z) corners.
      function quad(corners, alpha) {
        ;[0, 1, 2, 0, 2, 3].forEach((corner) => {
          footprintPositions.set([corners[corner][0], y, corners[corner][1]], vertex * 3)
          footprintAlpha[vertex] = alpha
          footprintAlong[vertex] = alongOf(corners[corner][0])
          vertex += 1
        })
      }

      // A band of the given thickness along the floor from a to b.
      function band(a, b, thickness, alpha) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const normalX = (-(b[1] - a[1]) / length) * (thickness / 2)
        const normalZ = ((b[0] - a[0]) / length) * (thickness / 2)
        quad([[a[0] - normalX, a[1] - normalZ], [b[0] - normalX, b[1] - normalZ], [b[0] + normalX, b[1] + normalZ], [a[0] + normalX, a[1] + normalZ]], alpha)
      }

      // A dotted line from the floor up to a point; drawn upwards.
      function drop(x, top, z, alpha) {
        const height = Math.max(1e-3, top - floorY)

        for (let start = top; start > floorY && dash < maxDashes; start -= FLOOR.dropDash + FLOOR.dropGap) {
          const end = Math.max(floorY, start - FLOOR.dropDash)
          dropPositions.set([x, start, z, x, end, z], dash * 6)
          dropAlpha[dash * 2] = alpha
          dropAlpha[dash * 2 + 1] = alpha
          dropAlong[dash * 2] = (start - floorY) / height
          dropAlong[dash * 2 + 1] = (end - floorY) / height
          dash += 1
        }
      }

      shapes.slice(0, FLOOR.maxItems).forEach((shape) => {
        if (shape.opacity <= 0.002) {
          return
        }

        // Plan directions of the item's width and depth, turned with the item.
        const across = [Math.cos(shape.rotation) * shape.halfWidth, -Math.sin(shape.rotation) * shape.halfWidth]
        const deep = [Math.sin(shape.rotation) * shape.halfDepth, Math.cos(shape.rotation) * shape.halfDepth]
        const extentX = Math.abs(across[0]) + Math.abs(deep[0])
        left = shape.x - extentX
        width = Math.max(1e-3, extentX * 2)
        const bottom = shape.y - shape.halfHeight

        if (!shape.halfDepth) {
          // A card: its width laid on the floor, on its layer's grid line, with one drop line.
          band([shape.x - across[0], shape.z - across[1]], [shape.x + across[0], shape.z + across[1]], FLOOR.footprintThickness, shape.opacity)
          drop(shape.x, bottom, shape.z, shape.opacity)
          return
        }

        // A model: its base rectangle, with drop lines from the corners of its base.
        const corners = [
          [shape.x - across[0] - deep[0], shape.z - across[1] - deep[1]],
          [shape.x + across[0] - deep[0], shape.z + across[1] - deep[1]],
          [shape.x + across[0] + deep[0], shape.z + across[1] + deep[1]],
          [shape.x - across[0] + deep[0], shape.z - across[1] + deep[1]],
        ]
        quad(corners, shape.opacity * FLOOR.modelFill)
        corners.forEach((corner, index) => {
          band(corner, corners[(index + 1) % 4], FLOOR.modelOutlineThickness, shape.opacity)
          drop(corner[0], bottom, corner[1], shape.opacity)
        })
      })

      footprintGeometry.setDrawRange(0, vertex)
      footprintGeometry.attributes.position.needsUpdate = true
      footprintGeometry.attributes.alpha.needsUpdate = true
      footprintGeometry.attributes.along.needsUpdate = true
      dropGeometry.setDrawRange(0, dash * 2)
      dropGeometry.attributes.position.needsUpdate = true
      dropGeometry.attributes.alpha.needsUpdate = true
      dropGeometry.attributes.along.needsUpdate = true
    },
  }
}
