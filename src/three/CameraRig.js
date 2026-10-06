import { AMBIENT } from '../app/constants.js'
import { clamp, easeInOutCubic, hermiteToRest, lerp } from '../utils/easing.js'

const POSE_KEYS = ['x', 'y', 'z', 'yaw', 'pitch']
const TAU = Math.PI * 2

/*
 * Owns the camera pose. Three layers combine every frame:
 *   base pose — where the camera "is" (a view depth, or the workspace pan/zoom)
 *   ambient   — the Landing sway (yaw + drift + a trace of pitch), scaled by a weight
 *   move      — an optional choreographed move: recentre → settle → travel
 * Everything is time-based (no per-frame lerp smoothing), so motion is identical at any frame rate.
 */
export function createCameraRig(camera) {
  camera.rotation.order = 'YXZ'

  const base = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: 0, pitch: 0 }
  const pose = { ...base }
  const previousPose = { ...base }
  const velocity = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } // units per millisecond
  let previousNow = null

  const ambient = { weight: 0, tween: null }
  let move = null

  function swayAt(now) {
    const weight = ambient.weight

    if (weight <= 0) {
      return { x: 0, yaw: 0, pitch: 0 }
    }

    return {
      yaw: Math.sin((TAU * now) / AMBIENT.yawPeriodMs) * AMBIENT.maxYaw * weight,
      pitch: Math.sin((TAU * now) / AMBIENT.pitchPeriodMs + 0.6) * AMBIENT.maxPitch * weight,
      x: Math.sin((TAU * now) / AMBIENT.driftPeriodMs + 1.1) * AMBIENT.maxDriftX * weight,
    }
  }

  function update(now) {
    const dt = previousNow === null ? 16.7 : Math.max(1, now - previousNow)
    previousNow = now

    if (ambient.tween) {
      const t = clamp((now - ambient.tween.start) / ambient.tween.duration)
      ambient.weight = lerp(ambient.tween.from, ambient.tween.to, easeInOutCubic(t))

      if (t >= 1) {
        ambient.tween = null
      }
    }

    let status = null

    if (move) {
      const elapsed = now - move.start
      const travelStart = move.recenterMs + move.settleMs
      const recenterT = move.recenterMs > 0 ? clamp(elapsed / move.recenterMs) : 1
      const travelT = move.travelMs > 0 ? clamp((elapsed - travelStart) / move.travelMs) : elapsed >= travelStart ? 1 : 0

      POSE_KEYS.forEach((key) => {
        if (move.travelKeys.includes(key)) {
          // Reduced motion "jumps" at the midpoint, hidden by a cross-fade.
          const eased = move.jump ? (travelT >= 0.5 ? 1 : 0) : move.ease(travelT)
          base[key] = lerp(move.from[key], move.to[key], eased)
        } else if (recenterT >= 1) {
          base[key] = move.to[key]
        } else {
          base[key] = hermiteToRest(move.from[key], move.slopes[key], move.to[key], recenterT)
        }
      })

      let phase = 'travel'

      if (elapsed < move.recenterMs) {
        phase = 'recenter'
      } else if (elapsed < travelStart) {
        phase = 'settle'
      } else if (travelT >= 1) {
        phase = 'done'
      }

      status = { phase, recenterT, travelT }

      if (phase === 'done') {
        POSE_KEYS.forEach((key) => {
          base[key] = move.to[key]
        })
        move = null
      }
    }

    const sway = swayAt(now)
    pose.x = base.x + sway.x
    pose.y = base.y
    pose.z = base.z
    pose.yaw = base.yaw + sway.yaw
    pose.pitch = base.pitch + sway.pitch

    POSE_KEYS.forEach((key) => {
      velocity[key] = (pose[key] - previousPose[key]) / dt
      previousPose[key] = pose[key]
    })

    camera.position.set(pose.x, pose.y, pose.z)
    camera.rotation.set(pose.pitch, pose.yaw, 0)
    camera.updateMatrixWorld()

    return status
  }

  return {
    update,

    /*
     * Choreographed move. Keys listed in travelKeys ease in-out during the travel phase;
     * every other key winds down to its target during the recentre phase, leaving with the
     * camera's current velocity so the hand-off from ambient sway is seamless.
     */
    startMove({ to, recenterMs = 0, settleMs = 0, travelMs = 0, travelKeys = ['z'], jump = false, ease = easeInOutCubic, now }) {
      POSE_KEYS.forEach((key) => {
        base[key] = pose[key]
      })
      ambient.weight = 0
      ambient.tween = null

      const slopes = {}
      POSE_KEYS.forEach((key) => {
        slopes[key] = velocity[key] * recenterMs
      })

      move = { from: { ...base }, to: { ...base, ...to }, slopes, start: now, recenterMs, settleMs, travelMs, travelKeys, jump, ease }
    },

    isMoving() {
      return move !== null
    },

    cancelMove() {
      move = null
    },

    setAmbient(target, durationMs, now) {
      ambient.tween = { from: ambient.weight, to: target, start: now, duration: Math.max(1, durationMs) }
    },

    // Direct placement (workspace pan / zoom). Cancels any running move.
    setBase(next) {
      move = null
      Object.assign(base, next)
    },

    getBase() {
      return { ...base }
    },

    getPose() {
      return { ...pose }
    },
  }
}
