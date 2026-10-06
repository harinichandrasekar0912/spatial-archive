import { SEARCH } from '../app/constants.js'

/*
 * Workspace search (spec §109–112). Matching runs on each item's metadata: title, tags,
 * filename, notes and type (no semantic search in V1). Every word of the query has to match
 * somewhere; a hit in a title or tag counts for more than one in the notes, and a whole word
 * or word start for more than a match inside a word.
 *
 * The bar itself: a magnifier in the corner opens it at the top centre, growing out from its
 * middle, with a × just to its right. Results are not listed: the workspace moves to them.
 */

const TYPE_WORDS = { image: 'image photo picture', pdf: 'pdf document', note: 'note', model: '3d model' }

export const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const isWordCharacter = (character) => /[a-z0-9]/.test(character || '')

function fieldsOf(record) {
  return [
    [record.title, 3],
    [record.tags.join(' · '), 3],
    [record.filename, 2],
    [record.source, 2],
    [TYPE_WORDS[record.type] || record.type, 1],
    [record.notes, 1],
  ].map(([text, weight]) => [normalizeText(text), weight])
}

// Items matching every word of the query, best first; equal matches front to back, then in
// reading order (top to bottom, left to right), so stepping through them follows the space.
export function searchItems(items, query) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean)

  if (!terms.length) {
    return []
  }

  const results = []

  for (const item of items) {
    const fields = fieldsOf(item.record)
    let score = 0

    for (const term of terms) {
      let best = 0

      for (const [text, weight] of fields) {
        let at = text.indexOf(term)

        while (at !== -1) {
          const wordStart = !isWordCharacter(text[at - 1])
          const wordEnd = !isWordCharacter(text[at + term.length])
          best = Math.max(best, weight + (wordStart ? 0.5 : 0) + (wordStart && wordEnd ? 0.5 : 0))
          at = text.indexOf(term, at + 1)
        }
      }

      if (!best) {
        score = 0
        break
      }

      score += best
    }

    if (score > 0) {
      results.push({ item, score })
    }
  }

  const row = (record) => Math.round(record.y / 240)

  return results
    .sort((a, b) => b.score - a.score || a.item.record.z - b.item.record.z || row(a.item.record) - row(b.item.record) || a.item.record.x - b.item.record.x)
    .map((result) => result.item)
}

/*
 * The search bar's open / close choreography and input. onQuery(text) runs after typing
 * pauses (or at once on Enter); onStep(±1) moves between matches; onClose() when it closes.
 */
export function createSearchBar(root, { onQuery, onStep, onClose }) {
  const toggle = root.querySelector('[data-action="toggle-search"]')
  const bar = root.querySelector('[data-search]')
  const form = bar.querySelector('[data-search-form]')
  const input = form.elements.query
  const count = bar.querySelector('[data-search-count]')
  const steps = bar.querySelector('[data-search-steps]')
  let open = false
  let hideTimer = null
  let typingTimer = null
  let lastQuery = ''

  function runQuery() {
    clearTimeout(typingTimer)
    typingTimer = null
    lastQuery = input.value
    onQuery(input.value)
  }

  input.addEventListener('input', () => {
    clearTimeout(typingTimer)
    typingTimer = window.setTimeout(runQuery, SEARCH.debounceMs)
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      controller.close()
    } else if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()

      // A query still being typed is run first; Enter on a finished one moves to the next match.
      if (typingTimer || input.value !== lastQuery) {
        runQuery()
      } else {
        onStep(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1)
      }
    }
  })

  form.addEventListener('submit', (event) => event.preventDefault())

  const controller = {
    isOpen: () => open,

    open() {
      clearTimeout(hideTimer)

      if (!open) {
        open = true
        bar.hidden = false
        // Commit the collapsed state first, so the bar grows out of it.
        void bar.offsetWidth
        bar.classList.add('is-open')
        toggle.classList.add('is-active')
        toggle.setAttribute('aria-expanded', 'true')
      }

      input.focus({ preventScroll: true })
      input.select()
    },

    close({ restoreFocus = true } = {}) {
      if (!open) {
        return
      }

      open = false
      clearTimeout(typingTimer)
      typingTimer = null
      bar.classList.remove('is-open')
      toggle.classList.remove('is-active')
      toggle.setAttribute('aria-expanded', 'false')
      hideTimer = window.setTimeout(() => {
        bar.hidden = true
      }, SEARCH.closeMs)

      if (restoreFocus && bar.contains(document.activeElement)) {
        toggle.focus({ preventScroll: true })
      }

      onClose()
    },

    // Immediately, with nothing typed (leaving a workspace).
    reset() {
      controller.close({ restoreFocus: false })
      clearTimeout(hideTimer)
      bar.hidden = true
      input.value = ''
      lastQuery = ''
      controller.setResult(null)
    },

    // result: null (nothing searched) or { index, total }.
    setResult(result) {
      if (!result) {
        count.textContent = ''
        steps.hidden = true
        return
      }

      count.textContent = result.total ? `${result.index + 1} of ${result.total}` : 'No match'
      steps.hidden = result.total < 2
    },
  }

  return controller
}
