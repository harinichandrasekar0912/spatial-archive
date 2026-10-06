import { DOT_GLOW } from '../app/constants.js'
import { clamp } from '../utils/easing.js'

/*
 * Landing and Projects: the dots near the pointer brighten like stars and dim again once it has
 * passed. The glow follows the pointer (eased a little, so it glides) and leaves a short trail
 * of samples that fade over DOT_GLOW.trailDecayMs; the dot shader lights each dot by its nearest
 * sample (see DotField). Mouse and pen only: a finger on a touch screen is navigating.
 */
export function createDotGlow(scene, { isEnabled, reducedMotion = false }) {
  const { dotField, viewport } = scene
  const pointer = { x: 0, y: 0, inside: false }
  const head = { x: 0, y: 0, placed: false }
  // Older positions, newest last: { x, y, time }.
  const trail = []
  let strength = 0
  let lastNow = null

  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') {
        return
      }

      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.inside = true

      if (!head.placed) {
        head.x = pointer.x
        head.y = pointer.y
        head.placed = true
      }
    },
    { passive: true },
  )

  // Leaving the window (relatedTarget is null when the pointer exits the page itself).
  document.addEventListener('mouseout', (event) => {
    if (!event.relatedTarget) {
      pointer.inside = false
    }
  })
  window.addEventListener('blur', () => {
    pointer.inside = false
  })

  scene.onFrame((now) => {
    const dt = lastNow === null ? 16 : clamp(now - lastNow, 0, 100)
    lastNow = now

    const target = pointer.inside && head.placed && isEnabled() ? 1 : 0
    // Exponential approach; the time constants are a third of the stated fade times.
    const fadeMs = target > strength ? DOT_GLOW.fadeInMs : DOT_GLOW.fadeOutMs
    strength += (target - strength) * (1 - Math.exp((-3 * dt) / fadeMs))

    if (target === 0 && strength < 0.002) {
      strength = 0
    }

    if (strength === 0) {
      trail.length = 0

      if (head.placed) {
        head.x = pointer.x
        head.y = pointer.y
      }

      dotField.setGlow({ strength: 0 })
      return
    }

    const follow = 1 - Math.exp(-dt / DOT_GLOW.followMs)
    head.x += (pointer.x - head.x) * follow
    head.y += (pointer.y - head.y) * follow

    const newest = trail.at(-1)

    if (!newest || Math.hypot(head.x - newest.x, head.y - newest.y) > DOT_GLOW.trailSpacingPx) {
      trail.push({ x: head.x, y: head.y, time: now })

      if (trail.length > DOT_GLOW.trailSamples - 1) {
        trail.shift()
      }
    }

    const points = [{ x: head.x, y: head.y, weight: 1 }]

    for (let index = trail.length - 1; index >= 0; index -= 1) {
      const weight = Math.exp(-(now - trail[index].time) / DOT_GLOW.trailDecayMs)

      if (weight > 0.02) {
        points.push({ x: trail[index].x, y: trail[index].y, weight })
      }
    }

    dotField.setGlow({
      // The field's own fade (intro, transitions) dims the glow with it.
      strength: strength * dotField.getFade(),
      points,
      radius: DOT_GLOW.radiusPx * clamp(viewport.height / 900, 0.7, 1.5),
      // Reduced motion keeps the glow but not the twinkle.
      time: reducedMotion ? 0 : now / 1000,
    })
  })
}
