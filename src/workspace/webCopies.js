import { IMAGE } from '../app/constants.js'

/*
 * Lighter files for the archive (spec §123), made in the browser when something is added:
 *   - photographs, renders and references become WebP at most IMAGE.webMaxPx on the long edge;
 *   - PNGs (often plans, diagrams, line drawings) stay PNG, so their linework stays crisp;
 *   - PDFs are kept as they are, plus a small picture of their first page for the card.
 * The original stays where it came from (03_CONTENT/originals in the project archive).
 */

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// WebP where the browser can write it (Safari cannot), JPEG otherwise.
async function encodePhoto(canvas) {
  const webp = await canvasToBlob(canvas, 'image/webp', IMAGE.webQuality)

  if (webp && webp.type === 'image/webp') {
    return webp
  }

  return canvasToBlob(canvas, 'image/jpeg', IMAGE.jpegQuality)
}

const extensionFor = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }

/*
 * A web copy of an image file, or null when the original is already light enough (or cannot be
 * re-encoded). Returns { file, width, height, sourceWidth, sourceHeight }.
 */
export async function makeWebImage(file, { width, height }) {
  const longEdge = Math.max(width, height)
  const resizable = file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp'

  if (!resizable || typeof createImageBitmap !== 'function' || (longEdge <= IMAGE.webMaxPx && file.size <= IMAGE.lightBytes)) {
    return null
  }

  try {
    const scale = Math.min(1, IMAGE.webMaxPx / longEdge)
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))
    const bitmap = await createImageBitmap(file, { resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'high' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    bitmap.close()

    const blob = file.type === 'image/png' ? await canvasToBlob(canvas, 'image/png') : await encodePhoto(canvas)

    // Only worth keeping if it is clearly lighter.
    if (!blob || blob.size > file.size * IMAGE.keepBelowRatio) {
      return null
    }

    const name = `${file.name.replace(/\.[^.]+$/, '')}.${extensionFor[blob.type] || 'img'}`
    return { file: new File([blob], name, { type: blob.type }), width: canvas.width, height: canvas.height, sourceWidth: width, sourceHeight: height }
  } catch (error) {
    console.warn('Spatial Archive: could not make a web copy; keeping the original.', error)
    return null
  }
}

// ── PDF first pages (pdf.js, loaded only when a PDF needs it) ─────────────────────────

let pdfjs = null

function loadPdfjs() {
  pdfjs ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([library, worker]) => {
    library.GlobalWorkerOptions.workerSrc = worker.default
    return library
  })

  pdfjs.catch(() => {
    pdfjs = null
  })

  return pdfjs
}

/*
 * A picture of a PDF's first page for its card: { blob, width, height, pages } (width and
 * height in PDF points, for the card's proportions), or null if it cannot be read.
 */
export async function renderPdfPreview(blob) {
  let loading = null

  try {
    const library = await loadPdfjs()
    loading = library.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false })
    const pdf = await loading.promise
    const page = await pdf.getPage(1)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: IMAGE.pdfPreviewPx / Math.max(natural.width, natural.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    // The print intent draws in one go; the display intent waits for animation frames, which
    // never come while the tab is in the background.
    await page.render({ canvas, viewport, background: 'rgb(255, 255, 255)', intent: 'print' }).promise
    const preview = await encodePhoto(canvas)
    return preview ? { blob: preview, width: natural.width, height: natural.height, pages: pdf.numPages } : null
  } catch (error) {
    console.warn('Spatial Archive: could not draw a preview of this PDF.', error)
    return null
  } finally {
    // Frees the document and its worker-side data.
    loading?.destroy()
  }
}
