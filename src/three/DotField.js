import * as THREE from 'three'
import { DOT_FIELD, VOLUME, WORKSPACE } from '../app/constants.js'
import { smoothstep } from '../utils/easing.js'

/*
 * The dotted spatial field.
 *
 * Travel planes: a fixed set of identical XY point-grid planes placed in "slots" along -Z
 * (z = -k * planeSpacing). Planes are never regenerated; each frame they are re-assigned to
 * the slots around the camera. Because every plane is the same lattice and opacity is derived
 * from distance, re-assigning slots is invisible.
 *
 * Volume planes: inside a project the space between travel planes fills in (one plane per
 * workspace layer), so the field reads as a 3D lattice whose planes are the depth layers that
 * cards sit on. They fade in and out with the workspace (`setVolume`).
 */

// One lattice shared by every plane. A dot sits exactly on (0, 0) so all planes share an origin.
function createLatticeGeometry(halfExtent, step) {
  const count = Math.ceil(halfExtent / step)
  const side = count * 2 + 1
  const positions = new Float32Array(side * side * 3)
  let offset = 0

  for (let ix = -count; ix <= count; ix += 1) {
    for (let iy = -count; iy <= count; iy += 1) {
      positions[offset] = ix * step
      positions[offset + 1] = iy * step
      positions[offset + 2] = 0
      offset += 3
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

/*
 * Point shader. Small dots stay solid, exactly like the original square points, so the field
 * keeps its weight; dots larger than a few pixels (a plane passing close to the camera) become
 * round with a one-pixel soft edge. Size attenuation matches THREE.PointsMaterial.
 */
const vertexShader = /* glsl */ `
  uniform float uSize;
  uniform float uScale;
  uniform float uFloorY;
  uniform float uFloorStrength;
  varying float vSize;
  varying float vFloor;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPosition;
    vSize = uSize * uScale / -mvPosition.z;
    // Inside a workspace nothing hangs below the floor: dots under it fade away, while the row
    // resting on the floor stays.
    vFloor = 1.0 - uFloorStrength * smoothstep(0.02, 0.3, uFloorY - worldPosition.y);
    gl_PointSize = max(vSize, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vSize;
  varying float vFloor;

  void main() {
    float alpha = vFloor;

    if (vSize > 2.5) {
      float radius = length(gl_PointCoord - 0.5) * 2.0;
      alpha *= 1.0 - smoothstep(1.0 - 2.0 / vSize, 1.0, radius);
    }

    if (alpha * uOpacity < 0.002) discard;

    gl_FragColor = vec4(uColor, uOpacity * alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Distance → opacity: full up close, then halving every halfFadeDistance units (see DOT_FIELD).
function opacityAtDistance(distance) {
  if (distance <= DOT_FIELD.nearClear) {
    return 0
  }

  const near = smoothstep(DOT_FIELD.nearClear, DOT_FIELD.nearFull, distance)
  const beyond = Math.max(0, distance - DOT_FIELD.fullOpacityDistance)
  const depthOpacity = Math.max(DOT_FIELD.minOpacity, DOT_FIELD.nearOpacity * Math.pow(0.5, beyond / DOT_FIELD.halfFadeDistance))
  const far = 1 - smoothstep(DOT_FIELD.farFadeStart, DOT_FIELD.farFadeEnd, distance)

  return near * depthOpacity * far
}

function sizeAtDistance(distance) {
  return DOT_FIELD.baseSize + (DOT_FIELD.sizeGrowthPer10 * Math.max(0, distance - 10)) / 10
}

function createPlane(scene, geometry, shared) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(DOT_FIELD.color) },
      uOpacity: { value: 0 },
      uSize: { value: DOT_FIELD.baseSize },
      ...shared,
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.visible = false
  // Drawn after workspace cards: cards write depth, so dots behind a card are hidden while
  // dots in front of it (closer layers) still draw over it.
  points.renderOrder = 1
  scene.add(points)
  return { points, material }
}

// Layer slots that do not coincide with a travel plane (every fourth layer does).
function volumeDepths() {
  const layersPerTravelPlane = Math.round(DOT_FIELD.planeSpacing / WORKSPACE.layerSpacing)
  const depths = []

  for (let layer = 1; layer <= VOLUME.depthLayers; layer += 1) {
    if (layer % layersPerTravelPlane !== 0) {
      depths.push(WORKSPACE.layer0Z - layer * WORKSPACE.layerSpacing)
    }
  }

  return depths
}

export function createDotField(scene) {
  const geometry = createLatticeGeometry(DOT_FIELD.halfExtent, DOT_FIELD.step)
  // Uniform objects shared by every plane. uScale: drawing-buffer height / 2 (the same role as
  // PointsMaterial's "scale"). uFloorY / uFloorStrength: the workspace floor (see setFloor).
  const shared = { uScale: { value: 1 }, uFloorY: { value: 0 }, uFloorStrength: { value: 0 } }
  const travelPlanes = Array.from({ length: DOT_FIELD.planeCount }, () => createPlane(scene, geometry, shared))
  const volumePlanes = volumeDepths().map((z) => ({ ...createPlane(scene, geometry, shared), z }))
  const forward = new THREE.Vector3()

  // Global multiplier used by the intro fade-in and reduced-motion cross-fades.
  let fade = 0
  // 0 outside a project, 1 inside: how present the workspace volume planes are.
  let volume = 0
  // Planes between `top` and `bottom` (e.g. between the workspace camera and layer 0) are
  // multiplied by `visibility`, so dots never float in front of the front layer.
  let band = null

  function placePlane(plane, z, camera, opacityScale) {
    const { step } = DOT_FIELD
    const cameraZ = camera.position.z
    const distance = cameraZ - z
    let opacity = opacityAtDistance(distance) * fade * opacityScale

    if (band && z < band.top && z > band.bottom) {
      opacity *= band.visibility
    }

    // Centre the lattice where the view axis meets this plane, snapped to whole grid steps,
    // so neither panning nor tilting the camera ever reaches a plane edge.
    let centreX = camera.position.x
    let centreY = camera.position.y

    if (forward.z < -1e-6 && distance > 0) {
      const along = (z - cameraZ) / forward.z
      centreX += forward.x * along
      centreY += forward.y * along
    }

    plane.points.position.set(Math.round(centreX / step) * step, Math.round(centreY / step) * step, z)
    plane.material.uniforms.uOpacity.value = opacity
    plane.material.uniforms.uSize.value = sizeAtDistance(distance)
    plane.points.visible = opacity > 0.002
  }

  function update(camera) {
    const { planeSpacing, windowLead } = DOT_FIELD
    const firstSlot = Math.ceil(-(camera.position.z + windowLead) / planeSpacing)
    camera.getWorldDirection(forward)

    travelPlanes.forEach((plane, index) => {
      placePlane(plane, -(firstSlot + index) * planeSpacing, camera, 1)
    })

    volumePlanes.forEach((plane) => {
      placePlane(plane, plane.z, camera, volume * VOLUME.opacityScale)
    })
  }

  return {
    update,
    setPixelScale(value) {
      shared.uScale.value = value
    },
    // Dots below `y` fade out by `strength` (0 – 1): inside a workspace the floor is the bottom.
    setFloor(y, strength) {
      shared.uFloorY.value = y
      shared.uFloorStrength.value = strength
    },
    setFade(value) {
      fade = value
    },
    getFade() {
      return fade
    },
    setVolume(value) {
      volume = value
    },
    setHiddenBand(nextBand) {
      band = nextBand ? { ...nextBand } : null
    },
    /*
     * Where the workspace lattice's dots appear on screen for a camera (front-facing), with the
     * size and brightness each will have: the targets of the "big bang" dust. Returns `count`
     * targets (nearer, brighter dots are more likely), or fewer if fewer dots are in view.
     * Only planes from layer 0 back are used, and only dots on or above `floorY`.
     */
    sampleScreenDots(camera, viewport, { count, floorY = -Infinity }) {
      const { step } = DOT_FIELD
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const scale = viewport.height / 2
      const margin = 4
      const layersPerTravelPlane = Math.round(DOT_FIELD.planeSpacing / WORKSPACE.layerSpacing)
      const depths = [...new Set([WORKSPACE.layer0Z, ...volumeDepths(), ...Array.from({ length: 6 }, (_, k) => WORKSPACE.layer0Z - (k + 1) * DOT_FIELD.planeSpacing)])]
      const toScreenX = (ix, distance) => viewport.width / 2 + ((ix * step - camera.position.x) / (distance * tanHalf)) * scale
      const toScreenY = (iy, distance) => viewport.height / 2 - ((iy * step - camera.position.y) / (distance * tanHalf)) * scale

      // Each plane's dots in view (as a grid range) and its share of the light.
      const planes = []

      depths.forEach((z) => {
        const distance = camera.position.z - z

        if (distance <= DOT_FIELD.nearFull) {
          return
        }

        // Volume planes are drawn at the volume weight; travel planes at full weight.
        const layer = Math.round((WORKSPACE.layer0Z - z) / WORKSPACE.layerSpacing)
        const alpha = opacityAtDistance(distance) * (layer % layersPerTravelPlane === 0 ? 1 : VOLUME.opacityScale)
        const halfHeight = distance * tanHalf
        const halfWidth = halfHeight * (viewport.width / viewport.height)
        const x0 = Math.ceil((camera.position.x - halfWidth) / step)
        const x1 = Math.floor((camera.position.x + halfWidth) / step)
        const y0 = Math.ceil(Math.max(camera.position.y - halfHeight, floorY - 1e-6) / step)
        const y1 = Math.floor((camera.position.y + halfHeight) / step)
        const dots = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1)

        if (alpha >= 0.01 && dots > 0) {
          planes.push({ distance, alpha, x0, x1, y0, y1, dots, size: Math.max(1, (sizeAtDistance(distance) * scale) / distance), weight: dots * alpha })
        }
      })

      const totalWeight = planes.reduce((sum, plane) => sum + plane.weight, 0)
      const out = { count: 0, x: new Float32Array(count), y: new Float32Array(count), size: new Float32Array(count), alpha: new Float32Array(count) }

      // Targets are shared out between the planes by how much light each contributes, then
      // picked at random within each plane (no list of every dot, no sorting).
      planes.forEach((plane) => {
        const share = Math.min(plane.dots, Math.round((count * plane.weight) / Math.max(1e-9, totalWeight)))

        let taken = 0

        // A few spare attempts cover picks that land in the screen margin.
        for (let attempt = 0; attempt < share * 3 && taken < share && out.count < count; attempt += 1) {
          const ix = plane.x0 + Math.floor(Math.random() * (plane.x1 - plane.x0 + 1))
          const iy = plane.y0 + Math.floor(Math.random() * (plane.y1 - plane.y0 + 1))
          const x = toScreenX(ix, plane.distance)
          const y = toScreenY(iy, plane.distance)

          if (x > margin && x < viewport.width - margin && y > margin && y < viewport.height - margin) {
            const i = out.count
            out.x[i] = x
            out.y[i] = y
            out.size[i] = plane.size
            out.alpha[i] = plane.alpha
            out.count += 1
            taken += 1
          }
        }
      })

      return out
    },

    // Anything that changes the rendered image without moving the camera.
    stateKey() {
      const bandKey = band ? `${band.top}|${band.bottom}|${band.visibility}` : ''
      return `${fade}|${volume}|${bandKey}|${shared.uFloorY.value}|${shared.uFloorStrength.value}`
    },
    dispose() {
      ;[...travelPlanes, ...volumePlanes].forEach(({ points, material }) => {
        scene.remove(points)
        material.dispose()
      })
      geometry.dispose()
    },
  }
}
