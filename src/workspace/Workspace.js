import { FLOOR, WORKSPACE } from '../app/constants.js'
import { loadWorkspace, removeAssets, saveAssets, saveFile } from '../data/workspaceStore.js'
import { announce } from '../utils/dom.js'
import { clamp, easeOutCubic, lerp } from '../utils/easing.js'
import { describeAsset, firstLine } from './assetText.js'
import { SketchUpUnavailableError, arrangeAround, convertSketchUpFile, createNoteRecord, groupFiles, prepareFileAsset, prepareModelAsset } from './assetFactory.js'
import { extensionOf } from './models/modelLoader.js'
import { CAPTION_HEIGHT_PX } from './cardTextures.js'
import { createFloor } from './floor3d.js'
import { createFocusView } from './FocusView.js'
import { createNoteEditor } from './NoteEditor.js'
import { attachPointerControls } from './pointerControls.js'
import { CARD_RADIUS_PX, createWorkspaceScene } from './scene3d.js'
import { clampLayer, computeEntryView, fromWorldX, fromWorldY, itemZ, referenceLayer, toWorldLength, toWorldX, toWorldY } from './viewMath.js'
import './workspace.css'

const CAPTION_ALLOWANCE_PX = CAPTION_HEIGHT_PX + 10
// How long the depth guide stays after a keyboard / button layer change.
const GUIDE_LINGER_MS = 900
const COMPACT_FRAME_PX = 150

