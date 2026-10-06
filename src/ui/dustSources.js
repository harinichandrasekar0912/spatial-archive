/*
 * Turning what is on screen into dust particles.
 *
 * A particle set is { count, x, y, r, g, b, a } (Float32Arrays; CSS pixels, sRGB 0–1). DOM
 * elements are first redrawn into an offscreen canvas (their boxes, text and form fields, from
 * their computed styles), then sampled on a grid; the 3D view is sampled from a captured frame.
 */

const transparent = (color) => !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color)

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, r)
}

function fontOf(style) {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

// One line of text per line box, found from the character rectangles of each text node.
function drawTextNode(ctx, node, style, origin) {
  const text = node.textContent

  if (!text.trim()) {
    return
  }

  const range = document.createRange()
  const lines = []

  for (let i = 0; i < text.length; i += 1) {
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    const rect = range.getBoundingClientRect()

    if (!rect.width && !rect.height) {
      continue
    }

    const line = lines.at(-1)

    if (line && Math.abs(line.top - rect.top) < rect.height * 0.5) {
      line.text += text[i]
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      lines.push({ text: text[i], left: rect.left, top: rect.top, bottom: rect.bottom })
    }
  }

  ctx.font = fontOf(style)
  ctx.fillStyle = style.color
  ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
  // A character's box is the font's ascent + descent, so its baseline sits one ascent below
  // the top: placing the glyphs there lines them up exactly with the real text.
  const ascent = ctx.measureText(text).fontBoundingBoxAscent
  ctx.textBaseline = Number.isFinite(ascent) ? 'alphabetic' : 'middle'
  const transform = { uppercase: (value) => value.toUpperCase(), lowercase: (value) => value.toLowerCase() }[style.textTransform] || ((value) => value)
  lines.forEach((line) => {
    const y = Number.isFinite(ascent) ? line.top + ascent : (line.top + line.bottom) / 2
    ctx.fillText(transform(line.text.trimEnd()), line.left - origin.x, y - origin.y)
  })
}

function drawBox(ctx, element, style, origin) {
  const rect = element.getBoundingClientRect()
  const radius = parseFloat(style.borderTopLeftRadius) || 0
  const borderWidth = parseFloat(style.borderTopWidth) || 0
  const x = rect.left - origin.x
  const y = rect.top - origin.y

  if (!transparent(style.backgroundColor)) {
    roundedRect(ctx, x, y, rect.width, rect.height, radius)
    ctx.fillStyle = style.backgroundColor
    ctx.fill()
  }

  if (borderWidth > 0 && !transparent(style.borderTopColor) && style.borderTopStyle !== 'none') {
    roundedRect(ctx, x + borderWidth / 2, y + borderWidth / 2, rect.width - borderWidth, rect.height - borderWidth, radius)
    ctx.lineWidth = borderWidth
    ctx.strokeStyle = style.borderTopColor
    ctx.stroke()
  }

  // Field values are not text nodes: draw them in the field's content box.
  if ((element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') && element.value) {
    ctx.font = fontOf(style)
    ctx.fillStyle = style.color
    ctx.textBaseline = element.tagName === 'INPUT' ? 'middle' : 'top'
    const left = x + (parseFloat(style.paddingLeft) || 0) + borderWidth
    const top = element.tagName === 'INPUT' ? y + rect.height / 2 : y + (parseFloat(style.paddingTop) || 0) + borderWidth
    ctx.fillText(element.value.split('\n')[0], left, top, rect.width - (parseFloat(style.paddingLeft) || 0) * 2)
  }
}

function drawElement(ctx, element, origin) {
  const style = getComputedStyle(element)

  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05 || element.classList.contains('sr-only')) {
    return
  }

  drawBox(ctx, element, style, origin)

  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      drawTextNode(ctx, child, style, origin)
    } else if (child.nodeType === Node.ELEMENT_NODE && child.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      drawElement(ctx, child, origin)
    }
  })
}

// Redraws an element (and what is inside it) into a canvas at device resolution.
export function renderElement(element) {
  const rect = element.getBoundingClientRect()
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(rect.width * scale))
  canvas.height = Math.max(1, Math.ceil(rect.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  drawElement(ctx, element, { x: rect.left, y: rect.top })
  return { canvas, left: rect.left, top: rect.top, scale }
}

function emptySet(capacity) {
  return {
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    r: new Float32Array(capacity),
    g: new Float32Array(capacity),
    b: new Float32Array(capacity),
    a: new Float32Array(capacity),
  }
}

/*
 * Samples a canvas on a grid of `step` CSS pixels. Pixels that differ from the page background
 * (or are opaque on a transparent canvas) become particles; `limit` caps the count by
 * widening the grid.
 */
export function sampleCanvas({ canvas, left, top, scale }, { step = 3, limit = 12000, minAlpha = 0.08, background = [10, 10, 10], minContrast = 10 } = {}) {
  const { width, height } = canvas
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data
  const visible = (index) => {
    const alpha = data[index + 3] / 255

    if (alpha < minAlpha) {
      return false
    }

    const contrast = Math.abs(data[index] - background[0]) + Math.abs(data[index + 1] - background[1]) + Math.abs(data[index + 2] - background[2])
    return contrast * alpha >= minContrast
  }

  let gridStep = step * scale
  let estimate = 0

  // Count first, then widen the grid until the set fits the limit.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    estimate = 0

    for (let y = gridStep / 2; y < height; y += gridStep) {
      for (let x = gridStep / 2; x < width; x += gridStep) {
        if (visible((Math.floor(y) * width + Math.floor(x)) * 4)) {
          estimate += 1
        }
      }
    }

    if (estimate <= limit) {
      break
    }

    gridStep *= Math.sqrt(estimate / limit) * 1.02
  }

  const set = emptySet(Math.min(estimate, limit))

  for (let y = gridStep / 2; y < height && set.count < set.x.length; y += gridStep) {
    for (let x = gridStep / 2; x < width && set.count < set.x.length; x += gridStep) {
      const index = (Math.floor(y) * width + Math.floor(x)) * 4

      if (!visible(index)) {
        continue
      }

      const i = set.count
      // A little jitter hides the sampling grid.
      set.x[i] = left + (x + (Math.random() - 0.5) * gridStep * 0.6) / scale
      set.y[i] = top + (y + (Math.random() - 0.5) * gridStep * 0.6) / scale
      set.r[i] = data[index] / 255
      set.g[i] = data[index + 1] / 255
      set.b[i] = data[index + 2] / 255
      set.a[i] = data[index + 3] / 255
      set.count += 1
    }
  }

  set.spacing = gridStep / scale
  return set
}

// Dust from a DOM element, as it looks right now.
export function dustFromElement(element, options) {
  return sampleCanvas(renderElement(element), options)
}

// Dust from the 3D view (a canvas captured with SpatialScene.captureFrame).
export function dustFromFrame(frame, viewport, options) {
  return sampleCanvas({ canvas: frame, left: 0, top: 0, scale: frame.width / Math.max(1, viewport.width) }, options)
}
