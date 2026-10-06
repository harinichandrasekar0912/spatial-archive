import { clamp, easeInOutCubic, easeOutCubic, lerp, smoothstep } from '../utils/easing.js'

/*
 * Dust choreography for the transitions. Each effect moves a particle set (ui/dustSources.js)
 * through the dust layer (three/DustLayer.js) as a function of time only, so it plays the same
 * at any frame rate. step(now) writes one frame and returns true once the effect is over.
 *
 * The per-grain loops are module-level functions working on a state object (not closures made
 * per effect), so every instance shares the same optimised code: once warmed up at idle (see
 * warmEffects), a transition's first frames are as fast as its last.
 */

const INK = [242 / 255, 241 / 255, 237 / 255]
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4)
const easeInQuad = (t) => t * t

function randoms(count) {
  const values = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    values[i] = Math.random()
  }

  return values
}

function bounds(set) {
  let left = Infinity
  let right = -Infinity

  for (let i = 0; i < set.count; i += 1) {
    left = Math.min(left, set.x[i])
    right = Math.max(right, set.x[i])
  }

  return { left, right, width: Math.max(1, right - left) }
}

function write(buffers, i, x, y, r, g, b, a, size, glow) {
  buffers.position[i * 3] = x
  buffers.position[i * 3 + 1] = y
  buffers.position[i * 3 + 2] = 0
  buffers.tint[i * 4] = r
  buffers.tint[i * 4 + 1] = g
  buffers.tint[i * 4 + 2] = b
  buffers.tint[i * 4 + 3] = a
  buffers.size[i] = size
  buffers.glow[i] = glow
}

const luminance = (set, i) => 0.2126 * set.r[i] + 0.7152 * set.g[i] + 0.0722 * set.b[i]

// ── Fall ──────────────────────────────────────────────────────────────────────────────

function stepFall(s, now) {
  const { set, seed, delays, buffers } = s
  const elapsed = now - s.start
  let alive = 0
  s.onSweep(clamp(elapsed / s.sweepMs))

  for (let i = 0; i < set.count; i += 1) {
    const t = Math.max(0, elapsed - delays[i]) / 1000
    const life = clamp((elapsed - delays[i]) / s.lifeMs)
    // A small lift first, then gravity; each grain drifts a little sideways.
    const vx = (seed[i * 3 + 1] - 0.5) * 46
    const vy = -(14 + seed[i * 3 + 2] * 38)
    const x = set.x[i] + vx * t
    const y = set.y[i] + vy * t + 0.5 * s.gravity * (0.55 + seed[i * 3 + 2] * 0.6) * t * t
    const alpha = set.a[i] * (1 - easeInQuad(life))
    write(buffers, i, x, y, set.r[i], set.g[i], set.b[i], alpha, s.size * (1 - 0.35 * life), 0)
    alive += life < 1 ? 1 : 0
  }

  s.dust.commit()
  return alive === 0
}

/*
 * Crumble and fall: a sweep runs left to right; where it passes, the shape loosens into dust
 * that drifts, falls under gravity and fades. onSweep(progress) lets the caller wipe the real
 * element away in step with the sweep.
 */
export function createFall(dust, set, { start, sweepMs = 300, gravity = 1500, lifeMs = 1100, size = 1.7, onSweep = () => {} }) {
  const { left, width } = bounds(set)
  const seed = randoms(set.count * 3)
  const delays = new Float32Array(set.count)

  for (let i = 0; i < set.count; i += 1) {
    delays[i] = ((set.x[i] - left) / width) * sweepMs + seed[i * 3] * 90
  }

  const state = { dust, set, seed, delays, start, sweepMs, gravity, lifeMs, size, onSweep, buffers: dust.begin(set.count) }
  return { step: (now) => stepFall(state, now) }
}

// ── Assemble ──────────────────────────────────────────────────────────────────────────

function stepAssemble(s, now) {
  const { set, seed, delays, buffers } = s
  const elapsed = now - s.start
  s.onSweep(clamp((elapsed - s.flightMs) / s.sweepMs))

  for (let i = 0; i < set.count; i += 1) {
    const t = clamp((elapsed - delays[i]) / s.flightMs)
    const e = easeOutCubic(t)
    const fromX = set.x[i] + (seed[i * 3 + 1] - 0.5) * 140
    const fromY = s.viewportHeight + 20 + seed[i * 3 + 2] * 160
    const handOff = 1 - smoothstep(0, s.settleMs, elapsed - delays[i] - s.flightMs)
    const alpha = set.a[i] * smoothstep(0, 0.35, t) * handOff
    write(buffers, i, lerp(fromX, set.x[i], e), lerp(fromY, set.y[i], e), set.r[i], set.g[i], set.b[i], alpha, s.size, 0)
  }

  s.dust.commit()
  return elapsed >= s.sweepMs + 80 + s.flightMs + s.settleMs
}

/*
 * Assemble: the reverse of a fall. Dust rises from below the screen and settles into the shape,
 * left to right; onSweep(progress) reveals the real element as each part lands.
 */