/*
 * Workspace controller. Records are the source of truth; each item also carries its animated
 * depth (depthZ) and is mirrored into the Three.js scene by scene3d. A hidden list of buttons
 * mirrors the cards so keyboard and screen-reader users can reach every item.
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
  const layerLabel = selection.querySelector('[data-layer-label]')
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

  const scene3d = createWorkspaceScene(scene, { onModelMeasured })
  const floor = createFloor(scene)
  const items = new Map()
  const pendingSaves = new Map()
  const lastCamera = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN }
  let project = null
  let loaded = false
  let interactive = false
  let selectedId = null
  let dirty = true
  let animating = false
  let guide = null
  // The first sync after a workspace loads places the floor directly instead of easing it.
  let placeFloorImmediately = true
  // The turn dial on the floor (selected item) is under the pointer.
  let dialHover = false

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

  // ── Items ───────────────────────────────────────────────────────────────────────────

  function updateEmptyHint() {
    emptyHint.hidden = !loaded || liveItems().length > 0
  }

  function addItem(record, url, { animate, model = null }) {
    record.z = clampLayer(record.z)
    const rotation = targetRotation(record)
    const item = {
      record,
      url,
      depthZ: itemZ(record.z),
      layerAnim: null,
      rotation,
      rotationTarget: rotation,
      rotationAnim: null,
      exit: null,
      enter: animate && !reducedMotion ? { start: performance.now() } : null,
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
    ;[item.url, ...(item.extraUrls || [])].filter(Boolean).forEach((url) => URL.revokeObjectURL(url))
  }

  function clearItems() {
    scene3d.clear()
    itemList.replaceChildren()
    items.forEach(revokeUrls)
    items.clear()
    selectedId = null
    guide = null
    depthGuide.hidden = true
    selection.hidden = true
  }

  function select(id, { focus = false } = {}) {
    if (selectedId !== id) {
      selectedId = id
      dirty = true
    }

    if (focus) {
      items.get(id)?.listButton.focus({ preventScroll: true })
    }
  }

  function deleteItem(id) {
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

  function stepLayer(item, delta) {
    setLayer(item, item.record.z + delta)
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
    prepared.forEach((entry) => addItem(entry.record, entry.url, { animate: true, model: entry.record.type === 'model' ? entry : null }))
    select(records.at(-1).id, { focus: true })

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
    addItem(record, null, { animate: true })
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
      focusView.open(item)
    }
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
    return { ...computeEntryView(boxes, { floorY, frontZ }, scene.viewport), yaw: 0, pitch: 0, floorY, frontZ }
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

    // Far-away cards are small on screen: the depth control moves beside the card instead.
    const depthWidth = depthControl.offsetWidth
    const depthHeight = depthControl.offsetHeight

    if (width < COMPACT_FRAME_PX) {
      const left = midpoint(topLeft, bottomLeft)
      place(depthControl, Math.min(topLeft.x, bottomLeft.x) - depthWidth - 10, left.y - depthHeight / 2)
    } else {
      place(depthControl, topLeft.x - 4, Math.min(topLeft.y, topRight.y) - depthHeight - 8)
    }

    place(deleteControl, topRight.x - 12, topRight.y - 12)

    const arc = CARD_RADIUS_PX * zoom + 9
    resizeControl.style.setProperty('--arc', `${arc.toFixed(2)}px`)
    place(resizeControl, bottomRight.x + 9 - arc, bottomRight.y + 9 - arc)

    const turn = item.record.rotY ? ` · ${item.record.rotY}°` : ''
    layerLabel.textContent = `LAYER ${item.record.z}${turn}`
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
    const action = event.target.closest('[data-action]')?.dataset.action
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
    commit: (item) => persist(item.record),
  })

  // ── Public API ──────────────────────────────────────────────────────────────────────

  return {
    open(nextProject) {
      clearItems()
      project = nextProject
      loaded = false
      title.textContent = nextProject.name
      section.classList.add('is-visible')
      section.inert = true
      updateEmptyHint()

      const loading = loadWorkspace(nextProject.id)
      loading
        .then(({ assets, files }) => {
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

            addItem(record, file ? URL.createObjectURL(file.blob) : null, { animate: interactive })
          })

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
      pointer.cancel()
      guide = null
      selection.hidden = true
      depthGuide.hidden = true
      floor.setDial(null)
      flushSaves()
    },

    close() {
      focusView.closeImmediately()
      clearItems()
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

      if (dirty || cameraMoved || animating || guide || floorMoving) {
        dirty = false
        animating = syncItems(now) || floorMoving
        placeSelection()
        placeDepthGuide(now)

        const editing = noteEditor.editing()

        if (editing) {
          noteEditor.place(scene3d.screenRect(editing.record, editing.depthZ, 0))
        }

        scene.requestRender()
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

      if (event.target.closest?.('input, textarea, select')) {
        return false
      }

      if (event.key === 'Escape') {
        if (!addMenu.hidden) {
          setAddMenu(false)
          addButton.focus()
          return true
        }

        if (selectedId) {
          select(null)
          canvas.focus({ preventScroll: true })
          return true
        }

        return false
      }

      if (event.key === 'Home') {
        fitAll()
        return true
      }

      if ((event.key === '+' || event.key === '=' || event.key === '-') && !event.ctrlKey && !event.metaKey) {
        pointer.flyBy(scene.viewport.width / 2, scene.viewport.height / 2, event.key === '-' ? 1.25 : 0.8)
        return true
      }

      const item = items.get(selectedId)
      const onSelection = event.target === document.body || event.target.closest?.('[data-item-id], [data-workspace-canvas]')

      if (!item || item.exit || !onSelection) {
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
        setRotation(item, item.record.rotY + (event.shiftKey ? -1 : 1) * WORKSPACE.rotateStepDeg)
        announce(`Turned ${item.record.rotY}°`)
        return true
      }

      if (event.key === '[' || event.key === ']') {
        stepLayer(item, event.key === '[' ? 1 : -1)
        return true
      }

      const step = event.shiftKey ? WORKSPACE.nudgeLargePx : WORKSPACE.nudgePx
      const nudges = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }

      if (nudges[event.key]) {
        item.record.x += nudges[event.key][0]
        item.record.y += nudges[event.key][1]
        dirty = true
        persist(item.record, { debounce: true })
        return true
      }

      return false
    },
  }
}
