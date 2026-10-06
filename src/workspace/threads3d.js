import * as THREE from 'three'
import { THREAD, THREAD_COLORS } from '../app/constants.js'
import { clamp } from '../utils/easing.js'
import { sharedUniforms } from './cardMaterials.js'

/*
 * Threads (spec §100–102). A connection is drawn as a slightly loose thread hung between two
 * things: a small rope simulation (Verlet integration, THREAD.points points, both ends tied)
 * pulled down by gravity, so it settles into a shallow curve with its lowest point between the
 * two ends, sways when an end moves, and rests on the floor instead of passing through it.
 * Ropes sleep once settled, so a still workspace costs nothing.
 *
 * Each thread is a ribbon that always faces the camera, with a true on-screen width (round,
 * softly anti-aliased edges and a faint highlight along its middle, like a fibre), plus a
 * scatter of tiny gold specks that glint as the view moves, like gilt thread catching the light.
 */

const N = THREAD.points
const colorOf = (id) => THREAD_COLORS.find((color) => color.id === id)?.color || THREAD_COLORS[0].color

const ribbonVertexShader = /* glsl */ `
  uniform vec2 uViewport;
  uniform float uWidth;
  uniform float uWiden;
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute float aSide;
  varying float vSide;
  varying float vHalfPx;
  varying float vDistance;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;
    vec4 clipPrev = projectionMatrix * modelViewMatrix * vec4(aPrev, 1.0);
    vec4 clipNext = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);

    // The ribbon is widened across the thread's direction on screen.
    vec2 aspect = vec2(uViewport.x / uViewport.y, 1.0);
    vec2 direction = clipNext.xy / clipNext.w * aspect - clipPrev.xy / clipPrev.w * aspect;
    direction = length(direction) > 1e-6 ? normalize(direction) : vec2(1.0, 0.0);
    vec2 normal = vec2(-direction.y, direction.x);

    // A real thickness in the world, kept between a hairline and a few pixels on screen.
    float focalPx = projectionMatrix[1][1] * uViewport.y * 0.5;
    float widthPx = clamp(uWidth * focalPx / max(0.05, -mvPosition.z), ${THREAD.minWidthPx.toFixed(2)}, ${THREAD.maxWidthPx.toFixed(2)}) * uWiden;
    float halfPx = widthPx * 0.5 + 1.0;
    clip.xy += normal / aspect * (halfPx * 2.0 / uViewport.y) * clip.w * aSide;

    gl_Position = clip;
    vSide = aSide;
    vHalfPx = halfPx;
    vDistance = length(mvPosition.xyz);
  }
`

const ribbonFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLift;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uPresence;
  varying float vSide;
  varying float vHalfPx;
  varying float vDistance;

  void main() {
    float halfCore = vHalfPx - 1.0;
    float fromCentre = abs(vSide) * vHalfPx;
    float coverage = clamp(halfCore + 0.5 - fromCentre, 0.0, 1.0);
    // Round in section: brighter along the middle, softer towards the edges.
    float across = clamp(fromCentre / max(halfCore, 0.5), 0.0, 1.0);
    float sheen = sqrt(1.0 - across * across);
    vec3 color = uColor * (0.8 + 0.28 * sheen) + uLift * 0.16;
    float fog = smoothstep(uFogNear, uFogFar, vDistance) * 0.85;
    float alpha = coverage * uOpacity * uPresence * (1.0 - fog) * smoothstep(0.45, 1.7, vDistance);

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(mix(color, uFogColor, fog * 0.4), alpha);
    #include <colorspace_fragment>
  }
`

const speckVertexShader = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uLift;
  attribute float aSeed;
  varying float vGlint;
  varying float vDistance;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Each speck catches the light at its own camera positions, like glitter.
    float phase = dot(cameraPosition, vec3(1.7, 1.15, 0.6)) * (0.5 + 1.5 * fract(aSeed * 13.7)) + aSeed * 61.0;
    vGlint = pow(0.5 + 0.5 * sin(phase), 5.0);
    float size = mix(1.0, 1.7, fract(aSeed * 7.13)) + vGlint * 0.9 + uLift * 0.3;
    gl_PointSize = size * uPixelRatio;
    vDistance = length(mvPosition.xyz);
  }
`

