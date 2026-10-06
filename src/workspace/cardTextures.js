import * as THREE from 'three'
import { THEME } from '../app/constants.js'
import { loadImage } from '../utils/image.js'

/*
 * Canvas-drawn textures for 3D cards. Text cards are drawn in workspace pixels and rasterised
 * at TEXT_DENSITY texture pixels per workspace pixel, so they stay crisp up to ~2.5× zoom.
 * Layout values (14 px text, 1.5 line height, 16 / 18 px padding) match the note editor CSS,
 * so editing a note looks identical to the card itself.
 */

const FONT_FAMILY = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"
const INK = THEME.ink
const MUTED = THEME.inkFaint
const TEXT_DENSITY = 2.5
const MAX_TEXTURE_EDGE = 2048
const MAX_IMAGE_EDGE = 1024

export const NOTE_STYLE = { fontSize: 14, lineHeight: 21, paddingX: 18, paddingY: 16, background: THEME.noteSurface }
export const CAPTION_HEIGHT_PX = 18

// Shadow texture: the card occupies the central SHADOW_INNER of the texture.
const SHADOW_SIZE = 128
const SHADOW_INSET = 20
export const SHADOW_SCALE = SHADOW_SIZE / (SHADOW_SIZE - SHADOW_INSET * 2)

let anisotropy = 1
let shadowTexture = null

// Frees a texture, including the decoded bitmap behind it.
export function disposeTexture(texture) {
  if (!texture) {
    return
  }

  texture.dispose()
  texture.image?.close?.()
}

export function configureTextures(renderer) {
  anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width))
  canvas.height = Math.max(2, Math.round(height))
  return canvas
}

function toTexture(canvas, { color = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas)

  if (color) {
    texture.colorSpace = THREE.SRGBColorSpace
  }

  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return texture
}

// Draw in workspace pixels on a canvas sized for the card at TEXT_DENSITY (capped).
function cardCanvas(width, height) {
  const density = Math.min(TEXT_DENSITY, MAX_TEXTURE_EDGE / Math.max(width, height))
  const canvas = createCanvas(width * density, height * density)
  const context = canvas.getContext('2d')
  context.scale(density, density)
  context.textBaseline = 'top'
  return { canvas, context }
}

function wrapLines(context, text, maxWidth) {
  const lines = []

  String(text)
    .split('\n')
    .forEach((paragraph) => {
      let line = ''

      paragraph.split(/(\s+)/).forEach((word) => {
        const candidate = line + word

        if (line.trim() && context.measureText(candidate).width > maxWidth) {
          lines.push(line.trimEnd())
          line = word.trimStart()
        } else {
          line = candidate
        }

        // Hard-break words longer than a full line.
        while (line.length > 1 && context.measureText(line).width > maxWidth) {
          let cut = line.length - 1

          while (cut > 1 && context.measureText(line.slice(0, cut)).width > maxWidth) {
            cut -= 1
          }

          lines.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      })

      lines.push(line)
    })

  return lines
}

function ellipsize(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) {
    return text
  }

  let end = text.length

  while (end > 0 && context.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
    end -= 1
  }

  return `${text.slice(0, end).trimEnd()}…`
}

function drawLines(context, lines, { x, y, lineHeight, maxLines, maxWidth }) {
  const visible = lines.slice(0, maxLines)

  if (lines.length > maxLines && visible.length) {
    visible[visible.length - 1] = ellipsize(context, `${visible[visible.length - 1]}…`, maxWidth)
  }

  visible.forEach((line, index) => context.fillText(line, x, y + index * lineHeight))
}

// Dark cards need a hairline so their edge reads against the black space. The card shader
// rounds the corners, so the stroke follows the same rounded rectangle.
function strokeEdge(context, record) {
  context.strokeStyle = THEME.hairline
  context.lineWidth = 1.5
  context.beginPath()
  context.roundRect(0.75, 0.75, record.width - 1.5, record.height - 1.5, 13)
  context.stroke()
}

export function createNoteTexture(record) {
  const { canvas, context } = cardCanvas(record.width, record.height)
  const { fontSize, lineHeight, paddingX, paddingY, background } = NOTE_STYLE
  const hasText = record.notes.trim().length > 0

  context.fillStyle = background
  context.fillRect(0, 0, record.width, record.height)
  strokeEdge(context, record)
  context.font = `${fontSize}px ${FONT_FAMILY}`
  context.fillStyle = hasText ? INK : MUTED

  const maxWidth = record.width - paddingX * 2
  // Half-leading so the first baseline matches a CSS line-height of 1.5.
  drawLines(context, wrapLines(context, hasText ? record.notes : 'Write a note…', maxWidth), {
    x: paddingX,
    y: paddingY + (lineHeight - fontSize) / 2,
    lineHeight,
    maxLines: Math.max(1, Math.floor((record.height - paddingY * 2) / lineHeight)),
    maxWidth,
  })

  return toTexture(canvas)
}

