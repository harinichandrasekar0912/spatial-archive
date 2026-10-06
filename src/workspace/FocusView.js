import { FOCUS_VIEW, THEME } from '../app/constants.js'
import { escapeHtml } from '../utils/dom.js'
import { clamp, easeOutQuint, lerp, smoothstep } from '../utils/easing.js'
import { extensionOf } from './models/modelLoader.js'
import { createModelViewer } from './models/modelViewer.js'

const META_WIDTH_PX = 300
const GAP_PX = 32
const STACK_BELOW_PX = 900
const FINAL_RADIUS_PX = 10
const PDF_PAGE_RATIO = 0.75
const MODEL_STAGE_RATIO = 1.45

function parseTags(value) {
  const seen = new Set()

  return String(value)
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase()

      if (!tag || seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

/*
 * Focus / inspect view (spec §94–96). The media grows out of its own card: the panel is
 * laid out at its final size, then transformed so the media box sits exactly on the card's
 * screen rectangle, and a presence value (0 → 1) releases that transform. Closing reverses it.
 * The canvas behind is softly blurred, so the user never fully leaves the spatial context.
 */
export function createFocusView(section, hooks) {
  const root = section.querySelector('[data-focus-view]')
  const backdrop = root.querySelector('.focus-view__backdrop')
  const panel = root.querySelector('[data-focus-panel]')
  const media = root.querySelector('[data-focus-media]')
  const form = root.querySelector('[data-focus-form]')
  const typeLabel = root.querySelector('[data-focus-type]')
  const facts = root.querySelector('[data-focus-facts]')
  const appearance = root.querySelector('[data-focus-appearance]')
  const durationMs = hooks.reducedMotion ? 200 : FOCUS_VIEW.durationMs

  let item = null
  let state = 'closed'
  let presence = 0
  let tween = null
  let mapping = null
  let viewer = null

  const isModel = () => item?.record.type === 'model'

  panel.tabIndex = -1

  function placeholderFor(record) {
    return `<div class="focus-view__document"><span class="asset-card__kind">PDF</span><span>${escapeHtml(record.title || record.filename)}</span></div>`
  }

  function mediaMarkup(record, url) {
    if (record.type === 'model') {
      return '<div class="focus-view__stage" data-model-stage></div><p class="focus-view__stage-hint" aria-hidden="true">Drag to orbit · right-drag to pan · scroll to zoom</p>'
    }

    return record.type === 'pdf' ? placeholderFor(record) : `<img src="${url}" alt="${escapeHtml(record.title)}" draggable="false" />`
  }

  function formatOf(record) {
    const format = extensionOf(item.modelMain || record.filename).toUpperCase()
    return extensionOf(record.filename) === 'skp' ? `SketchUp, converted to ${format}` : format
  }

  const megabytes = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`
  const thousands = (count) => (count >= 1e6 ? `${(count / 1e6).toFixed(2)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}k` : String(count))

  function lightCopyFacts(detail) {
    if (!detail) {
      return ''
    }

    const kept = detail.shellOnly ? 'outer shell, ' : ''
    return `
      <dt>LIGHT COPY</dt><dd>${kept}${thousands(detail.triangles)} of ${thousands(detail.sourceTriangles)} triangles</dd>
      <dt>SIZE</dt><dd>${megabytes(detail.bytes)} (from ${megabytes(detail.sourceBytes)})</dd>
    `
  }

  function setAppearance(value) {
    appearance.querySelectorAll('[data-appearance]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.appearance === value))
    })
  }

  function populate() {
    const { record, url } = item
    const added = new Date(record.createdAt)

    typeLabel.textContent = { pdf: 'PDF', model: '3D MODEL' }[record.type] || 'IMAGE'
    media.innerHTML = mediaMarkup(record, url)
    media.classList.toggle('is-model', isModel())
    appearance.hidden = !isModel()
    setAppearance(record.appearance)
    form.elements.title.value = record.title
    form.elements.tags.value = record.tags.join(', ')
    form.elements.notes.value = record.notes
    facts.innerHTML = `
      <dt>FILE</dt><dd>${escapeHtml(record.filename || '—')}</dd>
      ${isModel() && !record.detail ? `<dt>FORMAT</dt><dd>${escapeHtml(formatOf(record))}</dd>` : ''}
      ${isModel() ? lightCopyFacts(record.detail) : ''}
      <dt>ADDED</dt><dd>${Number.isNaN(added.getTime()) ? '—' : added.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
    `
  }

  // Final media size: as large as the viewport allows, keeping the card's aspect ratio.
  function layoutMedia() {
    const { innerWidth: width, innerHeight: height } = window
    const stacked = width < STACK_BELOW_PX
    const maxWidth = stacked ? width - 48 : Math.min(1200, width - META_WIDTH_PX - GAP_PX - 96)
    const maxHeight = stacked ? height * 0.58 : height - 120
    const aspect = { pdf: PDF_PAGE_RATIO, model: MODEL_STAGE_RATIO }[item.record.type] || item.record.width / item.record.height
    let mediaWidth = maxWidth
    let mediaHeight = mediaWidth / aspect

    if (mediaHeight > maxHeight) {
      mediaHeight = maxHeight
      mediaWidth = mediaHeight * aspect
    }

    media.style.width = `${Math.round(mediaWidth)}px`
    media.style.height = `${Math.round(mediaHeight)}px`
    root.classList.toggle('is-stacked', stacked)
  }

  // Transform that places the media box exactly over the card on screen.
  function measureMapping() {
    panel.style.transform = 'none'
    const mediaRect = media.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const card = hooks.getCardRect(item)
    const mediaCentreX = mediaRect.left + mediaRect.width / 2
    const mediaCentreY = mediaRect.top + mediaRect.height / 2

    panel.style.transformOrigin = `${mediaCentreX - panelRect.left}px ${mediaCentreY - panelRect.top}px`
    // A model's stage keeps its proportions while it grows (a 3D view must not be stretched).
    const uniform = isModel() ? Math.max(card.width / mediaRect.width, card.height / mediaRect.height) : 0
    mapping = {
      x: card.x - mediaCentreX,
      y: card.y - mediaCentreY,
      scaleX: uniform || card.width / mediaRect.width,
      scaleY: uniform || card.height / mediaRect.height,
      radius: card.radius,
    }
  }

  function apply() {
    const scaleX = lerp(mapping.scaleX, 1, presence)
    const scaleY = lerp(mapping.scaleY, 1, presence)
    const radius = lerp(mapping.radius, FINAL_RADIUS_PX, presence)
    const blur = `blur(${(FOCUS_VIEW.maxBlurPx * presence).toFixed(2)}px)`

    panel.style.transform = `translate3d(${(mapping.x * (1 - presence)).toFixed(2)}px, ${(mapping.y * (1 - presence)).toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`
    // Keep the on-screen corner radius continuous while the panel is scaled.
    media.style.borderRadius = `${(radius / scaleX).toFixed(2)}px / ${(radius / scaleY).toFixed(2)}px`
    form.style.opacity = smoothstep(0.55, 1, presence).toFixed(3)
    // The stage materialises as it leaves the model, which has a different view of it.
    media.style.opacity = isModel() ? smoothstep(0, 0.35, presence).toFixed(3) : ''
    backdrop.style.backdropFilter = blur
    backdrop.style.webkitBackdropFilter = blur
    backdrop.style.backgroundColor = `rgba(${THEME.backdrop}, ${(FOCUS_VIEW.maxDim * presence).toFixed(3)})`
  }

  function startTween(target) {
    const duration = Math.max(160, durationMs * Math.abs(target - presence))
    tween = { from: presence, to: target, start: performance.now(), duration }
  }

  function finishClose({ restoreFocus }) {
    const closed = item
    state = 'closed'
    tween = null
    presence = 0
    item = null

    if (viewer) {
      viewer.dispose()
      viewer = null
      hooks.returnModel(closed)
    }

    media.innerHTML = ''
    media.style.opacity = ''
    root.classList.remove('is-visible')
    root.inert = true
    hooks.setBackgroundInert(false)

    if (closed) {
      hooks.setCardHidden(closed, false)

      if (restoreFocus) {
        hooks.onClosed(closed)
      }
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault())

  appearance.addEventListener('click', (event) => {
    const value = event.target.closest('[data-appearance]')?.dataset.appearance

    if (!item || !value || value === item.record.appearance) {
      return
    }

    item.record.appearance = value
    setAppearance(value)
    viewer?.setAppearance(value)
    hooks.onChange(item)
  })

  form.addEventListener('input', () => {
    if (!item) {
      return
    }

    item.record.title = form.elements.title.value.trim()
    item.record.tags = parseTags(form.elements.tags.value)
    item.record.notes = form.elements.notes.value
    hooks.onChange(item)
  })

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-focus-close]')) {
      controller.close()
    }
  })

  window.addEventListener('resize', () => {
    if (state === 'open') {
      layoutMedia()
      measureMapping()
      apply()
    }
  })

  const controller = {
    isOpen: () => state !== 'closed',

    open(nextItem) {
      if (state !== 'closed') {
        return
      }

      item = nextItem
      populate()
      root.classList.add('is-visible')
      root.inert = false
      hooks.setBackgroundInert(true)
      layoutMedia()
      measureMapping()
      presence = 0
      apply()
      hooks.setCardHidden(item, true)

      if (isModel()) {
        viewer = createModelViewer(media.querySelector('[data-model-stage]'), hooks.lendModel(item))
      }

      state = 'opening'
      startTween(1)
      panel.focus({ preventScroll: true })
    },

    close() {
      if (state !== 'open' && state !== 'opening') {
        return
      }

      // Swap a heavy PDF frame back to its placeholder before shrinking into the card.
      if (item.record.type === 'pdf') {
        media.innerHTML = placeholderFor(item.record)
      }

      measureMapping()
      state = 'closing'
      startTween(0)
    },

    closeImmediately() {
      if (state !== 'closed') {
        finishClose({ restoreFocus: false })
      }
    },

    frame(now) {
      viewer?.frame()

      if (!tween) {
        return
      }

      const t = clamp((now - tween.start) / tween.duration)
      presence = lerp(tween.from, tween.to, easeOutQuint(t))
      apply()

      if (t < 1) {
        return
      }

      const target = tween.to
      tween = null

      if (target === 0) {
        finishClose({ restoreFocus: true })
        return
      }

      state = 'open'

      // The browser's own PDF reader loads once the panel has arrived.
      if (item.record.type === 'pdf') {
        media.innerHTML = `<iframe src="${item.url}" title="${escapeHtml(item.record.title || item.record.filename)}"></iframe>`
      }
    },
  }

  return controller
}