const speckFragmentShader = /* glsl */ `
  uniform vec3 uGold;
  uniform vec3 uGoldLight;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uPresence;
  varying float vGlint;
  varying float vDistance;

  void main() {
    float shape = 1.0 - smoothstep(0.6, 1.0, length(gl_PointCoord - 0.5) * 2.0);
    float fog = smoothstep(uFogNear, uFogFar, vDistance) * 0.85;
    float alpha = shape * (0.72 + 0.28 * vGlint) * uOpacity * uPresence * (1.0 - fog) * smoothstep(0.45, 1.7, vDistance);

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(mix(uGold, uGoldLight, vGlint), alpha);
    #include <colorspace_fragment>
  }
`

// How long a thread between two points is: a little longer than the straight line.
function lengthFor(chord) {
  return chord * (THREAD.slack + THREAD.shortSlack * clamp(1 - chord / THREAD.shortLength))
}

// Seeded random numbers, so a thread's specks stay where they are between visits.
function seededRandom(text) {
  let seed = 2166136261

  for (let i = 0; i < text.length; i += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619)
  }

  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507)
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909)
    seed ^= seed >>> 16
    return (seed >>> 0) / 4294967296
  }
}

function createRibbon(viewport) {
  const geometry = new THREE.BufferGeometry()
  const vertexCount = N * 2
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aPrev', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aNext', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(Array.from({ length: vertexCount }, (_, i) => (i % 2 ? 1 : -1))), 1))
  const index = []

  for (let i = 0; i < N - 1; i += 1) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }

  geometry.setIndex(index)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uViewport: viewport,
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
      uWidth: { value: THREAD.width },
      uWiden: { value: 1 },
      uLift: { value: 0 },
    },
    vertexShader: ribbonVertexShader,
    fragmentShader: ribbonFragmentShader,
    transparent: true,
    depthWrite: false,
    // The ribbon's winding depends on which way the thread runs on screen.
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}

function createSpecks(count, random, pixelRatio) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(Array.from({ length: count }, () => random())), 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uPixelRatio: pixelRatio,
      uGold: { value: new THREE.Color(THREAD.speckColor) },
      uGoldLight: { value: new THREE.Color(THREAD.speckLight) },
      uOpacity: { value: 0 },
      uLift: { value: 0 },
    },
    vertexShader: speckVertexShader,
    fragmentShader: speckFragmentShader,
    transparent: true,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 3
  return points
}