export function createPdfTexture(record) {
  const { canvas, context } = cardCanvas(record.width, record.height)
  const title = record.title || record.filename || 'Untitled PDF'

  context.fillStyle = THEME.documentSurface
  context.fillRect(0, 0, record.width, record.height)
  strokeEdge(context, record)

  context.font = `10px ${FONT_FAMILY}`
  context.fillStyle = THEME.inkMuted
  context.letterSpacing = '1.4px'
  context.fillText('PDF', 18, 18)

  context.font = `17px ${FONT_FAMILY}`
  context.fillStyle = INK
  context.letterSpacing = '-0.4px'
  const maxWidth = record.width - 36
  const lines = wrapLines(context, title, maxWidth)
  const lineHeight = 20.4
  const maxLines = Math.min(6, Math.max(1, Math.floor((record.height - 60) / lineHeight)))
  const shown = Math.min(lines.length, maxLines)
  drawLines(context, lines, { x: 18, y: record.height - 18 - shown * lineHeight, lineHeight, maxLines, maxWidth })

  return toTexture(canvas)
}

export function createCaptionTexture(text, widthPx) {
  const { canvas, context } = cardCanvas(widthPx, CAPTION_HEIGHT_PX)
  context.font = `11px ${FONT_FAMILY}`
  context.fillStyle = THEME.inkMuted
  context.letterSpacing = '0.2px'
  context.fillText(ellipsize(context, text, widthPx - 4), 2, 3)
  return toTexture(canvas)
}

export function createPlaceholderTexture(color = THEME.placeholder) {
  const canvas = createCanvas(4, 4)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, 4, 4)
  return toTexture(canvas)
}

// ── Image decoding in a worker (see imageWorker.js) ─────────────────────────────────

let imageWorker = null
let imageWorkerFailed = false
let nextImage = 0
const imageJobs = new Map()

function decodeInWorker(url, width, height) {
  if (!imageWorker && !imageWorkerFailed && typeof Worker !== 'undefined') {
    try {
      imageWorker = new Worker(new URL('./imageWorker.js', import.meta.url), { type: 'module' })
      imageWorker.onmessage = ({ data }) => {
        const job = imageJobs.get(data.id)
        imageJobs.delete(data.id)
        data.bitmap ? job?.resolve(data.bitmap) : job?.reject(new Error(data.error))
      }
      imageWorker.onerror = () => {
        imageWorkerFailed = true
        imageWorker = null
        imageJobs.forEach((job) => job.reject(new Error('The image worker stopped.')))
        imageJobs.clear()
      }
    } catch {
      imageWorkerFailed = true
    }
  }

  if (!imageWorker) {
    return Promise.reject(new Error('No image worker.'))
  }

  return new Promise((resolve, reject) => {
    const id = (nextImage += 1)
    imageJobs.set(id, { resolve, reject })
    imageWorker.postMessage({ id, url, width, height })
  })
}

function bitmapTexture(bitmap) {
  const texture = new THREE.Texture(bitmap)
  // Already flipped while decoding (WebGL cannot flip image bitmaps on upload).
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return texture
}

/*
 * Images are downscaled for the 3D card (the focus view always shows the original). They are
 * decoded and resized in a worker, so a workspace full of large photographs opens without
 * stalling an animation. `aspect` is the card's (= the image's) width / height. SVGs, and
 * browsers without workers or resize support, are decoded on the page instead.
 */
export async function createImageTexture(url, { aspect = 0 } = {}) {
  if (aspect > 0 && typeof createImageBitmap === 'function') {
    const width = Math.round(aspect >= 1 ? MAX_IMAGE_EDGE : MAX_IMAGE_EDGE * aspect)
    const height = Math.round(aspect >= 1 ? MAX_IMAGE_EDGE / aspect : MAX_IMAGE_EDGE)

    try {
      return bitmapTexture(await decodeInWorker(url, width, height))
    } catch {
      // Fall back to decoding on the page below.
    }
  }

  const image = await loadImage(url)

  const naturalWidth = image.naturalWidth || 1024
  const naturalHeight = image.naturalHeight || 1024
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(naturalWidth, naturalHeight))
  const canvas = createCanvas(naturalWidth * scale, naturalHeight * scale)
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return toTexture(canvas)
}

// One soft rounded-rectangle shadow, shared by every card.
export function getShadowTexture() {
  if (shadowTexture) {
    return shadowTexture
  }

  const canvas = createCanvas(SHADOW_SIZE, SHADOW_SIZE)
  const context = canvas.getContext('2d')
  const inner = SHADOW_SIZE - SHADOW_INSET * 2
  // Draw the shape off-canvas and let only its blurred shadow fall inside.
  context.shadowColor = 'rgba(0, 0, 0, 1)'
  context.shadowBlur = 16
  context.shadowOffsetX = 1000
  context.beginPath()
  context.roundRect(SHADOW_INSET - 1000, SHADOW_INSET, inner, inner, 10)
  context.fill()

  shadowTexture = toTexture(canvas, { color: false })
  return shadowTexture
}
