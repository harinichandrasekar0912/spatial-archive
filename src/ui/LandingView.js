import { TAGLINE } from './LandingPage.js'

/*
 * Landing DOM controller. The typewriter is advanced by the shared frame loop (one character
 * per INTRO.typingCharMs), so it stays in step with the dot fade and the camera. Before the
 * first character the caret appears on its own and blinks, as if waiting for the phrase.
 */
export function createLandingView(root) {
  const section = root.querySelector('[data-view="landing"]')
  const line = section.querySelector('[data-tagline-line]')
  const text = section.querySelector('[data-tagline]')
  const caret = section.querySelector('[data-caret]')
  const hint = section.querySelector('[data-zoom-hint]')
  let typedCount = -1

  function setTyped(count) {
    const next = Math.max(0, Math.min(TAGLINE.length, count))

    if (next === typedCount) {
      return
    }

    typedCount = next
    text.textContent = TAGLINE.slice(0, next)
    // Solid while typing; once complete it blinks a few times and fades (CSS).
    caret.classList.add('is-visible')
    caret.classList.remove('is-waiting')

    if (next >= TAGLINE.length) {
      caret.classList.add('is-finished')
    }
  }

  return {
    element: section,

    isFullyTyped() {
      return typedCount >= TAGLINE.length
    },

    // The caret alone, blinking, before typing starts.
    showCaret() {
      if (typedCount < 1) {
        caret.classList.add('is-visible', 'is-waiting')
      }
    },

    setTyped,

    // Returning from Projects: the whole phrase, no typewriter, no caret (spec §31).
    showFullText() {
      typedCount = TAGLINE.length
      text.textContent = TAGLINE
      caret.classList.remove('is-visible', 'is-waiting', 'is-finished')
    },

    // The phrase as a line of glyphs, for turning into dust.
    getTaglineElement: () => line,

    /*
     * Wipes the phrase away (or back) from the left: `hidden` is how much of it, from its left
     * edge, is gone. With fromRight, it is revealed from the left instead (hidden from the right).
     */
    setWipe(hidden, { fromRight = false } = {}) {
      if (hidden <= 0) {
        line.style.clipPath = ''
        return
      }

      const percent = `${(Math.min(1, hidden) * 100).toFixed(2)}%`
      line.style.clipPath = fromRight ? `inset(-30% ${percent} -30% -2%)` : `inset(-30% -2% -30% ${percent})`
    },

    setHint(opacity) {
      hint.style.opacity = opacity.toFixed(3)
      hint.classList.toggle('is-visible', opacity > 0.01)
    },

    setOpacity(value) {
      section.style.opacity = value >= 1 ? '' : value.toFixed(3)
    },

    setActive(active) {
      section.inert = !active
    },
  }
}