export function createAssemble(dust, set, { start, viewportHeight, flightMs = 900, sweepMs = 420, settleMs = 260, size = 1.7, onSweep = () => {} }) {
  const { left, width } = bounds(set)
  const seed = randoms(set.count * 3)
  const delays = new Float32Array(set.count)

  for (let i = 0; i < set.count; i += 1) {
    delays[i] = ((set.x[i] - left) / width) * sweepMs + seed[i * 3] * 80
  }

  const state = { dust, set, seed, delays, start, viewportHeight, flightMs, sweepMs, settleMs, size, onSweep, buffers: dust.begin(set.count) }
  return { step: (now) => stepAssemble(state, now) }
}

// ── Swirl ─────────────────────────────────────────────────────────────────────────────

function stepSwirl(s, now) {
  const { set, seed, radius0, angle0, light, x, y, buffers, centre } = s
  const elapsed = now - s.start
  const loosen = clamp(elapsed / s.loosenMs)

  for (let i = 0; i < set.count; i += 1) {
    // Outer grains set off first, as if the edges were pulled in.
    const delay = s.loosenMs * 0.5 + (1 - Math.min(1, radius0[i] / 260)) * 160 + seed[i * 4] * 140
    const t = clamp((elapsed - delay) / s.swirlMs)
    const e = easeInOutCubic(t)
    const finalRadius = s.discRadius * Math.sqrt(seed[i * 4 + 1])
    // Inward and ever faster around, like matter falling into a well.
    const radius = finalRadius + (radius0[i] - finalRadius) * (1 - e)
    const turn = (1.7 + seed[i * 4 + 2] * 0.7) * Math.PI * e * (1 + 0.6 * e)
    const orbit = (elapsed / 1000) * (2.4 + seed[i * 4 + 3] * 2) * smoothstep(0.85, 1, t)
    const angle = angle0[i] - turn - orbit
    // Before setting off, each grain trembles slightly in place.
    const shiver = loosen * (1 - e) * 1.6
    x[i] = centre.x + Math.cos(angle) * radius + (seed[i * 4 + 3] - 0.5) * shiver
    y[i] = centre.y + Math.sin(angle) * radius + (seed[i * 4 + 2] - 0.5) * shiver
    const kindle = smoothstep(0, 0.7, e)
    const r = lerp(set.r[i], INK[0], kindle)
    const g = lerp(set.g[i], INK[1], kindle)
    const b = lerp(set.b[i], INK[2], kindle)
    const alpha = lerp(set.a[i], lerp(0.16, 0.85, light[i]), kindle) * (1 - 0.2 * e)
    write(buffers, i, x[i], y[i], r, g, b, alpha, s.size * (1 - 0.3 * e), 0)
  }

  s.dust.commit()
  return false
}

/*
 * Swirl: a panel loosens into dust that spirals into the centre of the screen and gathers into
 * a small, bright point, where it keeps turning until released (see createBurst). It starts as
 * the panel itself (each grain its own colour) and kindles into light on the way in: the
 * panel's ink becomes bright grains, its surface a fainter haze. x / y are the grains' current
 * positions, for the hand-off to the burst.
 */
export function createSwirl(dust, set, { start, centre, loosenMs = 260, swirlMs = 1150, discRadius = 7, size = 1.6 }) {
  const radius0 = new Float32Array(set.count)
  const angle0 = new Float32Array(set.count)
  const light = new Float32Array(set.count)

  for (let i = 0; i < set.count; i += 1) {
    const dx = set.x[i] - centre.x
    const dy = set.y[i] - centre.y
    radius0[i] = Math.hypot(dx, dy)
    angle0[i] = Math.atan2(dy, dx)
    // Ink (text, edges) burns bright; the dark surface becomes a faint haze.
    light[i] = smoothstep(0.12, 0.6, luminance(set, i))
  }

  const state = {
    dust,
    set,
    seed: randoms(set.count * 4),
    radius0,
    angle0,
    light,
    x: new Float32Array(set.count),
    y: new Float32Array(set.count),
    start,
    centre,
    loosenMs,
    swirlMs,
    discRadius,
    size,
    buffers: dust.begin(set.count, { blending: 'additive' }),
  }

  return { x: state.x, y: state.y, count: set.count, step: (now) => stepSwirl(state, now) }
}

// ── Burst ─────────────────────────────────────────────────────────────────────────────

function stepBurst(s, now) {
  const { from, targets, seed, buffers, count } = s
  const elapsed = now - s.start

  for (let i = 0; i < count; i += 1) {
    const t = clamp((elapsed - seed[i * 3] * 70) / s.durationMs)
    const e = easeOutQuart(t)
    const tx = targets.x[i]
    const ty = targets.y[i]
    // A slight curve on the way out keeps the burst from looking ruled.
    const bend = Math.sin(Math.PI * e) * (seed[i * 3 + 1] - 0.5) * 60
    const dx = tx - from.x[i]
    const dy = ty - from.y[i]
    const length = Math.hypot(dx, dy) || 1
    const x = lerp(from.x[i], tx, e) + (-dy / length) * bend
    const y = lerp(from.y[i], ty, e) + (dx / length) * bend
    const arrive = smoothstep(0.7, 1, t)
    const fade = 1 - smoothstep(s.durationMs, s.durationMs + s.handOffMs, elapsed)
    const alpha = lerp(0.9, targets.alpha[i], arrive) * fade
    write(buffers, i, x, y, INK[0], INK[1], INK[2], alpha, lerp(2.2, targets.size[i], arrive), 0)
  }

  // The flash: a soft light swelling out of the point and fading.
  const f = clamp(elapsed / 520)
  write(buffers, count, s.centre.x, s.centre.y, INK[0], INK[1], INK[2], 0.55 * (1 - easeOutCubic(f)) * smoothstep(0, 0.05, f), lerp(30, s.flashSize, easeOutCubic(f)), 1)

  s.dust.commit()
  return elapsed >= s.durationMs + s.handOffMs + 60
}

