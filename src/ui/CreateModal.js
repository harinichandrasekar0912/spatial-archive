import { CREATE_MODAL, THEME } from '../app/constants.js'
import { clamp, cubicBezier, easeOutCubic, lerp, smoothstep } from '../utils/easing.js'

// A quick, swishing start that lands softly; closing eases in and out back into the plus.
const OPEN_EASE = cubicBezier(0.2, 0.85, 0.25, 1)
const CLOSE_EASE = cubicBezier(0.55, 0, 0.3, 1)
const FORM_RADIUS_PX = 24

/*
 * Create Project form (spec §73–84).
 * One "presence" value drives everything: 0 = the plus of the Create tile, 1 = the full form at
 * the viewport centre. Opening, the form swishes out of the plus along a gentle arc: it starts
 * at the plus's own size and roundness, tilted back and slightly blurred, and grows into place
 * as the tilt and blur fall away; its contents settle in last. Every close path plays the same
 * motion back into the plus, and an interrupted animation reverses from where it is.
 */
export function createCreateModal(root, { pageShell, getCreateTile, onSubmit, reducedMotion }) {
  const modal = root.querySelector('[data-create-modal]')
  const backdrop = modal.querySelector('[data-create-backdrop]')
  const form = modal.querySelector('[data-create-form]')
  const contents = Array.from(form.children)
  const errorText = modal.querySelector('[data-create-error]')
  const durationMs = reducedMotion ? 240 : CREATE_MODAL.durationMs

  let state = 'closed' // closed | opening | open | closing | resolving
  let presence = 0
  let tween = null
  let resolveAmount = 0
  let resolveTween = null
  let origin = { x: 0, y: 0 }
  let plus = null

  // The plus glyph of the Create tile: where the form comes from and returns to.
  function plusOf(tile) {
    return tile?.querySelector('.create-plus') || tile
  }

  function measureOrigin(tile) {
    plus = plusOf(tile)

    if (!plus || reducedMotion) {
      origin = { x: 0, y: 0 }
      return
    }

    const rect = plus.getBoundingClientRect()
    origin = {
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    }
  }

  function apply() {
    const t = presence
    const backdropAmount = t * (1 - resolveAmount)
    const blur = `blur(${(CREATE_MODAL.maxBlurPx * backdropAmount).toFixed(2)}px)`
    backdrop.style.backdropFilter = blur
    backdrop.style.webkitBackdropFilter = blur
    backdrop.style.backgroundColor = `rgba(${THEME.backdrop}, ${(CREATE_MODAL.maxDim * backdropAmount).toFixed(3)})`

    if (reducedMotion) {
      const scale = lerp(0.96, 1, t)
      form.style.transform = `scale(${scale.toFixed(4)})`
      form.style.opacity = (t * (1 - resolveAmount)).toFixed(3)
      return
    }

    // Layout size (transforms do not change it).
    const width = form.offsetWidth || 1
    const height = form.offsetHeight || 1
    const start = CREATE_MODAL.startSizePx
    const scaleX = lerp(start / width, 1, t)
    const scaleY = lerp(start / height, 1, t)

    // A quadratic arc from the plus to the centre, bowed to one side.
    const control = { x: origin.x / 2 + origin.y * CREATE_MODAL.arc, y: origin.y / 2 - origin.x * CREATE_MODAL.arc }
    const u = 1 - t
    const x = u * u * origin.x + 2 * u * t * control.x
    const y = u * u * origin.y + 2 * u * t * control.y
    const tilt = CREATE_MODAL.tiltDeg * u
    const sway = CREATE_MODAL.swayDeg * u
    const radius = lerp(start / 2, FORM_RADIUS_PX, t)
    const formBlur = CREATE_MODAL.maxFormBlurPx * (1 - smoothstep(0.05, 0.6, t))

    form.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotateX(${tilt.toFixed(3)}deg) rotateZ(${sway.toFixed(3)}deg) scale(${scaleX.toFixed(5)}, ${scaleY.toFixed(5)})`
    // Keep the on-screen corners round while the box is scaled unevenly.
    form.style.borderRadius = `${(radius / scaleX).toFixed(2)}px / ${(radius / scaleY).toFixed(2)}px`
    form.style.filter = formBlur > 0.05 ? `blur(${formBlur.toFixed(2)}px)` : ''
    form.style.opacity = (smoothstep(0, 0.1, t) * (1 - resolveAmount)).toFixed(3)

    const inner = smoothstep(0.52, 0.94, t).toFixed(3)
    contents.forEach((element) => {
      element.style.opacity = inner
    })

    // The plus lifts off into the form.
    if (plus) {
      plus.style.opacity = (1 - smoothstep(0, 0.16, t)).toFixed(3)
    }
  }

  function tweenPresence(target, now) {
    const distance = Math.abs(target - presence)
    const full = target === 1 ? durationMs : reducedMotion ? 200 : CREATE_MODAL.closeMs
    const duration = Math.max(reducedMotion ? 120 : CREATE_MODAL.minReverseMs, full * distance)
    tween = { from: presence, to: target, start: now, duration, ease: target === 1 ? OPEN_EASE : CLOSE_EASE }
  }

  function finishClosed() {
    state = 'closed'
    presence = 0
    resolveAmount = 0
    tween = null
    resolveTween = null
    modal.classList.remove('is-visible')
    modal.inert = true
    pageShell.inert = false
    form.reset()
    errorText.textContent = ''
    form.elements.name.removeAttribute('aria-invalid')
    form.style.filter = ''

    if (plus) {
      plus.style.opacity = ''
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()

    if (state !== 'open' && state !== 'opening') {
      return
    }

    const values = Object.fromEntries(new FormData(form))
    const name = String(values.name || '').trim()

    if (!name) {
      errorText.textContent = 'Project name is required.'
      form.elements.name.setAttribute('aria-invalid', 'true')
      form.elements.name.focus()
      return
    }

    onSubmit({ name, category: String(values.category || ''), description: String(values.description || '') })
  })

  form.elements.name.addEventListener('input', () => {
    errorText.textContent = ''
    form.elements.name.removeAttribute('aria-invalid')
  })

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-create-close]') || event.target === backdrop) {
      controller.close()
    }
  })

  const controller = {
    isActive() {
      return state !== 'closed'
    },

    isDismissible() {
      return state === 'opening' || state === 'open'
    },

    getForm: () => form,

    open(tile) {
      if (state === 'open' || state === 'opening' || state === 'resolving') {
        return
      }

      // Measured from the clicked tile itself, before any state or DOM change (spec §76).
      measureOrigin(tile)
      state = 'opening'
      modal.classList.add('is-visible')
      modal.inert = false
      pageShell.inert = true
      // Apply the plus-sized starting frame synchronously so the first painted frame is correct.
      apply()
      tweenPresence(1, performance.now())
      form.elements.name.focus({ preventScroll: true })
    },

    close() {
      if (state !== 'open' && state !== 'opening') {
        return
      }

      // Return to wherever the plus is now (the tile may have been resized or scrolled).
      measureOrigin(getCreateTile())
      state = 'closing'
      tweenPresence(0, performance.now())
    },

    // Successful CREATE: the form gives way to its dust (see the navigator); the backdrop clears.
    resolve() {
      state = 'resolving'
      tween = null
      resolveTween = { start: performance.now(), duration: reducedMotion ? 200 : CREATE_MODAL.resolveMs }
    },

    frame(now) {
      if (tween) {
        const t = clamp((now - tween.start) / tween.duration)
        presence = lerp(tween.from, tween.to, tween.ease(t))
        apply()

        if (t >= 1) {
          const target = tween.to
          tween = null

          if (target === 0) {
            finishClosed()
            getCreateTile()?.focus({ preventScroll: true })
          } else {
            state = 'open'
          }
        }
      }

      if (resolveTween) {
        const t = clamp((now - resolveTween.start) / resolveTween.duration)
        resolveAmount = easeOutCubic(t)
        apply()

        if (t >= 1) {
          finishClosed()
        }
      }
    },
  }

  return controller
}
