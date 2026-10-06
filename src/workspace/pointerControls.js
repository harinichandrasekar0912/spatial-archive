import { WORKSPACE } from '../app/constants.js'
import { clamp, easeOutCubic } from '../utils/easing.js'
import { clampCameraZ, clampLayer, fromWorldX, fromWorldY, itemZ, referenceLayer, TAN_HALF_FOV, toWorldLength, toWorldX, toWorldY } from './viewMath.js'

// Wheel heuristics: a mouse wheel sends isolated, large, purely vertical deltas;
// trackpads send small or diagonal deltas. Once a trackpad is detected it is remembered briefly.
const MOUSE_WHEEL_MIN_DELTA = 50
const TRACKPAD_MEMORY_MS = 1000
// Double-press detection is done here rather than with 'dblclick', because pointer capture on
// the canvas retargets click events away from the card.
const DOUBLE_PRESS_MS = 450
const DOUBLE_PRESS_SLOP_PX = 6
const MAX_CARD_EDGE = 2400
// Smallest camera step when flying, so the camera passes through a layer instead of creeping.
const MIN_FLY_STEP = 0.2
const DEG = Math.PI / 180

/*
 * Pointer interaction inside the 3D workspace.
 *   drag card               → move it on its own layer (organisational action, spec §97)
 *   Shift + drag up / down  → push it back / pull it forward one layer per step (spec §107)
 *   drag corner arc         → resize (aspect locked for images and PDFs)
 *   drag the floor dial     → turn the item around its vertical axis, in snapped steps
 *   drag empty space        → pan; nearer layers slide faster than deeper ones (parallax)
 *   mouse wheel / pinch     → fly through the volume towards the pointer
 *   trackpad scroll         → pan
 *   Alt + drag / right-drag → tilt the view to look at the layers; eases back on release
 */
