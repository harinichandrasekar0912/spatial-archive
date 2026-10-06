import { FLOOR, GROUP, HISTORY, NOTE_COLORS, SEARCH, THREAD, THREAD_COLORS, WORKSPACE } from '../app/constants.js'
import {
  createConnectionId,
  createGroupId,
  loadFile,
  loadWorkspace,
  normalizeAsset,
  normalizeConnection,
  normalizeGroup,
  removeAssets,
  removeConnections,
  removeGroups,
  saveAssets,
  saveConnections,
  saveFile,
  saveGroups,
} from '../data/workspaceStore.js'
import { announce } from '../utils/dom.js'
import { clamp, easeInOutCubic, easeOutCubic, lerp } from '../utils/easing.js'
import { describeAsset, displayTitle, firstLine } from './assetText.js'
import { SketchUpUnavailableError, arrangeAround, convertSketchUpFile, createNoteRecord, groupFiles, prepareFileAsset, prepareModelAsset, preparePdfPreview } from './assetFactory.js'
import { extensionOf } from './models/modelLoader.js'
import { CAPTION_HEIGHT_PX } from './cardTextures.js'
import { createFloor } from './floor3d.js'
import { createFocusView } from './FocusView.js'
import { regroup, settleGroups } from './groups.js'
import { bubbleDistance, createGroupShapes, withBridges } from './groups3d.js'
import { createHistory, remember } from './history.js'
import { createNoteEditor } from './NoteEditor.js'
import { attachPointerControls } from './pointerControls.js'
import { CARD_RADIUS_PX, createWorkspaceScene } from './scene3d.js'
import { createSearchBar, searchItems } from './search.js'
import { createThreads } from './threads3d.js'
import { TAN_HALF_FOV, clampCameraZ, clampLayer, computeEntryView, fromWorldX, fromWorldY, itemZ, referenceLayer, toWorldLength, toWorldX, toWorldY } from './viewMath.js'
import './workspace.css'

const CAPTION_ALLOWANCE_PX = CAPTION_HEIGHT_PX + 10
// How long the depth guide stays after a keyboard / button layer change.
const GUIDE_LINGER_MS = 900
const COMPACT_FRAME_PX = 150
const NODE_RADIUS_PX = 6
// The thread node sits this far above the point where threads are tied (spec §100: "just
// outside its top-centre").
const NODE_LIFT_PX = 11

// The colour a new note or thread starts with: the one chosen last (as in Apple's apps).
const NOTE_COLOR_KEY = 'spatial-archive-note-color'
const THREAD_COLOR_KEY = 'spatial-archive-thread-color'

function readPreference(key, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(key)
    return allowed.some((color) => color.id === value) ? value : fallback
  } catch {
    return fallback
  }
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Not remembered; the default is used next time.
  }
}

/*
 * Workspace controller. Records are the source of truth; each item also carries its animated
 * depth (depthZ) and is mirrored into the Three.js scene by scene3d. Threads (connections) and
 * soft groups are records too, drawn by threads3d and groups3d. Every change made by hand is
 * recorded for undo / redo (history.js). A hidden list of buttons mirrors the cards, threads
 * and groups so keyboard and screen-reader users can reach every one.
 */