/*
 * Big bang: the gathered point bursts, and every grain flies out to a dot of the workspace
 * lattice (targets, in screen space), arriving with that dot's size and brightness so the real
 * dots can take over. A short flash marks the moment.
 * targets: { count, x, y, size, alpha } (one per grain; grains may share a target).
 */
export function createBurst(dust, from, targets, { start, centre, durationMs = 950, handOffMs = 420, flashSize = 260 }) {
  const count = from.count
  const state = { dust, from, targets, count, seed: randoms(count * 3), start, centre, durationMs, handOffMs, flashSize, buffers: dust.begin(count + 1, { blending: 'additive' }) }
  return { step: (now) => stepBurst(state, now) }
}

// ── Fall away ─────────────────────────────────────────────────────────────────────────

function stepFallAway(s, now) {
  const { set, seed, delays, buffers } = s
  const elapsed = now - s.start
  let alive = 0

  for (let i = 0; i < set.count; i += 1) {
    const t = Math.max(0, elapsed - delays[i]) / 1000
    const vx = (seed[i * 3 + 1] - 0.5) * 40
    const x = set.x[i] + vx * t
    const y = set.y[i] - 18 * t + 0.5 * s.gravity * (0.6 + seed[i * 3 + 2] * 0.55) * t * t
    const fade = 1 - smoothstep(s.viewportHeight * 0.55, s.viewportHeight + 10, y)
    const alpha = set.a[i] * fade * (1 - 0.2 * clamp(t * 2))
    // Whole at first, then breaking into finer grains as it falls.
    write(buffers, i, x, y, set.r[i], set.g[i], set.b[i], alpha, lerp(s.startSize, s.size, smoothstep(0, 0.35, t)), 0)
    alive += y < s.viewportHeight + 10 && alpha > 0.004 ? 1 : 0
  }

  s.dust.commit()
  return alive === 0
}

/*
 * Fall away: the whole view comes apart into dust that drops out of the bottom of the screen,
 * starting slightly earlier near the floor.
 */
export function createFallAway(dust, set, { start, viewportHeight, spreadMs = 420, gravity = 1700, size = 1.6 }) {
  const seed = randoms(set.count * 3)
  const delays = new Float32Array(set.count)

  for (let i = 0; i < set.count; i += 1) {
    delays[i] = seed[i * 3] * spreadMs + (1 - set.y[i] / viewportHeight) * 220
  }

  const startSize = Math.max(size, (set.spacing || size) * 1.05)
  const state = { dust, set, seed, delays, start, viewportHeight, gravity, size, startSize, buffers: dust.begin(set.count) }
  return { step: (now) => stepFallAway(state, now) }
}

// ── Warm-up ───────────────────────────────────────────────────────────────────────────

/*
 * Runs every effect a few times, invisibly (all grains transparent), while the page is idle, so
 * the browser has optimised the per-grain loops and the dust buffers are full size before the
 * first transition needs them; otherwise its opening frames would stutter.
 */
export function warmEffects(dust, { count = 24000, viewport = { width: 1280, height: 800 } } = {}) {
  const set = { count, x: new Float32Array(count), y: new Float32Array(count), r: new Float32Array(count), g: new Float32Array(count), b: new Float32Array(count), a: new Float32Array(count), spacing: 3 }

  // The window can briefly report no size (e.g. a hidden tab); any size will do here.
  const width = Math.max(1, viewport.width || 0)
  const height = Math.max(1, viewport.height || 0)

  for (let i = 0; i < count; i += 1) {
    set.x[i] = (i * 37) % width
    set.y[i] = (i * 53) % height
  }

  const centre = { x: width / 2, y: height / 2 }
  const swirl = createSwirl(dust, set, { start: 0, centre })
  const targets = { count, x: set.x, y: set.y, size: new Float32Array(count).fill(1), alpha: new Float32Array(count) }
  const effects = [
    swirl,
    createBurst(dust, swirl, targets, { start: 0, centre }),
    createFall(dust, set, { start: 0 }),
    createAssemble(dust, set, { start: 0, viewportHeight: height }),
    createFallAway(dust, set, { start: 0, viewportHeight: height }),
  ]

  for (let frame = 1; frame <= 8; frame += 1) {
    effects.forEach((effect) => effect.step(frame * 160))
  }

  dust.end()
}
