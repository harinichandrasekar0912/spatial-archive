import * as THREE from 'three'
import { THEME } from '../../app/constants.js'
import { toWorldLength } from '../viewMath.js'
import { loadModelObject } from './modelLoader.js'
import { applyAppearance, attachEdges, disposeModel, prepareModelAsync, setModelOpacity } from './modelStyle.js'

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitBoxEdges = new THREE.EdgesGeometry(unitBox)
const PLACEHOLDER_OPACITY = 0.25

/*
 * A 3D model inside the workspace volume. It behaves like a card: positioned by its record,
 * sitting on a layer, turning around its vertical axis, scaling with its width. An invisible
 * box proxy makes picking cheap regardless of polygon count, and a wireframe box stands in
 * while the model loads (or if it cannot be loaded).
 */
export function createModelEntry(item, { requestRender, onMeasured }) {
  const group = new THREE.Group()
  const proxy = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ visible: false }))
  proxy.userData.id = item.record.id

  const placeholderMaterial = new THREE.LineBasicMaterial({ color: THEME.ink, transparent: true, opacity: PLACEHOLDER_OPACITY, depthWrite: false })
  const placeholder = new THREE.LineSegments(unitBoxEdges, placeholderMaterial)
  group.add(proxy, placeholder)

  const entry = {
    kind: 'model',
    group,
    pickMesh: proxy,
    proxy,
    placeholder,
    placeholderMaterial,
    model: null,
    size: new THREE.Vector3(1, 1, 1),
    hidden: false,
    disposed: false,
    detached: false,
  }

  const prepared = item.preparedModel
  const source = prepared ? (prepared.hasEdges ? Promise.resolve(prepared) : attachEdges(prepared)) : loadModelObject(item.modelMain, item.modelFiles).then(prepareModelAsync)
  item.preparedModel = null

  // Settles once the model is in place (or has failed); see scene3d.whenSettled.
  entry.ready = source
    .then((model) => {
      if (entry.disposed) {
        disposeModel(model)
        return
      }

      entry.model = model
      entry.size.copy(model.size)
      applyAppearance(model, item.record.appearance)

      if (!entry.detached) {
        group.add(model.pivot)
      }

      placeholder.visible = false
      onMeasured(item, model.size)
      requestRender()
    })
    .catch((error) => {
      console.warn(`Spatial Archive: could not load the model "${item.record.filename}".`, error)
      requestRender()
    })

  return entry
}

// Mirrors the record onto the model; returns its world-space extent.
export function syncModelEntry(entry, item, { x, y, z, scale, opacity, rotation }) {
  const { record } = item
  const unitScale = toWorldLength(record.width) / entry.size.x
  const width = entry.size.x * unitScale
  const height = entry.size.y * unitScale
  const depth = entry.size.z * unitScale

  entry.group.position.set(x, y, z)
  entry.group.rotation.y = rotation
  entry.group.scale.setScalar(scale)
  entry.proxy.scale.set(width, height, depth)
  entry.placeholder.scale.set(width, height, depth)
  entry.placeholderMaterial.opacity = PLACEHOLDER_OPACITY * opacity

  // While the focus view has borrowed the model, it is left alone here.
  if (entry.model && !entry.detached) {
    entry.model.pivot.scale.setScalar(unitScale)
    applyAppearance(entry.model, record.appearance)
    setModelOpacity(entry.model, opacity)
  }

  return { width, height, depth }
}

export function disposeModelEntry(entry) {
  entry.disposed = true

  if (entry.model) {
    disposeModel(entry.model)
  }

  entry.proxy.material.dispose()
  entry.placeholderMaterial.dispose()
}