export function createWorkspace(root, { scene, reducedMotion, onRequestClose }) {
  const section = root.querySelector('[data-view="workspace"]')
  const canvas = section.querySelector('[data-workspace-canvas]')
  const selection = section.querySelector('[data-selection]')
  const selectionFrame = selection.querySelector('[data-selection-frame]')
  const selectionOutline = selection.querySelector('[data-selection-outline]')
  const selectionPolygon = selectionOutline.querySelector('polygon')
  const depthControl = selection.querySelector('[data-selection-depth]')
  const deleteControl = selection.querySelector('[data-action="delete-selected"]')
  const resizeControl = selection.querySelector('[data-resize-handle]')
  const connectNode = selection.querySelector('[data-connect-handle]')
  const noteSwatches = selection.querySelector('[data-note-swatches]')
  const layerLabel = selection.querySelector('[data-layer-label]')
  const threadControls = section.querySelector('[data-thread-controls]')
  const groupControls = section.querySelector('[data-group-controls]')
  const groupNode = groupControls.querySelector('[data-group-node]')
  const groupPill = groupControls.querySelector('.group-controls__pill')
  const groupCount = groupControls.querySelector('[data-group-count]')
  const depthGuide = section.querySelector('[data-depth-guide]')
  const itemList = section.querySelector('[data-item-list]')
  const chrome = section.querySelector('[data-workspace-chrome]')
  const title = section.querySelector('[data-workspace-title]')
  const addButton = chrome.querySelector('[data-action="toggle-add-menu"]')
  const addMenu = chrome.querySelector('[data-add-menu]')
  const fileInput = chrome.querySelector('[data-file-input]')
  const emptyHint = chrome.querySelector('[data-workspace-empty]')
  const statusLine = chrome.querySelector('[data-workspace-status]')
  const camera = scene.camera

  // Threads and groups, listed for keyboard and screen-reader users after the items.
  const relationList = document.createElement('ul')
  relationList.className = 'sr-only'
  relationList.setAttribute('aria-label', 'Threads and groups in this workspace')
  itemList.after(relationList)

  // A frame around the item a thread being pulled would be tied to.
  const connectTarget = document.createElement('div')
  connectTarget.className = 'connect-target'
  connectTarget.hidden = true
  canvas.appendChild(connectTarget)

  const scene3d = createWorkspaceScene(scene, { onModelMeasured })
  const floor = createFloor(scene)
  const threads = createThreads(scene, { reducedMotion })
  const groupShapes = createGroupShapes(scene)
  const history = createHistory()
  const items = new Map()
  const connections = new Map()
  const groups = new Map()
  const pendingSaves = new Map()
  const lastCamera = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN }
  let project = null
  let loaded = false
  let interactive = false
  let selectedId = null
  let selectedThreadId = null
  let selectedGroupId = null
  let hoveredThreadId = null
  let dirty = true
  let animating = false
  let guide = null
  // The first sync after a workspace loads places the floor directly instead of easing it.
  let placeFloorImmediately = true
  // The turn dial on the floor (selected item) is under the pointer.
  let dialHover = false
  // A change in progress (a drag, a note being written, the focus view), finished when it ends.
  let pendingEdit = null
  let noteEdit = null
  let focusEdit = null
  // A thread being pulled out of a node: { sourceId, targetId }.
  let connecting = null
  // A selected group being dragged: { groupId, start: Map id → { x, y } }.
  let groupDrag = null
  let noteColor = readPreference(NOTE_COLOR_KEY, NOTE_COLORS, NOTE_COLORS[0].id)
  let threadColor = readPreference(THREAD_COLOR_KEY, THREAD_COLORS, THREAD_COLORS[0].id)
  let searchResults = []
  let searchIndex = -1

  const guideDots = Array.from({ length: WORKSPACE.maxLayer + 1 }, () => {
    const dot = document.createElement('span')
    dot.className = 'depth-guide__dot'
    depthGuide.appendChild(dot)
    return dot
  })
  const guideLabel = document.createElement('span')
  guideLabel.className = 'depth-guide__label'
  depthGuide.appendChild(guideLabel)

  const isFrontFacing = () => Math.abs(camera.rotation.x) < 1e-3 && Math.abs(camera.rotation.y) < 1e-3
  const liveItems = () => [...items.values()].filter((item) => !item.exit)

  // ── Warm-up ─────────────────────────────────────────────────────────────────────────

  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

  /*
   * Everything the workspace reveal will draw, prepared while the screen is still dark: images
   * and models loaded (off the main thread); shaders compiled in parallel for both a fading and
   * a settled model; textures uploaded a few at a time. (The first real draw of each part comes
   * later, from warmUp, at a moment the navigator chooses.)
   */
  async function prepareReveal(projectId) {
    const current = () => project?.id === projectId
    await scene3d.whenSettled()

    if (!current()) {
      return
    }

    await scene.renderer.compileAsync(scene.world, camera)
    scene3d.setModelsOpaque(true)
    await scene.renderer.compileAsync(scene.world, camera)
    scene3d.setModelsOpaque(false)
    dirty = true

    let sliceStart = performance.now()

    for (const texture of scene3d.textures()) {
      if (!current()) {
        return
      }

      scene.renderer.initTexture(texture)

      if (performance.now() - sliceStart > 6) {
        await nextTask()
        sliceStart = performance.now()
      }
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────────────

  function reportSaveError(error) {
    console.error(error)
    announce('Could not save. Browser storage may be full or unavailable.')
  }

  function persist(record, { debounce = false } = {}) {
    record.updatedAt = new Date().toISOString()
    clearTimeout(pendingSaves.get(record.id))
    pendingSaves.delete(record.id)

    if (!debounce) {
      saveAssets([record]).catch(reportSaveError)
      return
    }

    pendingSaves.set(
      record.id,
      window.setTimeout(() => {
        pendingSaves.delete(record.id)
        saveAssets([record]).catch(reportSaveError)
      }, WORKSPACE.saveDebounceMs),
    )
  }

  function flushSaves() {
    pendingSaves.forEach((timer, id) => {
      clearTimeout(timer)
      const item = items.get(id)

      if (item && !item.exit) {
        saveAssets([item.record]).catch(reportSaveError)
      }
    })
    pendingSaves.clear()
  }

  // ── History (undo / redo) ───────────────────────────────────────────────────────────

  // The current state of a record (null if it does not exist).
  function current(kind, id) {
    if (kind === 'assets') {
      const item = items.get(id)
      return item && !item.exit ? item.record : null
    }

    return (kind === 'connections' ? connections : groups).get(id) || null
  }

  function beginChange(label, coalesceKey = null) {
    return { label, coalesceKey, assets: new Map(), connections: new Map(), groups: new Map() }
  }

  // Remember a record's state before it is changed (once per change).
  function touch(change, kind, id) {
    if (change && !change[kind].has(id)) {
      change[kind].set(id, remember(current(kind, id)))
    }
  }

  function finishChange(change) {
    if (change) {
      history.record(change, current)
    }
  }

  // Put records back as an undo / redo step has them (side: 'before' or 'after').
  async function applyHistory(entry, side) {
    const pick = (step) => (side === 'before' ? step.before : step.after)
    const restoring = []

    entry.groups.forEach((step) => setGroupRecord(step.id, pick(step)))

    entry.assets.forEach((step) => {
      const target = pick(step)
      const item = items.get(step.id)

      if (!target) {
        removeItem(step.id)
      } else if (item && !item.exit) {
        morphItem(item, target)
      } else {
        restoring.push(restoreAsset(target))
      }
    })

    entry.connections.forEach((step) => setConnectionRecord(step.id, pick(step)))
    refreshRelationList()
    dirty = true
    await Promise.all(restoring)
  }

  async function undo() {
    const entry = history.undo()

    if (!entry) {
      setStatus('Nothing to undo', { holdMs: 1200 })
      return
    }

    await applyHistory(entry, 'before')
    setStatus(`Undo ${entry.label}`, { holdMs: 1400 })
    announce(`Undone: ${entry.label}`)
  }

  async function redo() {
    const entry = history.redo()

    if (!entry) {
      setStatus('Nothing to redo', { holdMs: 1200 })
      return
    }

    await applyHistory(entry, 'after')
    setStatus(`Redo ${entry.label}`, { holdMs: 1400 })
    announce(`Redone: ${entry.label}`)
  }

  // An item glides to a remembered state (position eased; everything else at once).
  function morphItem(item, target) {
    const from = { x: item.record.x, y: item.record.y }
    const layer = item.record.z
    Object.assign(item.record, target, { updatedAt: new Date().toISOString() })
    // Saved as a copy: the record itself is about to be animated from where it was.
    saveAssets([structuredClone(item.record)]).catch(reportSaveError)

    if (item.record.z !== layer) {
      item.layerAnim = { from: item.depthZ, to: itemZ(item.record.z), start: performance.now() }
    }

    if (!reducedMotion && (from.x !== item.record.x || from.y !== item.record.y)) {
      item.tween = { from, to: { x: item.record.x, y: item.record.y }, start: performance.now() }
      Object.assign(item.record, from)
    }

    refreshListEntry(item)
    dirty = true
  }

  // Brings back an item that undo / redo needs again (its file is still in storage).
  async function restoreAsset(target) {
    const existing = items.get(target.id)

    // Still fading out: turn it straight round.
    if (existing?.exit) {
      existing.exit = null
      existing.listButton.disabled = false
      existing.enter = reducedMotion ? null : { start: performance.now() }
      morphItem(existing, target)
      updateEmptyHint()
      return
    }

    const projectId = project?.id
    const record = normalizeAsset({ ...target, updatedAt: new Date().toISOString() })

    try {
      if (record.type === 'note') {
        addItem(record, null, { animate: true })
      } else {
        const file = record.fileId ? await loadFile(record.fileId) : null

        if (!file) {
          throw new Error('The file is no longer stored.')
        }

        if (project?.id !== projectId || items.has(record.id)) {
          return
        }

        if (record.type === 'model') {
          const companions = (await Promise.all(record.bundle.map(({ fileId }) => loadFile(fileId)))).filter(Boolean)
          const urls = [file, ...companions].map((stored) => ({ name: stored.name, url: URL.createObjectURL(stored.blob) }))
          addItem(record, urls[0].url, { animate: true, model: { mainName: file.name, urls, preparedModel: null } })
        } else {
          const preview = record.previewId ? await loadFile(record.previewId) : null
          addItem(record, URL.createObjectURL(file.blob), { animate: true, previewUrl: preview ? URL.createObjectURL(preview.blob) : null })
        }
      }

      saveAssets([record]).catch(reportSaveError)
    } catch (error) {
      console.warn(error)
      announce(`Couldn't bring back ${describeAsset(record)}.`)
    }
  }

  function setConnectionRecord(id, record) {
    if (!record) {
      if (connections.delete(id)) {
        removeConnections([id]).catch(reportSaveError)
      }

      if (selectedThreadId === id) {
        selectThread(null)
      }

      return
    }

    const next = normalizeConnection({ ...record, updatedAt: new Date().toISOString() })
    connections.set(id, next)
    saveConnections([next]).catch(reportSaveError)
  }

  function setGroupRecord(id, record) {
    if (!record) {
      if (groups.delete(id)) {
        removeGroups([id]).catch(reportSaveError)
      }

      if (selectedGroupId === id) {
        selectGroup(null)
      }

      return
    }

    const next = normalizeGroup({ ...record, updatedAt: new Date().toISOString() })
    groups.set(id, next)
    saveGroups([next]).catch(reportSaveError)
  }

  // ── Items ───────────────────────────────────────────────────────────────────────────

  function updateEmptyHint() {
    emptyHint.hidden = !loaded || liveItems().length > 0
  }

  function addItem(record, url, { animate, model = null, previewUrl = null }) {
    record.z = clampLayer(record.z)
    const rotation = targetRotation(record)
    const item = {
      record,
      url,
      // PDFs: a picture of the first page (see webCopies.js).
      previewUrl,
      depthZ: itemZ(record.z),
      layerAnim: null,
      rotation,
      rotationTarget: rotation,
      rotationAnim: null,
      tween: null,
      exit: null,
      enter: animate && !reducedMotion ? { start: performance.now() } : null,
      visibility: animate && !reducedMotion ? 0 : 1,
      scale: 1,
    }

    if (model) {
      item.modelMain = model.mainName
      item.modelFiles = model.urls
      item.preparedModel = model.preparedModel
      item.extraUrls = model.urls.slice(1).map(({ url: extra }) => extra)
    }

    const entry = document.createElement('li')
    item.listButton = document.createElement('button')
    item.listButton.type = 'button'
    item.listButton.dataset.itemId = record.id
    item.listButton.textContent = describeAsset(record)
    entry.appendChild(item.listButton)
    itemList.appendChild(entry)

    items.set(record.id, item)
    scene3d.add(item)
    dirty = true
    updateEmptyHint()
    return item
  }

  function refreshListEntry(item) {
    item.listButton.textContent = describeAsset(item.record)
  }

  function removeItemNow(item) {
    scene3d.remove(item.record.id)
    item.listButton.parentElement?.remove()
    items.delete(item.record.id)
    revokeUrls(item)
    updateEmptyHint()
  }

  function revokeUrls(item) {
    ;[item.url, item.previewUrl, ...(item.extraUrls || [])].filter(Boolean).forEach((url) => URL.revokeObjectURL(url))
  }

  function clearItems() {
    scene3d.clear()
    itemList.replaceChildren()
    relationList.replaceChildren()
    items.forEach(revokeUrls)
    items.clear()
    connections.clear()
    groups.clear()
    threads.clear()
    groupShapes.clear()
    history.clear()
    selectedId = null
    selectedThreadId = null
    selectedGroupId = null
    hoveredThreadId = null
    connecting = null
    groupDrag = null
    pendingEdit = null
    noteEdit = null
    focusEdit = null
    searchResults = []
    searchIndex = -1
    guide = null
    depthGuide.hidden = true
    selection.hidden = true
    threadControls.hidden = true
    groupControls.hidden = true
    connectTarget.hidden = true
  }

  function select(id, { focus = false } = {}) {
    if (selectedId !== id) {
      selectedId = id
      dirty = true
    }

    if (id) {
      selectThread(null)
      selectGroup(null)
    }

    if (focus) {
      items.get(id)?.listButton.focus({ preventScroll: true })
    }
  }

  // Takes an item out of the workspace (fading), without recording anything.
  function removeItem(id) {
    const item = items.get(id)

    if (!item || item.exit) {
      return
    }

    if (noteEditor.isEditing(id)) {
      noteEditor.stop()
    }

    if (selectedId === id) {
      select(null)
    }

    clearTimeout(pendingSaves.get(id))
    pendingSaves.delete(id)
    item.exit = { start: performance.now() }
    item.listButton.disabled = true
    removeAssets([id]).catch(reportSaveError)
    dirty = true
    updateEmptyHint()
  }

  // Deleting by hand: the item, the threads tied to it, and any group it leaves behind.
  function deleteItem(id) {
    const item = items.get(id)

    if (!item || item.exit) {
      return
    }

    const change = beginChange('delete')
    touch(change, 'assets', id)
    threadsOf(id).forEach((connection) => {
      touch(change, 'connections', connection.id)
      setConnectionRecord(connection.id, null)
    })

    const groupId = item.record.groupId
    removeItem(id)

    if (groupId) {
      applyGroupChanges(settleGroups(groupEntries(), [groupId], { createGroupId }), change)
    }

    finishChange(change)
    refreshRelationList()
    announce(`${describeAsset(item.record)} deleted`)
    canvas.focus({ preventScroll: true })
  }

  // ── Depth ───────────────────────────────────────────────────────────────────────────

  function setLayer(item, layer) {
    const next = clampLayer(layer)

    if (next === item.record.z) {
      return
    }

    item.layerAnim = { from: item.depthZ, to: itemZ(next), start: performance.now() }
    item.record.z = next
    refreshListEntry(item)
    persist(item.record, { debounce: true })
    dirty = true
  }

  // A change made from the keyboard or a button, merged with repeats of the same kind.
  function keyedChange(item, kind, label, apply) {
    const change = beginChange(label, `${kind}:${item.record.id}`)
    touch(change, 'assets', item.record.id)
    item.tween = null
    apply()
    regroupAfter([item.record.id], change)
    finishChange(change)
  }

  function stepLayer(item, delta) {
    keyedChange(item, 'layer', 'change depth', () => setLayer(item, item.record.z + delta))
    guide = { id: item.record.id, until: performance.now() + GUIDE_LINGER_MS }
    announce(`Layer ${item.record.z}`)
  }

  // ── 3D models ───────────────────────────────────────────────────────────────────────

  // Once a model has loaded, its record takes on the model's real proportions.
  function onModelMeasured(item, size) {
    item.depthRatio = size.z / size.x
    const height = Math.round((item.record.width * size.y) / size.x)
    const depth = Math.round(item.record.width * item.depthRatio)

    if (Math.abs(height - item.record.height) > 1 || Math.abs(depth - item.record.depth) > 1) {
      item.record.height = height
      item.record.depth = depth
      persist(item.record, { debounce: true })
    }

    dirty = true
  }

  let statusTimer = null

  function lightCopyStatus(name, step) {
    return {
      open: `Opening ${name}…`,
      shell: `${name}: keeping the outer shell…`,
      simplify: `${name}: simplifying…`,
      save: `${name}: saving a light copy…`,
    }[step] || `Preparing ${name}…`
  }

  function setStatus(text, { holdMs = 0 } = {}) {
    clearTimeout(statusTimer)
    statusLine.textContent = text
    statusLine.hidden = !text

    if (text && holdMs) {
      statusTimer = window.setTimeout(() => setStatus(''), holdMs)
    }
  }

  // ── Angled panels ───────────────────────────────────────────────────────────────────

  function targetRotation(record) {
    return WORKSPACE.allowRotation ? (record.rotY * Math.PI) / 180 : 0
  }

  function setRotation(item, degrees) {
    const step = WORKSPACE.rotateStepDeg
    const next = clamp(Math.round(degrees / step) * step, -WORKSPACE.rotateMaxDeg, WORKSPACE.rotateMaxDeg)

    if (!WORKSPACE.allowRotation || next === item.record.rotY) {
      return
    }

    item.record.rotY = next
    refreshListEntry(item)
    persist(item.record, { debounce: true })
    dirty = true
  }

  // ── Placement ───────────────────────────────────────────────────────────────────────

  // New items go on the nearest layer in front of the camera, so they are always visible.
  function placementLayer() {
    return referenceLayer(scene.rig.getBase().z)
  }

  function pointOnLayer(screenX, screenY, layer) {
    const hit = scene3d.planeHit(screenX, screenY, itemZ(layer))
    return hit ? { x: fromWorldX(hit.x), y: fromWorldY(hit.y) } : { x: 0, y: 0 }
  }

  async function addFiles(fileList, screenPoint = null) {
    if (!project || !interactive) {
      return
    }

    const files = Array.from(fileList || [])

    if (!files.length) {
      return
    }

    const projectId = project.id
    const { bundles, sketchup, cards, unsupported } = await groupFiles(files)
    const prepared = (await Promise.all(cards.map((file) => prepareFileAsset(file, projectId)))).filter(Boolean)
    const failed = []

    for (const bundle of bundles) {
      try {
        prepared.push(await prepareModelAsset(bundle, projectId, { renderer: scene.renderer, onProgress: (step) => setStatus(lightCopyStatus(bundle.main.name, step)) }))
      } catch (error) {
        console.warn(error)
        failed.push(bundle.main.name)
      }
    }

    if (bundles.length && !failed.length) {
      setStatus('')
    }

    if (project?.id !== projectId) {
      prepared.forEach((entry) => (entry.urls || [{ url: entry.url }]).forEach(({ url }) => URL.revokeObjectURL(url)))
      return
    }

    const layer = placementLayer()
    const point = screenPoint || { x: scene.viewport.width / 2, y: scene.viewport.height / 2 }
    const centre = pointOnLayer(point.x, point.y, layer)

    if (prepared.length) {
      await placeAndSave(prepared, layer, centre)
    }

    sketchup.forEach((file) => convertAndAdd(file, layer, centre))

    const notes = []

    if (prepared.length) {
      notes.push(`${prepared.length} added on layer ${layer}`)
    }

    if (failed.length) {
      notes.push(`couldn't open ${failed.join(', ')}`)
    }

    if (unsupported.length) {
      notes.push(`${unsupported.length} unsupported file${unsupported.length > 1 ? 's' : ''} skipped`)
    }

    if (notes.length) {
      announce(notes.join(', '))
    }

    if (failed.length || (unsupported.length && !prepared.length && !sketchup.length)) {
      setStatus(failed.length ? `Couldn't open ${failed.join(', ')}.` : 'Supported: images, PDFs, 3D models (.glb, .gltf, .obj, .dae, .stl, .fbx) and SketchUp files.', { holdMs: 6000 })
    }
  }

  async function placeAndSave(prepared, layer, centre) {
    const records = prepared.map(({ record }) => Object.assign(record, { z: layer }))
    arrangeAround(records, centre)
    const change = beginChange(records.length > 1 ? `add ${records.length} items` : 'add')
    records.forEach((record) => touch(change, 'assets', record.id))
    prepared.forEach((entry) => addItem(entry.record, entry.url, { animate: true, model: entry.record.type === 'model' ? entry : null, previewUrl: entry.previewUrl || null }))
    select(records.at(-1).id, { focus: true })
    finishChange(change)

    try {
      for (const entry of prepared) {
        for (const file of entry.files || [entry.file]) {
          await saveFile(file)
        }
      }

      await saveAssets(records)
    } catch (error) {
      reportSaveError(error)
    }
  }

  let conversions = 0

  // SketchUp files are exported by the locally installed SketchUp (see tools/skp).
  async function convertAndAdd(file, layer, centre) {
    const projectId = project.id
    conversions += 1
    setStatus(`Converting ${file.name} with SketchUp… this can take a minute or two.`)

    try {
      const converted = await convertSketchUpFile(file, {
        onProgress: () => setStatus(`Opening ${file.name} as a 3D model…`),
      })
      // The export is a .dae plus the textures it uses (the converter lists the .dae first).
      const [main, ...companions] = converted

      if (!main || extensionOf(main.name) !== 'dae') {
        throw new Error('SketchUp did not produce a model.')
      }

      const asset = await prepareModelAsset({ main, companions }, projectId, {
        source: file.name,
        renderer: scene.renderer,
        onProgress: (step) => setStatus(lightCopyStatus(file.name, step)),
      })

      if (project?.id !== projectId) {
        asset.urls.forEach(({ url }) => URL.revokeObjectURL(url))
        return
      }

      await placeAndSave([asset], layer, centre)
      announce(`${file.name} added as a 3D model`)
      conversions -= 1
      setStatus(conversions ? `Converting… ${conversions} left` : '')
    } catch (error) {
      conversions -= 1
      const message = error instanceof SketchUpUnavailableError
        ? `${file.name}: SketchUp files can only be converted when the app runs on your computer with SketchUp installed. Or export it from SketchUp as .glb, .dae or .obj (File → Export → 3D Model) and drop that in.`
        : `Couldn't convert ${file.name}: ${error.message}`
      setStatus(message, { holdMs: 9000 })
      announce(message)
    }
  }

  function addNote() {
    const layer = placementLayer()
    const record = createNoteRecord(project.id, pointOnLayer(scene.viewport.width / 2, scene.viewport.height / 2, layer))
    record.z = layer
    record.color = noteColor
    const change = beginChange('add note')
    touch(change, 'assets', record.id)
    addItem(record, null, { animate: true })
    finishChange(change)
    saveAssets([record]).catch(reportSaveError)
    select(record.id)
    startEditing(items.get(record.id))
  }

  // ── Notes, focus ────────────────────────────────────────────────────────────────────

  function startEditing(item) {
    if (!item || item.record.type !== 'note') {
      return
    }

    select(item.record.id)
    scene3d.setHidden(item.record.id, true)
    noteEdit = beginChange('edit note')
    touch(noteEdit, 'assets', item.record.id)
    noteEditor.start(item)
    dirty = true
  }

  function openOrEdit(id) {
    const item = items.get(id)

    if (!item || item.exit || !isFrontFacing()) {
      return
    }

    if (item.record.type === 'note') {
      startEditing(item)
    } else {
      focusEdit = beginChange('edit details')
      touch(focusEdit, 'assets', id)
      focusView.open(item)
    }
  }

  function setNoteColor(item, colorId) {
    if (!item || item.record.type !== 'note' || item.record.color === colorId) {
      return
    }

    const change = beginChange('note colour')
    touch(change, 'assets', item.record.id)
    item.record.color = colorId
    persist(item.record)
    finishChange(change)
    noteColor = colorId
    writePreference(NOTE_COLOR_KEY, colorId)
    noteEditor.setColor(colorId)
    dirty = true
    announce(`Note colour: ${NOTE_COLORS.find((color) => color.id === colorId)?.label}`)
  }

  // PDF cards stored before first-page previews existed: draw and store one for each.
  async function addMissingPreviews(projectId) {
    const pending = liveItems().filter((item) => item.record.type === 'pdf' && !item.record.previewId && item.url)

    for (const item of pending) {
      if (project?.id !== projectId || item.exit) {
        return
      }

      try {
        const blob = await fetch(item.url).then((response) => response.blob())
        const preview = await preparePdfPreview(blob, item.record.filename, projectId)

        if (!preview || project?.id !== projectId || item.exit) {
          preview && URL.revokeObjectURL(preview.url)
          continue
        }

        await saveFile(preview.file)
        // The card keeps its size but takes the page's proportions.
        const longEdge = Math.max(item.record.width, item.record.height)
        const scale = longEdge / Math.max(preview.size.width, preview.size.height)
        item.record.previewId = preview.file.id
        item.record.width = Math.round(preview.size.width * scale)
        item.record.height = Math.round(preview.size.height * scale)
        item.record.detail = { ...(item.record.detail || {}), pages: preview.pages }
        item.previewUrl = preview.url
        persist(item.record)
        scene3d.refreshPreview(item)
        dirty = true
      } catch (error) {
        console.warn(error)
      }
    }
  }

  // ── Threads (connections) ───────────────────────────────────────────────────────────

  const threadsOf = (id) => [...connections.values()].filter((connection) => connection.sourceId === id || connection.targetId === id)

  function nameOf(id) {
    const item = items.get(id)

    if (item) {
      return displayTitle(item.record) || describeAsset(item.record).split(',')[0]
    }

    return groups.has(id) ? `a group of ${membersOf(id).length}` : 'an item'
  }

  // Where a thread is tied to an item: just above its top-centre, a little in front of its face.
  function itemAnchor(item) {
    const { record } = item
    const top = toWorldY(record.y) + (toWorldLength(record.height) / 2) * item.scale
    return { x: toWorldX(record.x), y: top + THREAD.anchorLift, z: item.depthZ + (record.type === 'model' ? 0 : THREAD.anchorFront), opacity: item.visibility }
  }

  function anchorOf(id) {
    const item = items.get(id)

    if (item) {
      return itemAnchor(item)
    }

    return groups.has(id) ? groupGeometry(id)?.anchor || null : null
  }

  function threadEnds() {
    const ends = []

    connections.forEach((connection) => {
      const a = anchorOf(connection.sourceId)
      const b = anchorOf(connection.targetId)

      if (a && b) {
        ends.push({ id: connection.id, color: connection.color, a, b, visibility: Math.min(a.opacity, b.opacity) })
      }
    })

    return ends
  }

  function selectThread(id) {
    if (selectedThreadId === id) {
      return
    }

    selectedThreadId = id
    threads.setSelected(id)

    if (id) {
      selectedId = null
      selectGroup(null)
      const connection = connections.get(id)
      announce(`Thread between ${nameOf(connection.sourceId)} and ${nameOf(connection.targetId)} selected`)
    }

    dirty = true
  }

  // What a thread pulled to this screen point would be tied to (an item, or a group's bubble).
  function connectTargetAt(clientX, clientY) {
    if (!connecting) {
      return null
    }

    const candidate = scene3d.pick(clientX, clientY) || groupAt(clientX, clientY)?.id || null
    const { sourceId } = connecting

    if (!candidate || candidate === sourceId) {
      return null
    }

    // An item and its own group are already together.
    if (items.get(sourceId)?.record.groupId === candidate || items.get(candidate)?.record.groupId === sourceId) {
      return null
    }

    return candidate
  }

  function beginConnect(sourceId) {
    if (!anchorOf(sourceId)) {
      return false
    }

    connecting = { sourceId, targetId: null }
    canvas.classList.add('is-connecting')
    return true
  }

  function moveConnect(clientX, clientY) {
    const source = connecting && anchorOf(connecting.sourceId)

    if (!source) {
      return
    }

    connecting.targetId = connectTargetAt(clientX, clientY)
    let end = connecting.targetId ? anchorOf(connecting.targetId) : null

    if (!end) {
      // The loose end follows the pointer across the source's own layer.
      const hit = scene3d.planeHit(clientX, clientY, source.z)
      end = hit ? { x: hit.x, y: hit.y, z: hit.z } : source
    }

    threads.setDraft({ a: source, b: end, color: threadColor })
    dirty = true
  }

  function endConnect(clientX, clientY) {
    if (!connecting) {
      return
    }

    const { sourceId } = connecting
    const targetId = Number.isFinite(clientX) ? connectTargetAt(clientX, clientY) : null
    connecting = null
    canvas.classList.remove('is-connecting')
    connectTarget.hidden = true

    if (!targetId) {
      threads.dropDraft()
      return
    }

    const existing = [...connections.values()].find(
      (connection) => (connection.sourceId === sourceId && connection.targetId === targetId) || (connection.sourceId === targetId && connection.targetId === sourceId),
    )

    if (existing) {
      threads.dropDraft()
      selectThread(existing.id)
      return
    }

    const record = normalizeConnection({ id: createConnectionId(), projectId: project.id, sourceId, targetId, color: threadColor })
    const change = beginChange('tie thread')
    touch(change, 'connections', record.id)
    connections.set(record.id, record)
    saveConnections([record]).catch(reportSaveError)
    threads.adoptDraft(record.id)
    finishChange(change)
    refreshRelationList()
    announce(`Thread tied between ${nameOf(sourceId)} and ${nameOf(targetId)}`)
  }

  function cutThread(id) {
    if (!connections.has(id)) {
      return
    }

    const change = beginChange('cut thread')
    touch(change, 'connections', id)
    threads.snip(id)
    setConnectionRecord(id, null)
    finishChange(change)
    refreshRelationList()
    announce('Thread cut')
    canvas.focus({ preventScroll: true })
  }

  function setThreadColor(id, colorId) {
    const connection = connections.get(id)

    if (!connection || connection.color === colorId) {
      return
    }

    const change = beginChange('thread colour')
    touch(change, 'connections', id)
    connection.color = colorId
    connection.updatedAt = new Date().toISOString()
    saveConnections([connection]).catch(reportSaveError)
    finishChange(change)
    threadColor = colorId
    writePreference(THREAD_COLOR_KEY, colorId)
    dirty = true
    announce(`Thread colour: ${THREAD_COLORS.find((color) => color.id === colorId)?.label}`)
  }

  // ── Groups ──────────────────────────────────────────────────────────────────────────

  const membersOf = (groupId) => liveItems().filter((item) => item.record.groupId === groupId)

  // An item's extent in world units, as grouping measures it (its settled layer and turn).
  function boxOf(item) {
    const { record } = item
    const turn = targetRotation(record)
    const halfWidth = toWorldLength(record.width) / 2
    const halfDepth = record.type === 'model' ? toWorldLength(record.depth || 0) / 2 : 0

    return {
      x: toWorldX(record.x),
      y: toWorldY(record.y),
      z: itemZ(record.z),
      hx: Math.abs(Math.cos(turn)) * halfWidth + Math.abs(Math.sin(turn)) * halfDepth,
      hy: toWorldLength(record.height) / 2,
      hz: Math.abs(Math.sin(turn)) * halfWidth + Math.abs(Math.cos(turn)) * halfDepth,
    }
  }

  const groupEntries = () => liveItems().map((item) => ({ id: item.record.id, box: boxOf(item), groupId: item.record.groupId }))

  // New group memberships (from regroup / settleGroups) applied, recorded and saved.
  function applyGroupChanges(changes, change) {
    changes.forEach((groupId, id) => {
      const item = items.get(id)

      if (item) {
        touch(change, 'assets', id)
        item.record.groupId = groupId
        persist(item.record)
      }
    })

    syncGroupRecords(change)

    if (changes.size) {
      refreshRelationList()
      dirty = true
    }
  }

  function regroupAfter(ids, change) {
    applyGroupChanges(regroup(groupEntries(), ids, { createGroupId }), change)
  }

  // Group records follow membership: one for every group with members, none for empty ones.
  // A group that dissolves takes its threads with it.
  function syncGroupRecords(change) {
    const counts = new Map()

    liveItems().forEach(({ record }) => {
      if (record.groupId) {
        counts.set(record.groupId, (counts.get(record.groupId) || 0) + 1)
      }
    })

    counts.forEach((count, groupId) => {
      if (!groups.has(groupId) && project) {
        touch(change, 'groups', groupId)
        setGroupRecord(groupId, { id: groupId, projectId: project.id })
      }
    })
    ;[...groups.keys()].forEach((groupId) => {
      if (!counts.has(groupId)) {
        threadsOf(groupId).forEach((connection) => {
          touch(change, 'connections', connection.id)
          setConnectionRecord(connection.id, null)
        })
        touch(change, 'groups', groupId)
        setGroupRecord(groupId, null)
      }
    })
  }

  // A group's shape as drawn this frame: member rectangles upright and on the floor, its plane,
  // the anchor its threads tie to and the bottom-centre its controls hang from.
  function groupGeometry(groupId) {
    const members = [...items.values()].filter((item) => item.record.groupId === groupId)

    if (!members.length) {
      return null
    }

    const rects = []
    const floorRects = []
    let z = 0
    let visibility = 0

    members.forEach((item) => {
      const { record } = item
      const halfWidth = (toWorldLength(record.width) / 2) * item.scale
      const halfDepth = record.type === 'model' ? (toWorldLength(record.depth || 0) / 2) * item.scale : 0
      const across = Math.abs(Math.cos(item.rotation)) * halfWidth + Math.abs(Math.sin(item.rotation)) * halfDepth
      const deep = Math.abs(Math.sin(item.rotation)) * halfWidth + Math.abs(Math.cos(item.rotation)) * halfDepth
      const caption = record.type === 'note' ? 0 : toWorldLength(CAPTION_ALLOWANCE_PX)
      const halfHeight = (toWorldLength(record.height) / 2) * item.scale
      // Captions sit under images, so the bubble takes them in.
      rects.push({ x: toWorldX(record.x), y: toWorldY(record.y) - caption / 2, hx: across, hy: halfHeight + caption / 2 })
      floorRects.push({ x: toWorldX(record.x), y: item.depthZ - WORKSPACE.itemOffset, hx: across, hy: Math.max(deep, FLOOR.footprintThickness) })
      z += item.depthZ
      visibility = Math.max(visibility, item.visibility)
    })

    z /= members.length
    const left = Math.min(...rects.map((rect) => rect.x - rect.hx))
    const right = Math.max(...rects.map((rect) => rect.x + rect.hx))
    const top = Math.max(...rects.map((rect) => rect.y + rect.hy)) + GROUP.padding
    const bottom = Math.min(...rects.map((rect) => rect.y - rect.hy)) - GROUP.padding
    const centreX = (left + right) / 2

    return {
      rects,
      floorRects,
      z,
      count: members.filter((item) => !item.exit).length,
      visibility: members.length > 1 ? visibility : 0,
      anchor: { x: centreX, y: top + THREAD.anchorLift * 0.5, z: z + THREAD.anchorFront, opacity: visibility },
      bottom: { x: centreX, y: bottom, z },
    }
  }

  function groupShapeData() {
    const shapes = []

    groups.forEach((group, id) => {
      const geometry = groupGeometry(id)

      if (geometry && geometry.count > 1) {
        shapes.push({ id, rects: geometry.rects, floorRects: geometry.floorRects, z: geometry.z, visibility: geometry.visibility, selected: id === selectedGroupId || connecting?.targetId === id })
      }
    })

    return shapes
  }

  // The group whose bubble (not one of its items) is under a screen point: { id, z } or null.
  function groupAt(clientX, clientY) {
    let found = null

    groups.forEach((group, id) => {
      const geometry = groupGeometry(id)

      if (!geometry || geometry.count < 2) {
        return
      }

      const hit = scene3d.planeHit(clientX, clientY, geometry.z)

      if (hit && bubbleDistance({ x: hit.x, y: hit.y }, withBridges(geometry.rects)) < 0 && (!found || geometry.z > found.z)) {
        found = { id, z: geometry.z }
      }
    })

    return found
  }

  function selectGroup(id) {
    if (selectedGroupId === id) {
      return
    }

    selectedGroupId = id

    if (id) {
      selectedId = null
      selectThread(null)
      announce(`Group of ${membersOf(id).length} selected`)
    }

    dirty = true
  }

  function ungroup(groupId) {
    const members = membersOf(groupId)

    if (!members.length) {
      return
    }

    const change = beginChange('ungroup')
    applyGroupChanges(new Map(members.map((item) => [item.record.id, null])), change)
    finishChange(change)
    announce('Ungrouped')
  }

  function beginGroupMove(groupId) {
    const members = membersOf(groupId)
    pendingEdit = beginChange('move group')
    members.forEach((item) => {
      item.tween = null
      touch(pendingEdit, 'assets', item.record.id)
    })
    groupDrag = { groupId, start: new Map(members.map((item) => [item.record.id, { x: item.record.x, y: item.record.y }])) }
  }

  // Moves the dragged group by a world-space offset from where the drag began.
  function moveGroupBy(dx, dy) {
    if (!groupDrag) {
      return
    }

    groupDrag.start.forEach((start, id) => {
      const item = items.get(id)

      if (item) {
        item.record.x = start.x + fromWorldX(dx)
        item.record.y = start.y + fromWorldY(dy)
      }
    })

    dirty = true
  }

  function endGroupMove(moved) {
    if (!groupDrag) {
      return
    }

    const ids = [...groupDrag.start.keys()].filter((id) => items.has(id))
    ids.forEach((id) => persist(items.get(id).record))

    if (moved) {
      regroupAfter(ids, pendingEdit)
    }

    finishChange(pendingEdit)
    pendingEdit = null
    groupDrag = null
  }

  // ── Search ──────────────────────────────────────────────────────────────────────────

  function runSearch(query) {
    if (!query.trim()) {
      searchResults = []
      searchIndex = -1
      searchBar.setResult(null)
      return
    }

    const previous = searchResults[searchIndex]
    searchResults = searchItems(liveItems(), query)

    if (!searchResults.length) {
      searchIndex = -1
      searchBar.setResult({ index: 0, total: 0 })
      announce('No match')
      return
    }

    // Typing more of the same word keeps the match in view; otherwise go to the best one.
    const kept = previous ? searchResults.indexOf(previous) : -1
    searchIndex = kept >= 0 ? kept : 0
    searchBar.setResult({ index: searchIndex, total: searchResults.length })

    if (kept < 0) {
      goToMatch()
    }
  }

  function stepSearch(delta) {
    searchResults = searchResults.filter((item) => items.get(item.record.id) === item && !item.exit)

    if (!searchResults.length) {
      return
    }

    searchIndex = (searchIndex + delta + searchResults.length) % searchResults.length
    searchBar.setResult({ index: searchIndex, total: searchResults.length })
    goToMatch()
  }

  function goToMatch() {
    const item = searchResults[searchIndex]

    if (!item || item.exit) {
      return
    }

    select(item.record.id)
    flyTo(item)
    announce(`${describeAsset(item.record)}. ${searchIndex + 1} of ${searchResults.length}.`)
  }

  /*
   * Glides the camera to an item so it takes centre stage: centred, facing it, filling about
   * SEARCH.fillHeight of the screen. On longer journeys the path eases back mid-way (a gentle
   * arc away and in again), so the move keeps its bearings in the space.
   */
  function flyTo(item) {
    const { record } = item
    const turn = targetRotation(record)
    const captionPx = record.type === 'note' ? 0 : CAPTION_ALLOWANCE_PX
    const halfDepth = record.type === 'model' ? toWorldLength(record.depth || 0) / 2 : 0
    const halfWidth = Math.abs(Math.cos(turn)) * (toWorldLength(record.width) / 2) + Math.abs(Math.sin(turn)) * halfDepth
    const halfHeight = toWorldLength(record.height + captionPx) / 2
    const aspect = scene.viewport.width / Math.max(1, scene.viewport.height)
    const distance = Math.max(halfHeight / (SEARCH.fillHeight * TAN_HALF_FOV), halfWidth / (SEARCH.fillWidth * TAN_HALF_FOV * aspect), WORKSPACE.minCameraGap + 0.6)
    const front = itemZ(record.z) + reachOf(record, turn)
    const target = { x: toWorldX(record.x), y: toWorldY(record.y + captionPx / 2), z: clampCameraZ(front + distance), yaw: 0, pitch: 0 }
    const from = scene.rig.getPose()
    const lateral = Math.hypot(target.x - from.x, target.y - from.y)
    const journey = Math.hypot(lateral, target.z - from.z)
    const highest = WORKSPACE.layer0Z + WORKSPACE.maxCameraDistance
    const lift = Math.max(0, Math.min(SEARCH.maxLift, lateral * SEARCH.liftPerUnit, highest - Math.max(from.z, target.z)))

    scene.rig.startMove({
      to: target,
      travelMs: reducedMotion ? 0 : clamp(SEARCH.minTravelMs + 170 * Math.sqrt(journey), SEARCH.minTravelMs, SEARCH.maxTravelMs),
      travelKeys: ['x', 'y', 'z', 'yaw', 'pitch'],
      ease: easeInOutCubic,
      lift: { z: lift },
      now: performance.now(),
    })
  }

  // ── View framing ────────────────────────────────────────────────────────────────────

  // How far an item reaches towards the camera beyond its layer (turned cards, models).
  function reachOf(record, turn) {
    const halfWidth = toWorldLength(record.width) / 2
    const halfDepth = record.type === 'model' ? toWorldLength(record.depth || 0) / 2 : 0
    return Math.abs(Math.sin(turn)) * halfWidth + Math.abs(Math.cos(turn)) * halfDepth
  }

  /*
   * Every live item as a box, the floor's height, and the floor's front edge: one layer in
   * front of the front-most footprint (layer 0 at least), on a grid line.
   */
  function layout() {
    let lowestBottom = Infinity
    let reach = 0
    const boxes = liveItems().map(({ record }) => {
      const y = toWorldY(record.y)
      const halfHeight = toWorldLength(record.height) / 2
      const turn = targetRotation(record)
      const halfWidth = toWorldLength(record.width) / 2
      const halfDepth = record.type === 'model' ? toWorldLength(record.depth || 0) / 2 : 0
      const itemReach = reachOf(record, turn)
      lowestBottom = Math.min(lowestBottom, y - halfHeight)
      reach = Math.max(reach, itemReach - record.z * WORKSPACE.layerSpacing)
      return {
        x: toWorldX(record.x),
        y,
        z: itemZ(record.z) + itemReach,
        halfWidth: Math.abs(Math.cos(turn)) * halfWidth + Math.abs(Math.sin(turn)) * halfDepth,
        halfHeight,
      }
    })
    const layersInFront = Math.ceil(Math.max(0, reach) / WORKSPACE.layerSpacing - 1e-6) + 1
    return { boxes, floorY: floor.levelFor(lowestBottom), frontZ: WORKSPACE.layer0Z + layersInFront * WORKSPACE.layerSpacing }
  }

  // Everything in view, centred, with the floor's front edge on the bottom of the screen.
  function entryView() {
    const { boxes, floorY, frontZ } = layout()
    return { ...computeEntryView(boxes, { floorY, frontZ }, scene.viewport), yaw: 0, pitch: 0, floorY }
  }

  function fitAll() {
    const view = entryView()
    floor.setFrontZ(view.frontZ)
    scene.rig.startMove({
      to: { x: view.x, y: view.y, z: view.z, yaw: 0, pitch: 0 },
      travelMs: reducedMotion ? 0 : WORKSPACE.homeMs,
      travelKeys: ['x', 'y', 'z', 'yaw', 'pitch'],
      now: performance.now(),
    })
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────────────

  function syncItems(now) {
    let stillAnimating = false
    const footprints = []
    let lowestBottom = Infinity

    for (const item of items.values()) {
      let scale = 1
      let opacity = 1

      if (item.enter) {
        const t = clamp((now - item.enter.start) / WORKSPACE.cardEnterMs)
        scale = 0.92 + 0.08 * easeOutCubic(t)
        opacity = easeOutCubic(t)
        item.enter = t >= 1 ? null : item.enter
        stillAnimating ||= t < 1
      }

      if (item.exit) {
        const t = clamp((now - item.exit.start) / (reducedMotion ? 1 : WORKSPACE.cardExitMs))

        if (t >= 1) {
          removeItemNow(item)
          continue
        }

        scale = 1 - 0.08 * easeOutCubic(t)
        opacity = 1 - easeOutCubic(t)
        stillAnimating = true
      }

      // Undo / redo glides an item back to where it was.
      if (item.tween) {
        const t = clamp((now - item.tween.start) / HISTORY.morphMs)
        const eased = easeInOutCubic(t)
        item.record.x = lerp(item.tween.from.x, item.tween.to.x, eased)
        item.record.y = lerp(item.tween.from.y, item.tween.to.y, eased)

        if (t >= 1) {
          Object.assign(item.record, item.tween.to)
          item.tween = null
        } else {
          stillAnimating = true
        }
      }

      item.visibility = opacity
      item.scale = scale

      if (item.layerAnim) {
        const t = clamp((now - item.layerAnim.start) / (reducedMotion ? 1 : WORKSPACE.layerChangeMs))
        item.depthZ = lerp(item.layerAnim.from, item.layerAnim.to, easeOutCubic(t))
        item.layerAnim = t >= 1 ? null : item.layerAnim
        stillAnimating ||= t < 1
      } else {
        item.depthZ = itemZ(item.record.z)
      }

      // A note being edited turns to face you, then turns back to its angle.
      const rotationTarget = noteEditor.isEditing(item.record.id) ? 0 : targetRotation(item.record)

      if (rotationTarget !== item.rotationTarget) {
        item.rotationAnim = { from: item.rotation, to: rotationTarget, start: now }
        item.rotationTarget = rotationTarget
      }

      if (item.rotationAnim) {
        const t = clamp((now - item.rotationAnim.start) / (reducedMotion ? 1 : WORKSPACE.rotateChangeMs))
        item.rotation = lerp(item.rotationAnim.from, item.rotationAnim.to, easeOutCubic(t))
        item.rotationAnim = t >= 1 ? null : item.rotationAnim
        stillAnimating ||= t < 1
      }

      if (item.record.type === 'model' && item.depthRatio) {
        item.record.depth = Math.round(item.record.width * item.depthRatio)
      }

      scene3d.sync(item, { z: item.depthZ, scale, opacity, rotation: item.rotation })

      // Footprints lie on the layer's own grid line (cards float itemOffset in front of it).
      const halfHeight = (toWorldLength(item.record.height) / 2) * scale
      footprints.push({
        x: toWorldX(item.record.x),
        y: toWorldY(item.record.y),
        z: item.depthZ - WORKSPACE.itemOffset,
        halfWidth: (toWorldLength(item.record.width) / 2) * scale,
        halfHeight,
        halfDepth: item.record.type === 'model' ? (toWorldLength(item.record.depth || 0) / 2) * scale : 0,
        rotation: item.rotation,
        opacity,
      })

      if (!item.exit) {
        lowestBottom = Math.min(lowestBottom, toWorldY(item.record.y) - halfHeight)
      }
    }

    floor.setTargetLevel(lowestBottom, now, { immediate: placeFloorImmediately })
    placeFloorImmediately = false
    floor.syncFootprints(footprints)
    return stillAnimating
  }

  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const place = (element, x, y) => {
    element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
  }

  function markSwatches(container, colorId) {
    container.querySelectorAll('[data-color]').forEach((swatch) => {
      swatch.setAttribute('aria-checked', String(swatch.dataset.color === colorId))
    })
  }

  // Controls are placed from the card's projected corners, so they follow turned panels too.
  function placeSelection() {
    const item = items.get(selectedId)
    const editing = noteEditor.editing()

    if (!item || item.exit || !interactive || !isFrontFacing() || editing === item) {
      selection.hidden = true
      floor.setDial(null)
      return
    }

    const { corners, behind } = scene3d.projectCorners(item.record, item.depthZ, item.rotation)

    if (behind) {
      selection.hidden = true
      floor.setDial(null)
      return
    }

    // The turn dial lies on the floor, just in front of the item's footprint.
    floor.setDial(WORKSPACE.allowRotation ? dialPlace(item) : null, { hover: dialHover })

    const [topLeft, topRight, bottomRight, bottomLeft] = corners
    const turned = Math.abs(item.rotation) > 0.01
    const zoom = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) / item.record.height
    const width = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x))
    selection.hidden = false

    selectionFrame.hidden = turned
    selectionOutline.hidden = !turned

    if (turned) {
      selectionPolygon.setAttribute('points', corners.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))
    } else {
      place(selectionFrame, topLeft.x, topLeft.y)
      selectionFrame.style.width = `${(topRight.x - topLeft.x).toFixed(2)}px`
      selectionFrame.style.height = `${(bottomLeft.y - topLeft.y).toFixed(2)}px`
      selectionFrame.style.setProperty('--corner', `${(CARD_RADIUS_PX * zoom).toFixed(2)}px`)
    }

    // The thread node, just outside the top-centre (its threads are tied just below it).
    const anchor = itemAnchor(item)
    const tie = scene3d.toScreen(anchor.x, anchor.y, anchor.z)
    const node = { x: tie.x, y: tie.y - NODE_LIFT_PX }
    connectNode.dataset.source = item.record.id
    connectNode.hidden = Boolean(connecting)
    place(connectNode, node.x - NODE_RADIUS_PX, node.y - NODE_RADIUS_PX)

    // Far-away cards are small on screen: the depth control moves beside the card instead.
    // Otherwise it sits above the top-left corner, clear of the thread node.
    const depthWidth = depthControl.offsetWidth
    const depthHeight = depthControl.offsetHeight

    if (width < COMPACT_FRAME_PX) {
      const left = midpoint(topLeft, bottomLeft)
      place(depthControl, Math.min(topLeft.x, bottomLeft.x) - depthWidth - 10, left.y - depthHeight / 2)
    } else {
      place(depthControl, Math.min(topLeft.x - 4, node.x - NODE_RADIUS_PX - 10 - depthWidth), Math.min(topLeft.y, topRight.y) - depthHeight - 8)
    }

    place(deleteControl, topRight.x - 12, topRight.y - 12)

    const arc = CARD_RADIUS_PX * zoom + 9
    resizeControl.style.setProperty('--arc', `${arc.toFixed(2)}px`)
    place(resizeControl, bottomRight.x + 9 - arc, bottomRight.y + 9 - arc)

    // Notes: their colours, in a small row centred under the card.
    noteSwatches.hidden = item.record.type !== 'note'

    if (!noteSwatches.hidden) {
      markSwatches(noteSwatches, item.record.color)
      const bottom = midpoint(bottomLeft, bottomRight)
      const swatchWidth = noteSwatches.offsetWidth
      place(noteSwatches, clamp(bottom.x - swatchWidth / 2, 8, scene.viewport.width - swatchWidth - 8), Math.min(Math.max(bottomLeft.y, bottomRight.y) + 12, scene.viewport.height - noteSwatches.offsetHeight - 8))
    }

    const turn = item.record.rotY ? ` · ${item.record.rotY}°` : ''
    layerLabel.textContent = `LAYER ${item.record.z}${turn}`
  }

  // A pill by the middle of the selected thread: its colours, and scissors to cut it. It sits
  // below the thread, or above it if that would cover an item.
  function placeThreadControls() {
    if (!selectedThreadId || !interactive || !isFrontFacing() || !threads.has(selectedThreadId)) {
      threadControls.hidden = true
      return
    }

    const middle = threads.pointAt(selectedThreadId, 0.5)

    if (!middle || middle.behind) {
      threadControls.hidden = true
      return
    }

    threadControls.hidden = false
    markSwatches(threadControls, connections.get(selectedThreadId)?.color)
    const { width, height } = scene.viewport
    const pillWidth = threadControls.offsetWidth
    const pillHeight = threadControls.offsetHeight
    const x = clamp(middle.x - pillWidth / 2, 8, width - pillWidth - 8)
    const cardRects = liveItems().map((item) => scene3d.screenRect(item.record, item.depthZ, item.rotation)).filter((rect) => !rect.behind)
    const covered = (y) =>
      cardRects.reduce((area, rect) => {
        const overlapX = Math.min(x + pillWidth, rect.left + rect.width) - Math.max(x, rect.left)
        const overlapY = Math.min(y + pillHeight, rect.top + rect.height) - Math.max(y, rect.top)
        return area + Math.max(0, overlapX) * Math.max(0, overlapY)
      }, 0)
    const candidates = [clamp(middle.y + 16, 8, height - pillHeight - 8), clamp(middle.y - 16 - pillHeight, 8, height - pillHeight - 8)]
    const y = covered(candidates[0]) <= covered(candidates[1]) ? candidates[0] : candidates[1]
    place(threadControls, x, y)
  }

  // The selected group: its thread node at the top of the bubble, and a pill under it.
  function placeGroupControls() {
    const geometry = selectedGroupId && interactive && isFrontFacing() ? groupGeometry(selectedGroupId) : null

    if (!geometry || geometry.count < 2) {
      groupControls.hidden = true
      return
    }

    const tie = scene3d.toScreen(geometry.anchor.x, geometry.anchor.y, geometry.anchor.z)
    const node = { x: tie.x, y: tie.y - NODE_LIFT_PX, behind: tie.behind }
    const bottom = scene3d.toScreen(geometry.bottom.x, geometry.bottom.y, geometry.bottom.z)

    if (node.behind || bottom.behind) {
      groupControls.hidden = true
      return
    }

    groupControls.hidden = false
    groupCount.textContent = `${geometry.count} ITEMS`
    groupNode.dataset.source = selectedGroupId
    groupNode.hidden = Boolean(connecting)
    place(groupNode, node.x - NODE_RADIUS_PX, node.y - NODE_RADIUS_PX)
    const { width, height } = scene.viewport
    place(groupPill, clamp(bottom.x - groupPill.offsetWidth / 2, 8, width - groupPill.offsetWidth - 8), clamp(bottom.y + 10, 8, height - groupPill.offsetHeight - 8))
  }

  // While a thread is being pulled: a frame around the item it would be tied to.
  function placeConnectTarget() {
    const item = connecting?.targetId ? items.get(connecting.targetId) : null

    if (!item) {
      connectTarget.hidden = true
      return
    }

    const rect = scene3d.screenRect(item.record, item.depthZ, item.rotation)
    connectTarget.hidden = rect.behind
    place(connectTarget, rect.left - 4, rect.top - 4)
    connectTarget.style.width = `${(rect.width + 8).toFixed(1)}px`
    connectTarget.style.height = `${(rect.height + 8).toFixed(1)}px`
    connectTarget.style.borderRadius = `${(CARD_RADIUS_PX * rect.zoom + 4).toFixed(1)}px`
  }

  function dialPlace(item) {
    return { x: toWorldX(item.record.x), z: item.depthZ - WORKSPACE.itemOffset + reachOf(item.record, item.rotation) + FLOOR.dialGap }
  }

  // The depth guide: the card's lattice column, one dot per layer, converging on the
  // vanishing point, with the card's current layer marked.
  function placeDepthGuide(now) {
    const item = guide ? items.get(guide.id) : null

    if (!item || item.exit || now > guide.until) {
      guide = null
      depthGuide.hidden = true
      return
    }

    if (!isFrontFacing()) {
      depthGuide.hidden = true
      return
    }

    const x = toWorldX(item.record.x)
    const y = toWorldY(item.record.y)
    depthGuide.hidden = false

    guideDots.forEach((dot, layer) => {
      const point = scene3d.toScreen(x, y, itemZ(layer))
      dot.hidden = point.behind
      dot.classList.toggle('is-current', layer === item.record.z)
      dot.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`

      if (layer === item.record.z) {
        guideLabel.textContent = `LAYER ${layer}`
        guideLabel.style.transform = `translate3d(${(point.x + 12).toFixed(1)}px, ${(point.y - 7).toFixed(1)}px, 0)`
      }
    })
  }

  // Threads and groups in the hidden list (focus one to select it; Delete cuts a thread).
  function refreshRelationList() {
    const entries = []

    connections.forEach((connection) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.threadId = connection.id
      button.textContent = `Thread between ${nameOf(connection.sourceId)} and ${nameOf(connection.targetId)}`
      entries.push(button)
    })

    groups.forEach((group, id) => {
      const members = membersOf(id)

      if (members.length > 1) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.groupId = id
        button.textContent = `Group of ${members.length}: ${members.map((item) => displayTitle(item.record) || 'untitled').join(', ')}`
        entries.push(button)
      }
    })

    relationList.replaceChildren(
      ...entries.map((button) => {
        const entry = document.createElement('li')
        entry.appendChild(button)
        return entry
      }),
    )
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────

  function setAddMenu(open, { focusFirst = false } = {}) {
    addMenu.hidden = !open
    addButton.setAttribute('aria-expanded', String(open))
    addButton.classList.toggle('is-open', open)

    if (open && focusFirst) {
      addMenu.querySelector('button')?.focus()
    }
  }

  section.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action]')
    const action = control?.dataset.action
    const selected = items.get(selectedId)

    if (!action || !interactive) {
      return
    }

    if (action === 'toggle-add-menu') {
      setAddMenu(addMenu.hidden, { focusFirst: event.detail === 0 })
    } else if (action === 'add-note') {
      setAddMenu(false)
      addNote()
    } else if (action === 'add-file') {
      setAddMenu(false)
      fileInput.click()
    } else if (action === 'delete-selected' && selected) {
      deleteItem(selected.record.id)
    } else if (action === 'layer-back' && selected) {
      stepLayer(selected, 1)
    } else if (action === 'layer-forward' && selected) {
      stepLayer(selected, -1)
    } else if (action === 'note-color' && selected) {
      setNoteColor(selected, control.dataset.color)
    } else if (action === 'thread-color' && selectedThreadId) {
      setThreadColor(selectedThreadId, control.dataset.color)
    } else if (action === 'cut-thread' && selectedThreadId) {
      cutThread(selectedThreadId)
    } else if (action === 'ungroup' && selectedGroupId) {
      ungroup(selectedGroupId)
    } else if (action === 'toggle-search') {
      searchBar.isOpen() ? searchBar.close() : searchBar.open()
    } else if (action === 'close-search') {
      searchBar.close()
    } else if (action === 'search-next') {
      stepSearch(1)
    } else if (action === 'search-previous') {
      stepSearch(-1)
    } else if (action === 'home') {
      fitAll()
    } else if (action === 'close-workspace') {
      onRequestClose()
    }
  })

  itemList.addEventListener('focusin', (event) => {
    const id = event.target.dataset?.itemId

    if (id && interactive) {
      select(id)
    }
  })

  relationList.addEventListener('focusin', (event) => {
    const { threadId, groupId } = event.target.dataset || {}

    if (!interactive) {
      return
    }

    if (threadId) {
      selectThread(threadId)
    } else if (groupId) {
      selectGroup(groupId)
    }
  })

  // Activation from assistive technology (keyboard Enter is handled in handleKeyDown).
  itemList.addEventListener('click', (event) => {
    const id = event.target.closest('[data-item-id]')?.dataset.itemId

    if (id && interactive) {
      openOrEdit(id)
    }
  })

  document.addEventListener('pointerdown', (event) => {
    if (!addMenu.hidden && !event.target.closest('.add-control')) {
      setAddMenu(false)
    }
  })

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files)
    fileInput.value = ''
  })

  // Drag files from the desktop straight into the volume (spec §90).
  let dragDepth = 0
  const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')

  section.addEventListener('dragenter', (event) => {
    if (interactive && carriesFiles(event)) {
      dragDepth += 1
      section.classList.add('is-drop-target')
    }
  })

  section.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)

    if (!dragDepth) {
      section.classList.remove('is-drop-target')
    }
  })

  section.addEventListener('dragover', (event) => {
    if (interactive && carriesFiles(event)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  })

  section.addEventListener('drop', (event) => {
    dragDepth = 0
    section.classList.remove('is-drop-target')

    if (interactive && carriesFiles(event)) {
      event.preventDefault()
      addFiles(event.dataTransfer.files, { x: event.clientX, y: event.clientY })
    }
  })

  // Paste screenshots directly into the workspace.
  document.addEventListener('paste', (event) => {
    const inField = event.target.closest?.('input, textarea')

    if (interactive && !inField && !focusView.isOpen() && event.clipboardData?.files.length) {
      event.preventDefault()
      addFiles(event.clipboardData.files)
    }
  })

  window.addEventListener('resize', () => {
    dirty = true
  })

  // ── Sub-controllers ─────────────────────────────────────────────────────────────────

  const searchBar = createSearchBar(chrome, {
    onQuery: runSearch,
    onStep: stepSearch,
    onClose() {
      searchResults = []
      searchIndex = -1
    },
  })

  const noteEditor = createNoteEditor(section.querySelector('[data-note-layer]'), {
    onInput(item, text) {
      item.record.notes = text
      item.record.title = firstLine(text)
      refreshListEntry(item)
      persist(item.record, { debounce: true })
    },
    onStop(item, text, { restoreFocus }) {
      item.record.notes = text
      item.record.title = firstLine(text)
      refreshListEntry(item)
      persist(item.record)
      scene3d.setHidden(item.record.id, false)
      finishChange(noteEdit)
      noteEdit = null
      dirty = true

      if (restoreFocus) {
        item.listButton.focus({ preventScroll: true })
      }
    },
  })

  const focusView = createFocusView(section, {
    reducedMotion,
    getCardRect(item) {
      const rect = scene3d.screenRect(item.record, item.depthZ, item.rotation)
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, radius: CARD_RADIUS_PX * rect.zoom }
    },
    setCardHidden(item, hidden) {
      scene3d.setHidden(item.record.id, hidden)
      scene.requestRender()
    },
    lendModel: (item) => scene3d.lendModel(item.record.id),
    returnModel(item) {
      scene3d.returnModel(item.record.id)
      dirty = true
    },
    setBackgroundInert(value) {
      canvas.inert = value
      chrome.inert = value
    },
    onChange(item) {
      refreshListEntry(item)
      persist(item.record, { debounce: true })
      dirty = true
    },
    // However it closes, the edits made in it become one undo step.
    onFinish() {
      finishChange(focusEdit)
      focusEdit = null
    },
    onClosed(item) {
      item.listButton.focus({ preventScroll: true })
    },
  })

  const pointer = attachPointerControls({
    canvas,
    scene3d,
    rig: scene.rig,
    viewport: scene.viewport,
    isEnabled: () => interactive && !focusView.isOpen(),
    getItem: (id) => items.get(id) || null,
    getSelected: () => items.get(selectedId) || null,
    getSelectedGroup: () => selectedGroupId,
    itemDepth: (item) => item.depthZ,
    itemRotation: (item) => item.rotation,
    hitsDial(clientX, clientY) {
      const ndc = { x: (clientX / scene.viewport.width) * 2 - 1, y: -(clientY / scene.viewport.height) * 2 + 1 }
      return floor.hitsDial(ndc, camera)
    },
    setDialHover(value) {
      if (value !== dialHover) {
        dialHover = value
        dirty = true
      }
    },
    setRotation,
    select,
    openOrEdit,
    setLayer,
    setDepthGuide(item) {
      if (item) {
        guide = { id: item.record.id, until: Infinity }
      } else if (guide) {
        guide.until = performance.now() + GUIDE_LINGER_MS
      }

      dirty = true
    },
    markDirty: () => {
      dirty = true
    },
    // A drag, resize, depth change or turn begins: remember the item as it was.
    beginEdit(item, label) {
      item.tween = null
      pendingEdit = beginChange(label)
      touch(pendingEdit, 'assets', item.record.id)
    },
    // …and ends: save it, regroup it if it was put down somewhere new, record the step.
    commit(item, { moved = true } = {}) {
      persist(item.record)

      if (moved && pendingEdit) {
        regroupAfter([item.record.id], pendingEdit)
      }

      finishChange(pendingEdit)
      pendingEdit = null
    },
    pickThread: (clientX, clientY) => threads.pick(clientX, clientY),
    selectThread,
    setThreadHover(id) {
      if (id !== hoveredThreadId) {
        hoveredThreadId = id
        threads.setHovered(id)
        dirty = true
      }
    },
    groupAt,
    selectGroup,
    beginGroupMove,
    moveGroupBy,
    endGroupMove,
    beginConnect,
    moveConnect,
    endConnect,
  })

  // ── Public API ──────────────────────────────────────────────────────────────────────

  return {
    // Development only: internals for testing from the console (removed from production builds).
    ...(import.meta.env.DEV
      ? {
          debug: {
            items,
            connections,
            groups,
            history,
            threads,
            select,
            selectThread,
            selectGroup,
            deleteItem,
            setNoteColor,
            setThreadColor,
            cutThread,
            ungroup,
            undo,
            redo,
            flyTo,
            searchBar: () => searchBar,
            connect(sourceId, targetId) {
              beginConnect(sourceId)
              connecting.targetId = targetId
              const target = anchorOf(targetId)
              threads.setDraft({ a: anchorOf(sourceId), b: target, color: threadColor })
              const point = scene3d.toScreen(target.x, target.y - 0.2, target.z)
              endConnect(point.x, point.y)
            },
            moveItem(id, x, y) {
              const item = items.get(id)
              pendingEdit = beginChange('move')
              touch(pendingEdit, 'assets', id)
              item.record.x = x
              item.record.y = y
              persist(item.record)
              regroupAfter([id], pendingEdit)
              finishChange(pendingEdit)
              pendingEdit = null
              dirty = true
            },
          },
        }
      : {}),

    open(nextProject) {
      clearItems()
      searchBar.reset()
      project = nextProject
      loaded = false
      title.textContent = nextProject.name
      section.classList.add('is-visible')
      section.inert = true
      updateEmptyHint()

      const loading = loadWorkspace(nextProject.id)
      loading
        .then(({ assets, files, connections: storedConnections, groups: storedGroups }) => {
          if (project?.id !== nextProject.id) {
            return
          }

          assets.forEach((record) => {
            const file = record.fileId ? files.get(record.fileId) : null

            if (record.type === 'model' && file) {
              const companions = record.bundle.map(({ fileId }) => files.get(fileId)).filter(Boolean)
              const urls = [file, ...companions].map((stored) => ({ name: stored.name, url: URL.createObjectURL(stored.blob) }))
              addItem(record, urls[0].url, { animate: interactive, model: { mainName: file.name, urls, preparedModel: null } })
              return
            }

            if (record.type !== 'note' && !file) {
              console.warn(`Spatial Archive: file for "${record.title}" is missing and was skipped.`)
              return
            }

            const preview = record.previewId ? files.get(record.previewId) : null
            addItem(record, file ? URL.createObjectURL(file.blob) : null, { animate: interactive, previewUrl: preview ? URL.createObjectURL(preview.blob) : null })
          })

          storedGroups.forEach((group) => groups.set(group.id, group))
          // Membership is what counts: records are made or dropped to match it.
          syncGroupRecords(null)

          storedConnections.forEach((connection) => {
            if ((items.has(connection.sourceId) || groups.has(connection.sourceId)) && (items.has(connection.targetId) || groups.has(connection.targetId))) {
              connections.set(connection.id, connection)
            } else {
              removeConnections([connection.id]).catch(() => {})
            }
          })

          refreshRelationList()
          loaded = true
          placeFloorImmediately = true
          updateEmptyHint()
        })
        .catch((error) => {
          console.error(error)
          loaded = true
          updateEmptyHint()
          announce('This workspace could not be loaded from browser storage.')
        })

      // Resolves once the content is in, with the view the workspace opens on (see entryView).
      const ready = loading.then(() => {
        if (project?.id !== nextProject.id) {
          return null
        }

        const view = entryView()
        floor.setFrontZ(view.frontZ)
        floor.setTargetLevel(view.floorY + FLOOR.clearance, performance.now(), { immediate: true })
        return view
      })

      // Resolves once everything the reveal will draw is loaded, uploaded and compiled.
      const prepared = ready.then(() => prepareReveal(nextProject.id)).catch((error) => console.warn(error))

      // PDFs added before previews existed get one, quietly, once the workspace has opened.
      prepared.then(() => window.setTimeout(() => addMissingPreviews(nextProject.id), 2500))

      return { ready, prepared }
    },

    // Where the opening view would be now (used to re-frame after a resize).
    entryView,

    /*
     * Draws every part once, invisibly, inside upcoming frames, so its geometry is uploaded and
     * the graphics driver finishes its shaders before the reveal. A first draw can stall for a
     * moment, so the navigator calls this when a pause is invisible (the gathered point).
     */
    warmUp: () => scene3d.warmUp(),

    getProjectId: () => project?.id ?? null,

    // Called when the page is hidden or closed so no debounced edit is lost.
    flush() {
      flushSaves()
    },

    prepareClose() {
      setAddMenu(false)
      noteEditor.stop()
      select(null)
      selectThread(null)
      selectGroup(null)
      pointer.cancel()
      searchBar.close({ restoreFocus: false })
      guide = null
      selection.hidden = true
      threadControls.hidden = true
      groupControls.hidden = true
      depthGuide.hidden = true
      floor.setDial(null)
      flushSaves()
    },

    close() {
      focusView.closeImmediately()
      clearItems()
      searchBar.reset()
      project = null
      section.classList.remove('is-visible')
      section.inert = true
    },

    setInteractive(value) {
      interactive = value
      section.inert = !value
      section.classList.toggle('is-interactive', value)

      if (!value) {
        setAddMenu(false)
        pointer.cancel()
      }

      dirty = true
    },

    setPresence(value) {
      scene3d.setPresence(value)
      floor.setPresence(value)
      floor.setReveal({ grid: 1, footprints: 1, drops: 1 })
      canvas.style.opacity = value >= 1 ? '' : value.toFixed(3)
      dirty = true
    },

    /*
     * The workspace entry, stage by stage (0 → 1 each): the floor grid fades in, footprints are
     * drawn left to right, drop lines rise from the floor, then the objects appear.
     */
    setStage({ grid = 1, footprints = 1, drops = 1, objects = 1 }) {
      floor.setPresence(1)
      floor.setReveal({ grid, footprints, drops })
      scene3d.setPresence(objects)
      canvas.style.opacity = objects >= 1 ? '' : objects.toFixed(3)
      dirty = true
    },

    setChromeOpacity(value) {
      chrome.style.opacity = value >= 1 ? '' : value.toFixed(3)
      chrome.style.visibility = value <= 0 ? 'hidden' : ''
    },

    frame(now) {
      if (!project) {
        return
      }

      const cameraMoved =
        camera.position.x !== lastCamera.x ||
        camera.position.y !== lastCamera.y ||
        camera.position.z !== lastCamera.z ||
        camera.rotation.y !== lastCamera.yaw ||
        camera.rotation.x !== lastCamera.pitch

      if (cameraMoved) {
        Object.assign(lastCamera, { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: camera.rotation.y, pitch: camera.rotation.x })
      }

      const floorMoving = floor.update(camera, now)
      let placed = false

      if (dirty || cameraMoved || animating || guide || floorMoving) {
        dirty = false
        animating = syncItems(now) || floorMoving
        placeSelection()
        placeDepthGuide(now)

        const editing = noteEditor.editing()

        if (editing) {
          noteEditor.place(scene3d.screenRect(editing.record, editing.depthZ, 0))
        }

        placed = true
        scene.requestRender()
      }

      // Threads (their physics) and group bubbles run every frame; both rest when still.
      const floorY = floor.getLevel()
      const threadsMoving = threads.update(now, threadEnds(), { floor: floorY })
      const groupsMoving = groupShapes.update(now, groupShapeData(), { floorY })

      if (threadsMoving || groupsMoving) {
        scene.requestRender()
      }

      if (placed || threadsMoving || groupsMoving) {
        placeThreadControls()
        placeGroupControls()
        placeConnectTarget()
      }

      focusView.frame(now)
    },

    handleKeyDown(event) {
      if (!interactive) {
        return false
      }

      if (focusView.isOpen()) {
        if (event.key === 'Escape') {
          focusView.close()
          return true
        }

        return false
      }

      if (noteEditor.editing()) {
        if (event.key === 'Escape') {
          noteEditor.stop({ restoreFocus: true })
          return true
        }

        return false
      }

      const command = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      // Search: Ctrl / Cmd + F, or "/" (as on the web).
      if ((command && key === 'f') || (event.key === '/' && !command && !event.target.closest?.('input, textarea, select'))) {
        searchBar.open()
        return true
      }

      if (event.target.closest?.('input, textarea, select')) {
        return false
      }

      // Undo / redo (spec §114): Ctrl / Cmd + Z, Ctrl / Cmd + Shift + Z (and Ctrl + Y).
      if (command && (key === 'z' || key === 'y')) {
        if (!pointer.isBusy() && !connecting) {
          key === 'y' || event.shiftKey ? redo() : undo()
        }

        return true
      }

      if (event.key === 'Escape') {
        if (connecting) {
          pointer.cancel()
          return true
        }

        if (!addMenu.hidden) {
          setAddMenu(false)
          addButton.focus()
          return true
        }

        if (selectedId || selectedThreadId || selectedGroupId) {
          select(null)
          selectThread(null)
          selectGroup(null)
          canvas.focus({ preventScroll: true })
          return true
        }

        return false
      }

      if (event.key === 'Home') {
        fitAll()
        return true
      }

      if ((event.key === '+' || event.key === '=' || event.key === '-') && !command) {
        pointer.flyBy(scene.viewport.width / 2, scene.viewport.height / 2, event.key === '-' ? 1.25 : 0.8)
        return true
      }

      const onSelection = event.target === document.body || event.target.closest?.('[data-item-id], [data-thread-id], [data-group-id], [data-workspace-canvas]')

      if (!onSelection) {
        return false
      }

      if (selectedThreadId && (event.key === 'Delete' || event.key === 'Backspace')) {
        cutThread(selectedThreadId)
        return true
      }

      const step = event.shiftKey ? WORKSPACE.nudgeLargePx : WORKSPACE.nudgePx
      const nudges = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }

      // A selected group moves as one.
      if (selectedGroupId && nudges[event.key] && !command) {
        const members = membersOf(selectedGroupId)
        const change = beginChange('move group', `nudge:${selectedGroupId}`)
        members.forEach((member) => {
          touch(change, 'assets', member.record.id)
          member.tween = null
          member.record.x += nudges[event.key][0]
          member.record.y += nudges[event.key][1]
          persist(member.record, { debounce: true })
        })
        regroupAfter(members.map((member) => member.record.id), change)
        finishChange(change)
        dirty = true
        return true
      }

      const item = items.get(selectedId)

      if (!item || item.exit || command) {
        return false
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteItem(item.record.id)
        return true
      }

      if (event.key === 'Enter') {
        openOrEdit(item.record.id)
        return true
      }

      // Same convention as layer order in design tools: [ sends back, ] brings forward.
      // R turns the panel one step, Shift + R turns it back.
      if ((event.key === 'r' || event.key === 'R') && WORKSPACE.allowRotation) {
        keyedChange(item, 'turn', 'turn', () => setRotation(item, item.record.rotY + (event.shiftKey ? -1 : 1) * WORKSPACE.rotateStepDeg))
        announce(`Turned ${item.record.rotY}°`)
        return true
      }

      if (event.key === '[' || event.key === ']') {
        stepLayer(item, event.key === '[' ? 1 : -1)
        return true
      }

      if (nudges[event.key]) {
        keyedChange(item, 'nudge', 'move', () => {
          item.record.x += nudges[event.key][0]
          item.record.y += nudges[event.key][1]
          persist(item.record, { debounce: true })
        })
        dirty = true
        return true
      }

      return false
    },
  }
}
