import { MODEL, WORKSPACE } from '../app/constants.js'
import { createAssetId, createFileId, normalizeAsset } from '../data/workspaceStore.js'
import { loadImage } from '../utils/image.js'
import { extensionOf, isModelName, isSidecarName, loadModelObject } from './models/modelLoader.js'
import { prepareModelAsync } from './models/modelStyle.js'
import { makeWebImage, renderPdfPreview } from './webCopies.js'

const TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
const SMALLEST_LONG_EDGE = 120

function mimeTypeOf(file) {
  if (file.type) {
    return file.type
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  return TYPE_BY_EXTENSION[extension] || ''
}

export function kindOfFile(file) {
  const mimeType = mimeTypeOf(file)

  if (IMAGE_TYPES.has(mimeType)) {
    return 'image'
  }

  return mimeType === 'application/pdf' ? 'pdf' : null
}

export function titleFromFilename(name) {
  return String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

async function readImageSize(url) {
  try {
    const image = await loadImage(url)
    // SVGs without intrinsic dimensions report 0; they fall back to a square card.
    return image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null
  } catch {
    return null
  }
}

// Long edge capped at defaultImageMax; tiny images are scaled up so they remain usable.
// (PDF cards use the same rule with their first page's proportions.)
function cardSizeForImage({ width, height }) {
  const longEdge = Math.max(width, height)
  const target = Math.min(WORKSPACE.defaultImageMax, Math.max(SMALLEST_LONG_EDGE, longEdge))
  const scale = target / longEdge
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/*
 * A picture of a PDF's first page, stored beside it: { file (record to store), url, size, pages },
 * or null. The card takes the page's proportions.
 */
export async function preparePdfPreview(blob, name, projectId) {
  const preview = await renderPdfPreview(blob)

  if (!preview) {
    return null
  }

  return {
    file: { id: createFileId(), projectId, blob: preview.blob, name: `${name}.preview`, type: preview.blob.type, size: preview.blob.size, createdAt: new Date().toISOString() },
    url: URL.createObjectURL(preview.blob),
    size: cardSizeForImage(preview),
    pages: preview.pages,
  }
}

/*
 * Turns a dropped / picked File into { record, files, url, previewUrl }. Large photographs are
 * stored as lighter web copies, and PDFs with a picture of their first page (see webCopies.js).
 * Blobs are stored once in the "files" store; the asset record references them by id.
 */
export async function prepareFileAsset(file, projectId) {
  const kind = kindOfFile(file)

  if (!kind) {
    return null
  }

  let mimeType = mimeTypeOf(file)
  let stored = file
  let size = kind === 'pdf' ? { ...WORKSPACE.pdfSize } : { width: WORKSPACE.defaultImageMax, height: WORKSPACE.defaultImageMax }
  let detail = null
  let preview = null

  if (kind === 'image') {
    const probe = URL.createObjectURL(file)
    const natural = await readImageSize(probe)
    URL.revokeObjectURL(probe)

    if (natural) {
      size = cardSizeForImage(natural)
      const copy = await makeWebImage(file.type ? file : new File([file], file.name, { type: mimeType }), natural)

      if (copy) {
        stored = copy.file
        mimeType = copy.file.type
        detail = { webCopy: true, width: copy.width, height: copy.height, bytes: copy.file.size, sourceWidth: copy.sourceWidth, sourceHeight: copy.sourceHeight, sourceBytes: file.size }
      }
    }
  } else {
    preview = await preparePdfPreview(file, file.name, projectId)

    if (preview) {
      size = preview.size
      detail = { pages: preview.pages }
    }
  }

  const now = new Date().toISOString()
  const fileId = createFileId()
  const main = { id: fileId, projectId, blob: stored, name: file.name, type: mimeType, size: stored.size, createdAt: now }

  return {
    url: URL.createObjectURL(stored),
    previewUrl: preview?.url ?? null,
    files: preview ? [main, preview.file] : [main],
    record: normalizeAsset({
      id: createAssetId(),
      projectId,
      type: kind,
      title: titleFromFilename(file.name),
      filename: file.name,
      mimeType,
      fileId,
      previewId: preview?.file.id ?? null,
      width: size.width,
      height: size.height,
      detail,
      createdAt: now,
      updatedAt: now,
    }),
  }
}

export function createNoteRecord(projectId, centre) {
  const now = new Date().toISOString()

  return normalizeAsset({
    id: createAssetId(),
    projectId,
    type: 'note',
    x: centre.x,
    y: centre.y,
    width: WORKSPACE.noteSize.width,
    height: WORKSPACE.noteSize.height,
    createdAt: now,
    updatedAt: now,
  })
}

// Places several new records in tidy rows centred on a point, so a multi-file drop stays legible.
export function arrangeAround(records, centre, gap = 36, maxRowWidth = 1400) {
  const rows = []
  let row = { items: [], width: 0, height: 0 }

  records.forEach((record) => {
    const nextWidth = row.items.length ? row.width + gap + record.width : record.width

    if (row.items.length && nextWidth > maxRowWidth) {
      rows.push(row)
      row = { items: [], width: 0, height: 0 }
    }

    row.width = row.items.length ? row.width + gap + record.width : record.width
    row.height = Math.max(row.height, record.height)
    row.items.push(record)
  })

  rows.push(row)

  const totalHeight = rows.reduce((sum, item) => sum + item.height, 0) + gap * (rows.length - 1)
  let top = centre.y - totalHeight / 2

  rows.forEach(({ items, width, height }) => {
    let left = centre.x - width / 2

    items.forEach((record) => {
      record.x = Math.round(left + record.width / 2)
      record.y = Math.round(top + height / 2)
      left += record.width + gap
    })

    top += height + gap
  })
}

// ── 3D models ─────────────────────────────────────────────────────────────────────────

const TEXT_MODEL_EXTENSIONS = ['obj', 'mtl', 'gltf', 'dae']

/*
 * Sorts a drop into: model bundles (main file + MTL / BIN / referenced textures), SketchUp
 * files to convert, plain images, PDFs and unsupported files. An image counts as a texture
 * only when a dropped model actually references it by name; otherwise it becomes a card.
 */
export async function groupFiles(files) {
  const models = files.filter((file) => isModelName(file.name))
  const sketchup = files.filter((file) => extensionOf(file.name) === 'skp')
  const sidecars = files.filter((file) => isSidecarName(file.name))
  const images = files.filter((file) => kindOfFile(file) === 'image')
  const pdfs = files.filter((file) => kindOfFile(file) === 'pdf')

  // Only read model files as text when there are images that might be their textures.
  const modelTexts = models.length && images.length
    ? (await Promise.all([...models, ...sidecars].filter((file) => TEXT_MODEL_EXTENSIONS.includes(extensionOf(file.name))).map((file) => file.text().catch(() => '')))).join('\n').toLowerCase()
    : ''
  const textures = images.filter((file) => modelTexts.includes(file.name.toLowerCase()))
  const stem = (name) => name.replace(/\.[^.]+$/, '').toLowerCase()
  const bundles = models.map((main) => ({ main, companions: [] }))

  ;[...sidecars, ...textures].forEach((file) => {
    const owner = bundles.find((bundle) => stem(bundle.main.name) === stem(file.name)) || (bundles.length === 1 ? bundles[0] : null)

    if (owner) {
      owner.companions.push(file)
    } else {
      bundles.forEach((bundle) => bundle.companions.push(file))
    }
  })

  const known = new Set([...models, ...sketchup, ...sidecars, ...images, ...pdfs])

  return {
    bundles,
    sketchup,
    cards: [...images.filter((file) => !textures.includes(file)), ...pdfs],
    unsupported: files.filter((file) => !known.has(file)),
  }
}

const stemOf = (name) => String(name).replace(/\.[^.]+$/, '') || 'model'

/*
 * Turns a model bundle into the workspace's light copy (outer shell, simplified, one .glb; see
 * models/modelOptimize.js) and returns the asset record, the file record to store, a blob URL
 * and the prepared model for display. If the light copy cannot be made, the original files are
 * kept instead. `renderer` is the app's WebGL renderer; onProgress(step) reports progress.
 */
export async function prepareModelAsset({ main, companions }, projectId, { source = '', renderer = null, onProgress = () => {} } = {}) {
  const originals = [main, ...companions]
  const originalUrls = originals.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
  const sourceBytes = originals.reduce((sum, file) => sum + file.size, 0)
  let stored = originals
  let detail = null

  try {
    onProgress('open')
    // The optimiser (and its exporter) is only loaded when a model is actually imported.
    const [{ disposeObject, makeLightCopy }, object] = await Promise.all([import('./models/modelOptimize.js'), loadModelObject(main.name, originalUrls, { waitForTextures: true })])

    try {
      if (!renderer) {
        throw new Error('No renderer for the light copy.')
      }

      const { glb, stats } = await makeLightCopy(object, { renderer, onProgress })
      const light = new File([glb], `${stemOf(source || main.name)}.glb`, { type: 'model/gltf-binary' })
      stored = [light]
      detail = { ...stats, sourceBytes, bytes: light.size, shellOnly: MODEL.keepOuterShellOnly }
    } catch (error) {
      console.warn('Spatial Archive: kept the original model files (no light copy).', error)
    } finally {
      disposeObject(object)
    }
  } finally {
    originalUrls.forEach(({ url }) => URL.revokeObjectURL(url))
  }

  const [mainFile, ...companionFiles] = stored
  const urls = stored.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
  let preparedModel

  try {
    preparedModel = await prepareModelAsync(await loadModelObject(mainFile.name, urls))
  } catch (error) {
    urls.forEach(({ url }) => URL.revokeObjectURL(url))
    throw error
  }

  const { x, y, z } = preparedModel.size
  const scale = MODEL.defaultMaxPx / Math.max(x, y)
  const now = new Date().toISOString()
  const fileRecords = stored.map((file) => ({ id: createFileId(), projectId, blob: file, name: file.name, type: file.type || '', size: file.size, createdAt: now }))
  const [mainRecord, ...companionRecords] = fileRecords

  return {
    url: urls[0].url,
    urls,
    files: fileRecords,
    mainName: mainFile.name,
    preparedModel,
    record: normalizeAsset({
      id: createAssetId(),
      projectId,
      type: 'model',
      title: titleFromFilename(source || main.name),
      filename: source || main.name,
      mimeType: mainRecord.type,
      fileId: mainRecord.id,
      bundle: companionRecords.map((record) => ({ name: record.name, fileId: record.id })),
      width: Math.round(x * scale),
      height: Math.round(y * scale),
      depth: Math.round(z * scale),
      detail,
      createdAt: now,
      updatedAt: now,
    }),
  }
}

export class SketchUpUnavailableError extends Error {}

export async function convertSketchUpFile(file, { onProgress = () => {} } = {}) {
  const endpoint = `${import.meta.env.BASE_URL}${MODEL.convertEndpoint}`
  let response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent(file.name) },
      body: file,
    })
  } catch {
    throw new SketchUpUnavailableError()
  }

  if (response.status === 404 || response.status === 405 || response.status === 403) {
    throw new SketchUpUnavailableError()
  }

  const { job, error } = await response.json().catch(() => ({}))

  if (!response.ok || !job) {
    throw new Error(error || 'SketchUp could not convert this file.')
  }

  // SketchUp takes a minute or more; the dev server reports when the export is ready.
  const jobUrl = `${endpoint}/${encodeURIComponent(job)}`
  let state = null

  while (!state || state.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, MODEL.convertPollMs))
    const poll = await fetch(jobUrl, { cache: 'no-store' }).catch(() => null)
    state = poll ? await poll.json().catch(() => null) : null

    if (!state) {
      throw new Error('Lost contact with the converter (is the dev server still running?).')
    }
  }

  if (state.state !== 'done') {
    throw new Error(state.error || 'SketchUp could not convert this file.')
  }

  onProgress('downloading')
  return Promise.all(
    state.files.map(async ({ name, type }) => {
      const download = await fetch(`${jobUrl}/${encodeURIComponent(name)}`)

      if (!download.ok) {
        throw new Error(`Could not fetch ${name} from the converter.`)
      }

      return new File([await download.blob()], name, { type })
    }),
  )
}