export function attachPointerControls(ctx) {
  const { canvas, scene3d, rig, viewport } = ctx
  const touches = new Map()
  let gesture = null
  let pinch = null
  let lastTrackpadAt = -Infinity
  let lastPress = null
  // Front-facing pose the current tilt returns to (kept if a tilt is re-grabbed mid-return).
  let tiltHome = null

  // setPointerCapture throws if the pointer is no longer active (e.g. already cancelled).
  const capture = (pointerId) => {
    try {
      canvas.setPointerCapture(pointerId)
    } catch {
      // Dragging still works without capture while the pointer stays over the canvas.
    }
  }

  const isFrontFacing = () => {
    const base = rig.getBase()
    return Math.abs(base.yaw) < 1e-4 && Math.abs(base.pitch) < 1e-4
  }

  // Screen pixels per world unit on the reference layer (the nearest layer ahead).
  function referenceScale() {
    const base = rig.getBase()
    const distance = Math.max(0.5, base.z - itemZ(referenceLayer(base.z)))
    return viewport.height / 2 / (distance * TAN_HALF_FOV)
  }

  function panBy(deltaX, deltaY) {
    if (!isFrontFacing()) {
      return
    }

    const base = rig.getBase()
    const scale = referenceScale()
    rig.setBase({ x: base.x - deltaX / scale, y: base.y + deltaY / scale })
  }

  // Fly along the ray through the pointer. factor > 1 moves back, < 1 moves forward.
  function flyBy(clientX, clientY, factor) {
    if (!isFrontFacing() || !Number.isFinite(factor) || factor === 1) {
      return
    }

    const base = rig.getBase()
    const distance = Math.max(0.5, base.z - itemZ(referenceLayer(base.z)))
    let step = distance * (factor - 1)

    if (Math.abs(step) < MIN_FLY_STEP) {
      step = Math.sign(step) * MIN_FLY_STEP
    }

    const targetZ = clampCameraZ(base.z + step)
    const direction = scene3d.rayDirection(clientX, clientY)

    if (targetZ === base.z || direction.z > -1e-3) {
      return
    }

    const along = (targetZ - base.z) / direction.z
    rig.setBase({ x: base.x + direction.x * along, y: base.y + direction.y * along, z: targetZ })
  }

  function startTilt(event) {
    const base = rig.getBase()

    if (!tiltHome || isFrontFacing()) {
      tiltHome = { x: base.x, y: base.y, z: base.z }
    }

    const pivotZ = itemZ(referenceLayer(tiltHome.z))
    gesture = {
      type: 'tilt',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startYaw: base.yaw,
      startPitch: base.pitch,
      pivot: { x: tiltHome.x, y: tiltHome.y, z: pivotZ },
      distance: tiltHome.z - pivotZ,
      moved: false,
    }
  }

  // Orbit around the pivot on the reference layer, looking at it.
  function applyTilt(event) {
    const yaw = clamp(gesture.startYaw + (event.clientX - gesture.startX) * WORKSPACE.tiltDegPerPx * DEG, -WORKSPACE.tiltMaxYawDeg * DEG, WORKSPACE.tiltMaxYawDeg * DEG)
    const pitch = clamp(gesture.startPitch - (event.clientY - gesture.startY) * WORKSPACE.tiltDegPerPx * DEG, -WORKSPACE.tiltMaxPitchDeg * DEG, WORKSPACE.tiltMaxPitchDeg * DEG)
    const { pivot, distance } = gesture
    // Forward vector for rotation order YXZ: (-sin yaw · cos pitch, sin pitch, -cos yaw · cos pitch).
    rig.setBase({
      x: pivot.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      y: pivot.y - Math.sin(pitch) * distance,
      z: pivot.z + Math.cos(yaw) * Math.cos(pitch) * distance,
      yaw,
      pitch,
    })
  }

  function releaseTilt() {
    rig.startMove({
      to: { ...tiltHome, yaw: 0, pitch: 0 },
      travelMs: WORKSPACE.tiltReturnMs,
      travelKeys: ['x', 'y', 'z', 'yaw', 'pitch'],
      ease: easeOutCubic,
      now: performance.now(),
    })
  }

  function resizeTo(current, event) {
    const { item, z, left, top, startWidth, startHeight, rotation } = current
    const record = item.record
    const turned = Math.abs(rotation) > 0.01
    let width
    let height

    if (turned) {
      // Turned cards resize symmetrically in their own plane, so their centre stays on its layer.
      const centre = { x: toWorldX(record.x), y: toWorldY(record.y), z }
      const hit = scene3d.cardPlaneHit(event.clientX, event.clientY, centre, rotation)

      if (!hit) {
        return
      }

      const along = (hit.x - centre.x) * Math.cos(rotation) - (hit.z - centre.z) * Math.sin(rotation)
      width = fromWorldX(Math.abs(along) * 2)
      height = fromWorldX(Math.abs(hit.y - centre.y) * 2)
    } else {
      const hit = scene3d.planeHit(event.clientX, event.clientY, z)

      if (!hit) {
        return
      }

      width = fromWorldX(hit.x - left)
      height = fromWorldX(top - hit.y)
    }

    if (record.type !== 'note') {
      const minScale = WORKSPACE.minCardSize / Math.min(startWidth, startHeight)
      const maxScale = MAX_CARD_EDGE / Math.max(startWidth, startHeight)
      const scale = clamp(Math.max(width / startWidth, height / startHeight), minScale, maxScale)
      width = startWidth * scale
      height = startHeight * scale
    } else {
      width = clamp(width, WORKSPACE.minCardSize, MAX_CARD_EDGE)
      height = clamp(height, WORKSPACE.minCardSize, MAX_CARD_EDGE)
    }

    record.width = Math.round(width)
    record.height = Math.round(height)

    // Front-facing cards keep their top-left corner and grow towards the handle.
    if (!turned) {
      record.x = fromWorldX(left + toWorldLength(record.width) / 2)
      record.y = fromWorldY(top - toWorldLength(record.height) / 2)
    }

    ctx.markDirty()
  }

  function startPinch() {
    if (gesture?.moved && gesture.item) {
      ctx.commit(gesture.item)
    }

    gesture = null
    const [a, b] = [...touches.values()]
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function updatePinch() {
    const [a, b] = [...touches.values()]
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    const x = (a.x + b.x) / 2
    const y = (a.y + b.y) / 2
    panBy(x - pinch.x, y - pinch.y)

    if (distance > 0 && pinch.distance > 0) {
      flyBy(x, y, pinch.distance / distance)
    }

    Object.assign(pinch, { distance, x, y })
  }

  canvas.addEventListener('contextmenu', (event) => {
    if (ctx.isEnabled()) {
      event.preventDefault()
    }
  })

  canvas.addEventListener('pointerdown', (event) => {
    if (!ctx.isEnabled() || event.target.closest('[data-action]')) {
      return
    }

    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (touches.size === 2) {
        startPinch()
        return
      }
    }

    const base = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false }
    capture(event.pointerId)
    event.preventDefault()

    if (event.button === 2 || (event.button === 0 && event.altKey)) {
      startTilt(event)
      return
    }

    if (!isFrontFacing()) {
      return
    }

    // The turn dial lying on the floor in front of the selected item.
    if (event.button === 0 && ctx.getSelected() && ctx.hitsDial(event.clientX, event.clientY)) {
      const item = ctx.getSelected()
      gesture = { ...base, type: 'rotate', item, startRotation: item.record.rotY }
      canvas.classList.add('is-turning')
      return
    }

    if (event.button === 0 && event.target.closest('[data-resize-handle]')) {
      const item = ctx.getSelected()

      if (item) {
        const { record } = item
        gesture = {
          ...base,
          type: 'resize',
          item,
          z: ctx.itemDepth(item),
          left: toWorldX(record.x) - toWorldLength(record.width) / 2,
          top: toWorldY(record.y) + toWorldLength(record.height) / 2,
          startWidth: record.width,
          startHeight: record.height,
          rotation: ctx.itemRotation(item),
        }
      }

      return
    }

    const id = event.button === 0 ? scene3d.pick(event.clientX, event.clientY) : null
    const item = id ? ctx.getItem(id) : null

    if (!item) {
      gesture = { ...base, type: 'pan' }
      // Pressing empty space takes focus off any card (preventDefault stops the browser doing it).
      canvas.focus({ preventScroll: true })
      return
    }

    const now = performance.now()
    // Shift + press always starts a depth drag, never a double-press.
    const isDoublePress =
      !event.shiftKey &&
      lastPress?.id === id &&
      now - lastPress.time < DOUBLE_PRESS_MS &&
      Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < DOUBLE_PRESS_SLOP_PX

    if (isDoublePress) {
      lastPress = null
      ctx.openOrEdit(id)
      return
    }

    lastPress = { id, time: now, x: event.clientX, y: event.clientY }
    ctx.select(id, { focus: true })

    if (event.shiftKey) {
      gesture = { ...base, type: 'depth', item, startLayer: item.record.z }
      ctx.setDepthGuide(item)
      return
    }

    const z = ctx.itemDepth(item)
    const hit = scene3d.planeHit(event.clientX, event.clientY, z)
    gesture = {
      ...base,
      type: 'card',
      item,
      z,
      offsetX: hit ? toWorldX(item.record.x) - hit.x : 0,
      offsetY: hit ? toWorldY(item.record.y) - hit.y : 0,
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    if (pinch) {
      if (touches.size === 2) {
        updatePinch()
      }

      return
    }

    if (!gesture) {
      // Hover feedback only.
      if (ctx.isEnabled() && event.pointerType === 'mouse' && isFrontFacing()) {
        const overDial = Boolean(ctx.getSelected()) && ctx.hitsDial(event.clientX, event.clientY)
        ctx.setDialHover(overDial)
        canvas.classList.toggle('is-over-dial', overDial)
        canvas.classList.toggle('is-over-card', !overDial && Boolean(scene3d.pick(event.clientX, event.clientY)))
      }

      return
    }

    if (event.pointerId !== gesture.pointerId) {
      return
    }

    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY

    if (!gesture.moved && Math.hypot(dx, dy) < WORKSPACE.dragThresholdPx) {
      return
    }

    gesture.moved = true
    lastPress = null

    if (gesture.type === 'tilt') {
      canvas.classList.add('is-tilting')
      applyTilt(event)
    } else if (gesture.type === 'card') {
      const hit = scene3d.planeHit(event.clientX, event.clientY, gesture.z)

      if (hit) {
        gesture.item.record.x = fromWorldX(hit.x + gesture.offsetX)
        gesture.item.record.y = fromWorldY(hit.y + gesture.offsetY)
        canvas.classList.add('is-dragging-card')
        ctx.markDirty()
      }
    } else if (gesture.type === 'depth') {
      // Upwards pushes the card away from you, downwards pulls it closer.
      const steps = Math.round(-dy / WORKSPACE.depthDragPxPerLayer)
      ctx.setLayer(gesture.item, clampLayer(gesture.startLayer + steps))
    } else if (gesture.type === 'rotate') {
      // Dragging right turns the panel's right edge away from you.
      ctx.setRotation(gesture.item, gesture.startRotation + dx * WORKSPACE.rotateDegPerPx)
    } else if (gesture.type === 'resize') {
      resizeTo(gesture, event)
    } else {
      canvas.classList.add('is-panning')
      panBy(event.clientX - gesture.lastX, event.clientY - gesture.lastY)
    }

    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
  })

  function endPointer(event) {
    touches.delete(event.pointerId)

    if (pinch && touches.size < 2) {
      pinch = null
    }

    if (!gesture || event.pointerId !== gesture.pointerId) {
      return
    }

    const finished = gesture
    gesture = null
    canvas.classList.remove('is-panning', 'is-dragging-card', 'is-tilting', 'is-turning')

    if (finished.type === 'tilt') {
      releaseTilt()
      return
    }

    if (finished.type === 'depth') {
      ctx.setDepthGuide(null)
    }

    if (finished.item && (finished.moved || finished.type === 'depth' || finished.type === 'rotate')) {
      ctx.commit(finished.item)
    }

    // A click on empty space clears the selection.
    if (finished.type === 'pan' && !finished.moved && event.type === 'pointerup') {
      ctx.select(null)
    }
  }

  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!ctx.isEnabled()) {
        return
      }

      event.preventDefault()
      const now = performance.now()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      const dx = event.deltaX * unit
      const dy = event.deltaY * unit

      if (event.ctrlKey || event.metaKey) {
        flyBy(event.clientX, event.clientY, Math.exp(dy * WORKSPACE.pinchFlySpeed))
        return
      }

      const looksLikeTrackpad = event.deltaMode === 0 && (dx !== 0 || Math.abs(dy) < MOUSE_WHEEL_MIN_DELTA)

      if (looksLikeTrackpad) {
        lastTrackpadAt = now
      }

      if (looksLikeTrackpad || now - lastTrackpadAt < TRACKPAD_MEMORY_MS) {
        panBy(-dx, -dy)
      } else {
        flyBy(event.clientX, event.clientY, Math.exp(dy * WORKSPACE.flySpeed))
      }
    },
    { passive: false },
  )

  return {
    flyBy,
    cancel() {
      if (gesture?.type === 'tilt') {
        releaseTilt()
      }

      if (gesture?.type === 'depth') {
        ctx.setDepthGuide(null)
      }

      canvas.classList.remove('is-panning', 'is-dragging-card', 'is-tilting', 'is-turning')
      gesture = null
      pinch = null
      touches.clear()
    },
  }
}