export function createThreads(spatial, { reducedMotion = false } = {}) {
  const { world, camera, viewport, renderer } = spatial
  const root = new THREE.Group()
  world.add(root)

  // Shared uniform objects: the viewport in CSS pixels and the device pixel ratio.
  const viewportUniform = { value: new THREE.Vector2(1, 1) }
  const pixelRatioUniform = { value: 1 }
  const ropes = new Map()
  // Loose pieces of cut or dropped threads, falling before they fade: { rope, at }.
  const pieces = []
  const projected = new THREE.Vector3()
  let draft = null
  let selectedId = null
  let hoveredId = null
  let floorY = -Infinity
  let lastNow = null
  let accumulator = 0

  function createRope(id, color, a, b, { fromRope = null } = {}) {
    const rope = {
      id,
      color: null,
      pos: new Float32Array(N * 3),
      prev: new Float32Array(N * 3),
      a: new THREE.Vector3().copy(a),
      b: new THREE.Vector3().copy(b),
      // The far end hangs free (a dropped thread falling away).
      freeEnd: false,
      rest: 0,
      awake: true,
      still: 0,
      opacity: 0,
      target: 1,
      removing: null,
      ribbon: createRibbon(viewportUniform),
      specks: null,
      speckAt: null,
      lift: 0,
    }

    setRopeColor(rope, color)

    if (fromRope) {
      rope.pos.set(fromRope.pos)
      rope.prev.set(fromRope.prev)
      rope.opacity = fromRope.opacity
    } else {
      layOut(rope)
    }

    // Specks: fixed places along the thread (seeded by its id) and a little apart.
    const random = seededRandom(id)
    const chord = rope.a.distanceTo(rope.b)
    const count = clamp(Math.round(lengthFor(chord) * THREAD.specksPerUnit), 6, THREAD.maxSpecks)
    rope.speckAt = Float32Array.from({ length: count }, () => 0.03 + random() * 0.94)
    rope.speckOffset = Float32Array.from({ length: count }, () => (random() - 0.5) * 0.006)
    rope.specks = createSpecks(count, random, pixelRatioUniform)

    root.add(rope.ribbon, rope.specks)
    writeGeometry(rope)
    return rope
  }

  // Lays the thread out at rest: a parabola with the sag its slack gives it.
  function layOut(rope) {
    const chord = rope.a.distanceTo(rope.b)
    const length = lengthFor(chord)
    const sag = Math.sqrt(Math.max(0, (3 * chord * (length - chord)) / 8))
    rope.rest = length / (N - 1)

    for (let i = 0; i < N; i += 1) {
      const t = i / (N - 1)
      const k = i * 3
      rope.pos[k] = rope.a.x + (rope.b.x - rope.a.x) * t
      rope.pos[k + 1] = Math.max(floorY, rope.a.y + (rope.b.y - rope.a.y) * t - 4 * sag * t * (1 - t))
      rope.pos[k + 2] = rope.a.z + (rope.b.z - rope.a.z) * t
    }

    rope.prev.set(rope.pos)
  }

  function setRopeColor(rope, color) {
    if (rope.color !== color) {
      rope.color = color
      rope.ribbon.material.uniforms.uColor.value.set(colorOf(color))
    }
  }

  // One Verlet step: move, then satisfy the segment lengths, the tied ends and the floor.
  function step(rope, dt) {
    const { pos, prev } = rope
    const gravity = THREAD.gravity * dt * dt
    const last = N - 1
    let moved = 0

    for (let i = 1; i < (rope.freeEnd ? N : last); i += 1) {
      const k = i * 3
      const x = pos[k]
      const y = pos[k + 1]
      const z = pos[k + 2]
      pos[k] = x + (x - prev[k]) * THREAD.damping
      pos[k + 1] = y + (y - prev[k + 1]) * THREAD.damping - gravity
      pos[k + 2] = z + (z - prev[k + 2]) * THREAD.damping
      prev[k] = x
      prev[k + 1] = y
      prev[k + 2] = z
    }

    pos[0] = rope.a.x
    pos[1] = rope.a.y
    pos[2] = rope.a.z

    if (!rope.freeEnd) {
      pos[last * 3] = rope.b.x
      pos[last * 3 + 1] = rope.b.y
      pos[last * 3 + 2] = rope.b.z
    }

    for (let iteration = 0; iteration < THREAD.iterations; iteration += 1) {
      // Alternate directions so neither end is favoured.
      const forward = iteration % 2 === 0

      for (let n = 0; n < last; n += 1) {
        const i = forward ? n : last - 1 - n
        const k = i * 3
        const j = k + 3
        const dx = pos[j] - pos[k]
        const dy = pos[j + 1] - pos[k + 1]
        const dz = pos[j + 2] - pos[k + 2]
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9
        const difference = (distance - rope.rest) / distance
        const pinnedA = i === 0
        const pinnedB = i + 1 === last && !rope.freeEnd
        const shareA = pinnedA ? 0 : pinnedB ? 1 : 0.5
        const shareB = pinnedB ? 0 : pinnedA ? 1 : 0.5

        pos[k] += dx * difference * shareA
        pos[k + 1] += dy * difference * shareA
        pos[k + 2] += dz * difference * shareA
        pos[j] -= dx * difference * shareB
        pos[j + 1] -= dy * difference * shareB
        pos[j + 2] -= dz * difference * shareB
      }

      // The floor holds the thread up (with a little friction).
      for (let i = 1; i < N; i += 1) {
        const k = i * 3

        if (pos[k + 1] < floorY) {
          pos[k + 1] = floorY
          prev[k] += (pos[k] - prev[k]) * 0.4
          prev[k + 2] += (pos[k + 2] - prev[k + 2]) * 0.4
        }
      }
    }

    // How far the loose points moved in this step (the tied ends follow their items).
    for (let i = 3; i < (rope.freeEnd ? N : last) * 3; i += 1) {
      moved = Math.max(moved, Math.abs(pos[i] - prev[i]))
    }

    return moved
  }

  function writeGeometry(rope) {
    const geometry = rope.ribbon.geometry
    const position = geometry.attributes.position.array
    const previous = geometry.attributes.aPrev.array
    const next = geometry.attributes.aNext.array
    const { pos } = rope

    for (let i = 0; i < N; i += 1) {
      const k = i * 3
      const p = Math.max(0, i - 1) * 3
      const q = Math.min(N - 1, i + 1) * 3

      for (let side = 0; side < 2; side += 1) {
        const v = (i * 2 + side) * 3
        position[v] = pos[k]
        position[v + 1] = pos[k + 1]
        position[v + 2] = pos[k + 2]
        previous[v] = pos[p]
        previous[v + 1] = pos[p + 1]
        previous[v + 2] = pos[p + 2]
        next[v] = pos[q]
        next[v + 1] = pos[q + 1]
        next[v + 2] = pos[q + 2]
      }
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aPrev.needsUpdate = true
    geometry.attributes.aNext.needsUpdate = true

    // Specks sit on the thread at their own places along it.
    const specks = rope.specks.geometry.attributes.position
    const speckPositions = specks.array

    for (let s = 0; s < rope.speckAt.length; s += 1) {
      const along = rope.speckAt[s] * (N - 1)
      const i = Math.min(N - 2, Math.floor(along))
      const f = along - i
      const k = i * 3
      speckPositions[s * 3] = pos[k] + (pos[k + 3] - pos[k]) * f
      speckPositions[s * 3 + 1] = pos[k + 1] + (pos[k + 4] - pos[k + 1]) * f + rope.speckOffset[s]
      speckPositions[s * 3 + 2] = pos[k + 2] + (pos[k + 5] - pos[k + 2]) * f
    }

    specks.needsUpdate = true
  }

  // Lays a rope's points evenly along a polyline (points: [[x, y, z], …]).
  function resampleInto(rope, points) {
    const lengths = [0]

    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay, az] = points[i - 1]
      const [bx, by, bz] = points[i]
      lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay, bz - az))
    }

    const total = lengths.at(-1) || 1e-6
    let segment = 1

    for (let i = 0; i < N; i += 1) {
      const distance = (total * i) / (N - 1)

      while (segment < points.length - 1 && lengths[segment] < distance) {
        segment += 1
      }

      const span = lengths[segment] - lengths[segment - 1] || 1e-6
      const f = clamp((distance - lengths[segment - 1]) / span)
      const a = points[segment - 1]
      const b = points[segment]
      rope.pos[i * 3] = a[0] + (b[0] - a[0]) * f
      rope.pos[i * 3 + 1] = a[1] + (b[1] - a[1]) * f
      rope.pos[i * 3 + 2] = a[2] + (b[2] - a[2]) * f
    }

    rope.prev.set(rope.pos)
    rope.rest = total / (N - 1)
  }

  function dispose(rope) {
    root.remove(rope.ribbon, rope.specks)
    rope.ribbon.geometry.dispose()
    rope.ribbon.material.dispose()
    rope.specks.geometry.dispose()
    rope.specks.material.dispose()
  }

  // Moves a rope's tied ends; wakes it if they moved.
  function tie(rope, a, b) {
    const moved = rope.a.distanceToSquared(a) > 1e-10 || (!rope.freeEnd && rope.b.distanceToSquared(b) > 1e-10)
    rope.a.copy(a)

    if (!rope.freeEnd) {
      rope.b.copy(b)
    }

    if (moved) {
      rope.awake = true
      rope.still = 0
    }

    if (!rope.freeEnd) {
      const rest = lengthFor(rope.a.distanceTo(rope.b)) / (N - 1)

      if (Math.abs(rest - rope.rest) > 1e-6) {
        rope.rest = rest
        rope.awake = true
        rope.still = 0
      }
    }
  }

  function applyLook(rope, dtMs) {
    const highlight = rope.id === selectedId ? 1 : rope.id === hoveredId ? 0.55 : 0
    rope.lift += (highlight - rope.lift) * (1 - Math.exp(-dtMs / 60))

    if (Math.abs(highlight - rope.lift) < 0.002) {
      rope.lift = highlight
    }

    const ribbon = rope.ribbon.material.uniforms
    ribbon.uOpacity.value = rope.opacity
    ribbon.uWiden.value = 1 + 0.45 * rope.lift
    ribbon.uLift.value = rope.lift
    rope.specks.material.uniforms.uOpacity.value = rope.opacity
    rope.specks.material.uniforms.uLift.value = rope.lift
  }

  function screenOf(x, y, z) {
    projected.set(x, y, z).project(camera)
    return { x: (projected.x + 1) * 0.5 * viewport.width, y: (1 - projected.y) * 0.5 * viewport.height, behind: projected.z > 1 }
  }

  return {
    /*
     * Called every frame. ends: [{ id, color, a, b, visibility }] for every thread that should
     * exist (a, b: world positions of its ties). Returns true while anything moves or fades.
     */
    update(now, ends, { floor = -Infinity } = {}) {
      const dtMs = lastNow === null ? 16 : clamp(now - lastNow, 0, 100)
      lastNow = now
      floorY = floor + 0.01
      viewportUniform.value.set(viewport.width, viewport.height)
      pixelRatioUniform.value = renderer.getPixelRatio()
      let busy = false
      const wanted = new Set()

      for (const end of ends) {
        wanted.add(end.id)
        let rope = ropes.get(end.id)

        if (!rope) {
          rope = createRope(end.id, end.color, end.a, end.b)
          ropes.set(end.id, rope)
        }

        rope.removing = null
        rope.target = end.visibility
        setRopeColor(rope, end.color)
        tie(rope, end.a, end.b)
      }

      ropes.forEach((rope, id) => {
        if (!wanted.has(id) && !rope.removing) {
          rope.removing = true
          rope.target = 0
        }
      })

      // Fixed steps, so the thread behaves the same at any frame rate.
      accumulator = Math.min(accumulator + dtMs, THREAD.stepMs * 4)
      const steps = Math.floor(accumulator / THREAD.stepMs)
      accumulator -= steps * THREAD.stepMs
      const dt = THREAD.stepMs / 1000

      const all = draft ? [...ropes.values(), draft.rope] : [...ropes.values()]

      for (const rope of all) {
        // Reduced motion: a thread takes its resting curve at once, without swaying into it.
        if (rope.awake && reducedMotion && !rope.freeEnd) {
          layOut(rope)
          rope.awake = false
          writeGeometry(rope)
          busy = true
        }

        if (rope.awake) {
          let moved = 0

          for (let s = 0; s < steps; s += 1) {
            moved = step(rope, dt)
          }

          // Asleep after a quarter of a second of (almost) no movement.
          rope.still = moved < 2e-5 ? rope.still + steps : 0
          rope.awake = rope.still < 30
          writeGeometry(rope)
          busy = true
        }

        const fadeStep = dtMs / THREAD.fadeMs
        const previous = rope.opacity
        rope.opacity = rope.opacity < rope.target ? Math.min(rope.target, rope.opacity + fadeStep) : Math.max(rope.target, rope.opacity - fadeStep)
        busy ||= previous !== rope.opacity || Math.abs(rope.lift - (rope.id === selectedId ? 1 : rope.id === hoveredId ? 0.55 : 0)) > 0.002
        applyLook(rope, dtMs)
      }

      ropes.forEach((rope, id) => {
        if (rope.removing && rope.opacity <= 0) {
          dispose(rope)
          ropes.delete(id)
        }
      })

      if (draft) {
        busy = true

        if (draft.dropping && now - draft.dropping > THREAD.dropFadeDelayMs) {
          draft.rope.target = 0

          if (draft.rope.opacity <= 0) {
            dispose(draft.rope)
            draft = null
          }
        }
      }

      // Cut pieces fall from where they were tied, then fade.
      for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const piece = pieces[index]
        const rope = piece.rope
        busy = true

        for (let s = 0; s < steps; s += 1) {
          step(rope, dt)
        }

        writeGeometry(rope)

        if (now - piece.at > THREAD.dropFadeDelayMs) {
          rope.target = 0
        }

        rope.opacity = Math.max(rope.target, rope.opacity - dtMs / THREAD.dropFadeMs)
        applyLook(rope, dtMs)

        if (rope.opacity <= 0) {
          dispose(rope)
          pieces.splice(index, 1)
        }
      }

      return busy
    },

    // A thread being pulled out of an item's node: tied at `a`, its other end at `b`.
    setDraft({ a, b, color }) {
      if (!draft || draft.dropping) {
        if (draft) {
          dispose(draft.rope)
        }

        draft = { rope: createRope(`draft-${performance.now()}`, color, a, b), dropping: null }
        draft.rope.opacity = 0.9
      }

      draft.rope.target = 0.9
      tie(draft.rope, a, b)
    },

    // Let go of the draft: its loose end falls, then it fades away (at once, with reduced motion).
    dropDraft() {
      if (draft && !draft.dropping) {
        draft.rope.freeEnd = !reducedMotion
        draft.rope.awake = true
        draft.rope.still = 0
        draft.dropping = performance.now() - (reducedMotion ? THREAD.dropFadeDelayMs : 0)
      }
    },

    // The draft becomes a real thread (it keeps its shape, so nothing jumps).
    adoptDraft(id) {
      if (!draft || draft.dropping) {
        return
      }

      const rope = draft.rope
      root.remove(rope.ribbon, rope.specks)
      const adopted = createRope(id, rope.color, rope.a, rope.b, { fromRope: rope })
      dispose(rope)
      ropes.set(id, adopted)
      draft = null
    },

    // Cuts a thread in the middle: each half hangs from where it was tied, falls and fades.
    snip(id) {
      const rope = ropes.get(id)

      // With reduced motion the thread simply fades (see update); otherwise its halves fall.
      if (!rope || reducedMotion) {
        return
      }

      const middle = Math.floor(N / 2)
      const point = (i) => [rope.pos[i * 3], rope.pos[i * 3 + 1], rope.pos[i * 3 + 2]]
      const halves = [
        Array.from({ length: middle + 1 }, (_, i) => point(i)),
        Array.from({ length: N - middle }, (_, i) => point(N - 1 - i)),
      ]

      halves.forEach((points, index) => {
        const [first, last] = [points[0], points.at(-1)]
        const piece = createRope(`${id}-piece-${index}`, rope.color, new THREE.Vector3(...first), new THREE.Vector3(...last))
        resampleInto(piece, points)
        piece.freeEnd = true
        piece.opacity = rope.opacity
        piece.target = rope.opacity
        writeGeometry(piece)
        pieces.push({ rope: piece, at: performance.now() })
      })

      ropes.delete(id)
      dispose(rope)
    },

    setSelected(id) {
      selectedId = id
    },

    setHovered(id) {
      hoveredId = id
    },

    /*
     * The thread nearest a screen point, if within reach: { id, z } (z: the world depth of the
     * nearest point, to compare with a card under the same point), or null.
     */
    pick(clientX, clientY) {
      let best = null
      const reach = THREAD.pickPx

      ropes.forEach((rope) => {
        if (rope.removing || rope.opacity < 0.5) {
          return
        }

        let previous = null

        for (let i = 0; i < N; i += 2) {
          const k = Math.min(i, N - 1) * 3
          const point = screenOf(rope.pos[k], rope.pos[k + 1], rope.pos[k + 2])
          point.z = rope.pos[k + 2]

          if (previous && !point.behind && !previous.behind) {
            const dx = point.x - previous.x
            const dy = point.y - previous.y
            const lengthSquared = dx * dx + dy * dy || 1
            const t = clamp(((clientX - previous.x) * dx + (clientY - previous.y) * dy) / lengthSquared)
            const distance = Math.hypot(previous.x + dx * t - clientX, previous.y + dy * t - clientY)

            if (distance <= reach && (!best || distance < best.distance)) {
              best = { id: rope.id, z: previous.z + (point.z - previous.z) * t, distance }
            }
          }

          previous = point
        }
      })

      return best
    },

    // Screen position of a point along a thread (t from 0 at its first tie to 1 at its second).
    pointAt(id, t) {
      const rope = ropes.get(id)

      if (!rope) {
        return null
      }

      const k = Math.round(clamp(t) * (N - 1)) * 3
      return screenOf(rope.pos[k], rope.pos[k + 1], rope.pos[k + 2])
    },

    has: (id) => ropes.has(id) && !ropes.get(id).removing,

    clear() {
      ropes.forEach(dispose)
      ropes.clear()
      pieces.forEach((piece) => dispose(piece.rope))
      pieces.length = 0

      if (draft) {
        dispose(draft.rope)
        draft = null
      }

      selectedId = null
      hoveredId = null
    },
  }
}
