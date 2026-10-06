import { noteColor } from './cardTextures.js'
import { CARD_RADIUS_PX } from './scene3d.js'

/*
 * Inline note editing. A real <textarea> is laid over the note's on-screen rectangle and scaled
 * with the same zoom as the card, using the same type and padding as the card texture, so
 * editing looks like writing directly on the card in the 3D space.
 */
export function createNoteEditor(layer, { onInput, onStop }) {
  const textarea = document.createElement('textarea')
  textarea.className = 'note-editor'
  textarea.setAttribute('aria-label', 'Note text')
  textarea.placeholder = 'Write a note…'
  textarea.spellcheck = true
  textarea.hidden = true
  textarea.style.borderRadius = `${CARD_RADIUS_PX}px`
  layer.appendChild(textarea)

  let item = null

  textarea.addEventListener('input', () => {
    if (item) {
      onInput(item, textarea.value)
    }
  })

  textarea.addEventListener('blur', () => controller.stop())

  const controller = {
    editing: () => item,

    isEditing: (id) => item?.record.id === id,

    start(nextItem) {
      if (item) {
        controller.stop()
      }

      item = nextItem
      controller.setColor(item.record.color)
      textarea.value = item.record.notes
      textarea.style.width = `${item.record.width}px`
      textarea.style.height = `${item.record.height}px`
      textarea.hidden = false
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    },

    // The editor takes the note's own paper and ink.
    setColor(id) {
      const colors = noteColor(id)
      textarea.style.setProperty('--note-surface', colors.surface)
      textarea.style.setProperty('--note-ink', colors.ink)
      textarea.style.setProperty('--note-muted', colors.muted)
    },

    // Follow the card every frame (the camera can still move while editing).
    place(rect) {
      if (!item) {
        return
      }

      textarea.style.visibility = rect.behind ? 'hidden' : ''
      textarea.style.transform = `translate(${rect.left.toFixed(2)}px, ${rect.top.toFixed(2)}px) scale(${rect.zoom.toFixed(4)})`
    },

    stop({ restoreFocus = false } = {}) {
      if (!item) {
        return
      }

      const finished = item
      item = null
      textarea.hidden = true
      onStop(finished, textarea.value, { restoreFocus })
    },
  }

  return controller
}
