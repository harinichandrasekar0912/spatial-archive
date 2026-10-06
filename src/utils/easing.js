export const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max)

export const lerp = (from, to, t) => from + (to - from) * t

// Normalised position of `value` inside [start, end], clamped to 0–1.
export const progressBetween = (value, start, end) => clamp((value - start) / Math.max(1e-6, end - start))

export const smoothstep = (edge0, edge1, value) => {
  const t = progressBetween(value, edge0, edge1)
  return t * t * (3 - 2 * t)
}

export const easeInCubic = (t) => t * t * t
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
// Equivalent to cubic-bezier(0.22, 1, 0.36, 1), the curve the Create form originally used.
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5)

/*
 * A CSS-style cubic-bezier(x1, y1, x2, y2) timing function: solves the curve's x for t
 * (Newton's method with a bisection fallback) and returns its y.
 */
export function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u
  const sampleY = (u) => ((ay * u + by) * u + cy) * u
  const slopeX = (u) => (3 * ax * u + 2 * bx) * u + cx

  return (t) => {
    if (t <= 0 || t >= 1) {
      return clamp(t)
    }

    let u = t

    for (let i = 0; i < 6; i += 1) {
      const error = sampleX(u) - t
      const slope = slopeX(u)

      if (Math.abs(error) < 1e-6) {
        return sampleY(u)
      }

      if (Math.abs(slope) < 1e-6) {
        break
      }

      u -= error / slope
    }

    let low = 0
    let high = 1
    u = t

    for (let i = 0; i < 24; i += 1) {
      const x = sampleX(u)

      if (Math.abs(x - t) < 1e-6) {
        break
      }

      if (x < t) {
        low = u
      } else {
        high = u
      }

      u = (low + high) / 2
    }

    return sampleY(u)
  }
}

/*
 * Cubic Hermite segment from p0 (leaving with slope m0) to p1 (arriving at rest).
 * m0 is the starting velocity multiplied by the segment duration. Used to wind the
 * ambient camera sway down without a visible velocity jump when navigation begins.
 */
export function hermiteToRest(p0, m0, p1, t) {
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1
}

export function prefersReducedMotion() {
  // Development aid: append ?reduced-motion to the URL to preview the reduced-motion variant.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('reduced-motion')) {
    return true
  }

  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
