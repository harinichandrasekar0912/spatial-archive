import * as THREE from 'three'
import { THEME, WORKSPACE } from '../app/constants.js'
import { displayTitle } from './assetText.js'
import { createCaptionMaterial, createCardMaterial, createOutlineMaterial, createShadowMaterial, sharedUniforms } from './cardMaterials.js'
import {
  CAPTION_HEIGHT_PX,
  SHADOW_SCALE,
  configureTextures,
  createCaptionTexture,
  createImageTexture,
  createNoteTexture,
  createPdfTexture,
  createPlaceholderTexture,
  disposeTexture,
  getShadowTexture,
} from './cardTextures.js'
import { createModelEntry, disposeModelEntry, syncModelEntry } from './models/modelEntry.js'
import { setModelOpacity } from './models/modelStyle.js'
import { toWorldLength, toWorldX, toWorldY } from './viewMath.js'

export const CARD_RADIUS_PX = 14
const CAPTION_GAP_PX = 8
// On black the shadow is felt rather than seen: it darkens the dots just behind the card.
const SHADOW_OPACITY = 0.45
const SHADOW_DROP_PX = 7
// Cards closer to the camera than this dissolve, like the dots, instead of filling the view.
const NEAR_CLEAR = 0.45
const NEAR_FULL = 1.7

const unitPlane = new THREE.PlaneGeometry(1, 1)
const unitOutline = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-0.5, 0.5, 0.002, 0.5, 0.5, 0.002, 0.5, -0.5, 0.002, -0.5, -0.5, 0.002], 3),
)
const OUTLINE_OPACITY = 0.32
// A render layer used only to draw one object at a time during warmUp.
const WARM_LAYER = 7

/*
 * The workspace's Three.js layer: one group per card (card + soft shadow + caption) inside the
 * shared scene, plus picking and screen projection helpers. Records stay the source of truth;
 * `sync` mirrors a record's position, layer depth and size onto its meshes.
 */
export function createWorkspaceScene(spatial, { onModelMeasured = () => {} } = {}) {
  const { world, renderer, camera, viewport } = spatial
  const root = new THREE.Group()
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const projected = new THREE.Vector3()
  const hitPoint = new THREE.Vector3()
  const depthPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const cardPlane = new THREE.Plane()
  const planeNormal = new THREE.Vector3()
  const planePoint = new THREE.Vector3()
  const entries = new Map()
  const cardMeshes = []
  // Images and models still loading (see whenSettled).
  const pending = new Set()

  function track(promise) {
    pending.add(promise)
    promise.finally(() => pending.delete(promise))
    return promise
  }

  configureTextures(renderer)
  world.add(root)

  // Draws queued parts once per frame inside the real frame (see warmUp), clipped to nothing.
  const warmCamera = camera.clone()
  const warmer = {
    queue: [],
    done: null,
    isActive: () => warmer.queue.length > 0,
    render(renderer) {
      const started = performance.now()
      warmCamera.copy(camera)
      warmCamera.layers.set(WARM_LAYER)
      renderer.setScissorTest(true)
      renderer.setScissor(0, 0, 0, 0)

      while (warmer.queue.length && performance.now() - started < 4) {
        const { object, group } = warmer.queue.shift()
        const rootVisible = root.visible
        const groupVisible = group.visible
        const culled = object.frustumCulled
        root.visible = true
        group.visible = true
        object.frustumCulled = false
        object.layers.enable(WARM_LAYER)
        renderer.render(world, warmCamera)
        object.layers.disable(WARM_LAYER)
        object.frustumCulled = culled
        group.visible = groupVisible
        root.visible = rootVisible
      }

      renderer.setScissorTest(false)

      if (!warmer.queue.length && warmer.done) {
        warmer.done()
        warmer.done = null
      }
    },
  }
  spatial.addOverlay(warmer)

  // Light for 3D models only (cards and dots use unlit shaders). Fog lets models recede into
  // the dark like cards do; shader materials ignore scene fog.
  const sky = new THREE.HemisphereLight(0xffffff, 0x1c1c1b, 1.15)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(-4, 9, 7)
  // The warm-up camera (see warmUp) must see the same lights, so materials compile identically.
  sky.layers.enable(WARM_LAYER)
  sun.layers.enable(WARM_LAYER)
  world.add(sky, sun)
  world.fog = new THREE.Fog(THEME.background, WORKSPACE.fogNear, WORKSPACE.fogFar + 12)

  function setNdc(clientX, clientY) {
    ndc.set((clientX / viewport.width) * 2 - 1, -(clientY / viewport.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
  }

  function buildTexture(entry, record) {
    if (record.type === 'note') {
      return createNoteTexture(record)
    }

    if (record.type === 'pdf') {
      return entry.imageTexture || createPdfTexture(record)
    }

    return entry.imageTexture || createPlaceholderTexture()
  }

  function textKey(record) {
    return record.type === 'note' ? `${record.notes}|${record.width}|${record.height}|${record.color}` : `${record.title}|${record.filename}|${record.width}|${record.height}`
  }

  function replaceCardTexture(entry, texture) {
    const previous = entry.cardMaterial.uniforms.uMap.value

    if (previous && previous !== texture && previous !== entry.imageTexture) {
      previous.dispose()
    }

    entry.cardMaterial.uniforms.uMap.value = texture
  }

  function syncCaption(entry, record) {
    if (record.type === 'note') {
      return
    }

    const text = record.type === 'pdf' ? record.filename : displayTitle(record)
    const key = `${text}|${record.width}`

    if (entry.captionKey !== key) {
      entry.captionKey = key
      entry.captionMaterial.uniforms.uMap.value?.dispose()
      entry.captionMaterial.uniforms.uMap.value = createCaptionTexture(text, record.width)
    }

    entry.caption.scale.set(toWorldLength(record.width), toWorldLength(CAPTION_HEIGHT_PX), 1)
    entry.caption.position.set(0, -toWorldLength(record.height / 2 + CAPTION_GAP_PX + CAPTION_HEIGHT_PX / 2), 0.001)
  }

  // An image (or a PDF's first-page picture) becomes the card's face once it has loaded.
  function loadFace(entry, record, url) {
    track(
      createImageTexture(url, { aspect: record.width / Math.max(1, record.height) })
        .then((texture) => {
          if (entries.get(record.id) !== entry) {
            disposeTexture(texture)
            return
          }

          const previous = entry.imageTexture
          entry.imageTexture = texture
          replaceCardTexture(entry, texture)
          disposeTexture(previous)
          spatial.requestRender()
        })
        .catch(() => {
          if (record.type === 'image') {
            replaceCardTexture(entry, createPlaceholderTexture(THEME.placeholderMissing))
            spatial.requestRender()
          }
        }),
    )
  }

  function addCaption(entry) {
    entry.captionMaterial = createCaptionMaterial(null)
    entry.caption = new THREE.Mesh(unitPlane, entry.captionMaterial)
    entry.group.add(entry.caption)
  }

  return {
    add(item) {
      const { record } = item

      if (record.type === 'model') {
        const entry = createModelEntry(item, { requestRender: () => spatial.requestRender(), onMeasured: onModelMeasured })
        track(entry.ready)
        entry.captionKey = ''
        addCaption(entry)
        root.add(entry.group)
        cardMeshes.push(entry.pickMesh)
        entries.set(record.id, entry)
        return
      }

      const group = new THREE.Group()
      const entry = { kind: 'card', group, imageTexture: null, textKey: '', captionKey: '', hidden: false }

      entry.cardMaterial = createCardMaterial(null, { width: record.width, height: record.height, radius: CARD_RADIUS_PX })
      entry.card = new THREE.Mesh(unitPlane, entry.cardMaterial)
      entry.card.userData.id = record.id
      entry.pickMesh = entry.card

      entry.shadowMaterial = createShadowMaterial(getShadowTexture())
      entry.shadow = new THREE.Mesh(unitPlane, entry.shadowMaterial)
      entry.shadow.position.z = -0.02

      entry.outlineMaterial = createOutlineMaterial()
      entry.outline = new THREE.LineLoop(unitOutline, entry.outlineMaterial)
      entry.outline.visible = false

      group.add(entry.shadow, entry.card, entry.outline)

      if (record.type !== 'note') {
        addCaption(entry)
      }

      replaceCardTexture(entry, buildTexture(entry, record))
      entry.textKey = textKey(record)
      root.add(group)
      cardMeshes.push(entry.pickMesh)
      entries.set(record.id, entry)

      if (record.type === 'image' && item.url) {
        loadFace(entry, record, item.url)
      } else if (record.type === 'pdf' && item.previewUrl) {
        loadFace(entry, record, item.previewUrl)
      }
    },

    // A PDF has just been given its first-page picture.
    refreshPreview(item) {
      const entry = entries.get(item.record.id)

      if (entry?.kind === 'card' && item.previewUrl) {
        loadFace(entry, item.record, item.previewUrl)
      }
    },

    // Mirror a record (plus animation state) onto its meshes.
    sync(item, { z, scale = 1, opacity = 1, rotation = 0 }) {
      const entry = entries.get(item.record.id)

      if (!entry) {
        return
      }

      const { record } = item
      const width = toWorldLength(record.width)
      const height = toWorldLength(record.height)
      const nearFade = THREE.MathUtils.smoothstep(camera.position.z - z, NEAR_CLEAR, NEAR_FULL)
      const effective = opacity * nearFade

      if (entry.kind === 'model') {
        // Models fade with the workspace presence here (cards get it through a shared uniform).
        const presence = sharedUniforms.uPresence.value
        syncModelEntry(entry, item, { x: toWorldX(record.x), y: toWorldY(record.y), z, scale, opacity: effective * presence, rotation })
        syncCaption(entry, record)
        entry.captionMaterial.uniforms.uOpacity.value = effective
        entry.group.visible = !entry.hidden && effective * presence > 0.002
        entry.pickable = entry.group.visible && effective > 0.5
        return
      }

      entry.group.position.set(toWorldX(record.x), toWorldY(record.y), z)
      entry.group.rotation.y = rotation
      entry.group.scale.setScalar(scale)
      entry.card.scale.set(width, height, 1)
      entry.outline.scale.set(width, height, 1)
      entry.outline.visible = Math.abs(rotation) > 0.01
      entry.cardMaterial.uniforms.uSize.value.set(record.width, record.height)
      entry.shadow.scale.set(width * SHADOW_SCALE, height * SHADOW_SCALE, 1)
      entry.shadow.position.y = -toWorldLength(SHADOW_DROP_PX)

      if (record.type !== 'image') {
        const key = textKey(record)

        if (entry.textKey !== key) {
          entry.textKey = key
          replaceCardTexture(entry, buildTexture(entry, record))
        }
      }

      syncCaption(entry, record)

      entry.cardMaterial.uniforms.uOpacity.value = effective
      entry.shadowMaterial.uniforms.uOpacity.value = effective * SHADOW_OPACITY
      entry.outlineMaterial.uniforms.uOpacity.value = effective * OUTLINE_OPACITY

      if (entry.captionMaterial) {
        entry.captionMaterial.uniforms.uOpacity.value = effective
      }

      // A fading card must not hide the dots behind it.
      entry.cardMaterial.depthWrite = effective * sharedUniforms.uPresence.value > 0.995
      entry.group.visible = !entry.hidden && effective > 0.002
      entry.pickable = entry.group.visible && effective > 0.5
    },

    remove(id) {
      const entry = entries.get(id)

      if (!entry) {
        return
      }

      root.remove(entry.group)
      cardMeshes.splice(cardMeshes.indexOf(entry.pickMesh), 1)

      if (entry.kind === 'model') {
        disposeModelEntry(entry)
        entry.captionMaterial.uniforms.uMap.value?.dispose()
        entry.captionMaterial.dispose()
        entries.delete(id)
        return
      }

      entry.cardMaterial.uniforms.uMap.value?.dispose()
      disposeTexture(entry.imageTexture)
      entry.captionMaterial?.uniforms.uMap.value?.dispose()
      entry.cardMaterial.dispose()
      entry.shadowMaterial.dispose()
      entry.outlineMaterial.dispose()
      entry.captionMaterial?.dispose()
      entries.delete(id)
    },

    clear() {
      ;[...entries.keys()].forEach((id) => this.remove(id))
      warmer.queue.length = 0
      warmer.done?.()
      warmer.done = null
    },

    // Resolves once every image and model added so far has loaded (or failed).
    whenSettled() {
      return Promise.allSettled([...pending])
    },

    // Every texture the workspace will draw.
    textures() {
      const found = new Set()
      root.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.filter(Boolean).forEach((material) => {
          ;[material.map, material.uniforms?.uMap?.value].forEach((texture) => texture?.isTexture && found.add(texture))
        })
      })
      return [...found]
    },

    // Puts every model in its fading (see-through) or its final (opaque) material state, so
    // both shader variants can be compiled ahead of time; the next sync restores the real state.
    setModelsOpaque(opaque) {
      entries.forEach((entry) => entry.model && setModelOpacity(entry.model, opaque ? 1 : 0))
    },

    /*
     * Queues every visible part of every item to be drawn once inside upcoming frames, after the
     * real render, with an empty scissor: nothing appears, but its geometry is uploaded and its
     * exact on-screen shader is used, so the reveal frame has nothing left to do. A few parts
     * per frame; resolves when all have been drawn.
     */
    warmUp() {
      entries.forEach((entry) => {
        if (entry.hidden) {
          return
        }

        entry.group.traverse((object) => {
          const shown = Array.isArray(object.material) ? object.material.some((material) => material.visible) : object.material?.visible

          if ((object.isMesh || object.isLine || object.isPoints) && shown && object.visible) {
            warmer.queue.push({ object, group: entry.group })
          }
        })
      })

      return new Promise((resolve) => {
        warmer.done = resolve

        if (!warmer.queue.length) {
          resolve()
        }
      })
    },

    setHidden(id, hidden) {
      const entry = entries.get(id)

      if (entry) {
        entry.hidden = hidden
        entry.group.visible = !hidden
      }
    },

    setPresence(value) {
      sharedUniforms.uPresence.value = value
      root.visible = value > 0.001
    },

    // The focus view borrows a loaded model's object while it is open (see modelViewer).
    lendModel(id) {
      const entry = entries.get(id)

      if (entry?.kind !== 'model') {
        return null
      }

      entry.detached = true

      if (entry.model) {
        entry.group.remove(entry.model.pivot)
      }

      return entry.model
    },

    returnModel(id) {
      const entry = entries.get(id)

      if (entry?.kind !== 'model' || !entry.detached) {
        return
      }

      entry.detached = false

      if (entry.model) {
        entry.group.add(entry.model.pivot)
      }
    },

    // Front-most card under the pointer (cards behind the camera or dissolving are ignored).
    pick(clientX, clientY) {
      // World matrices are normally refreshed by the renderer; a pick can happen between a
      // sync and the next render, so refresh them here.
      root.updateMatrixWorld()
      setNdc(clientX, clientY)
      const pickable = cardMeshes.filter((mesh) => entries.get(mesh.userData.id)?.pickable)
      const hit = raycaster.intersectObjects(pickable, false)[0]
      return hit ? hit.object.userData.id : null
    },

    // Where the pointer ray meets the plane z = constant (for dragging on a layer).
    planeHit(clientX, clientY, z) {
      setNdc(clientX, clientY)
      depthPlane.constant = -z
      return raycaster.ray.intersectPlane(depthPlane, hitPoint) ? hitPoint.clone() : null
    },

    // Where the pointer ray meets a turned card's own plane (normal (sin θ, 0, cos θ)).
    cardPlaneHit(clientX, clientY, centre, rotation) {
      setNdc(clientX, clientY)
      cardPlane.setFromNormalAndCoplanarPoint(planeNormal.set(Math.sin(rotation), 0, Math.cos(rotation)), planePoint.set(centre.x, centre.y, centre.z))
      return raycaster.ray.intersectPlane(cardPlane, hitPoint) ? hitPoint.clone() : null
    },

    rayDirection(clientX, clientY) {
      setNdc(clientX, clientY)
      return raycaster.ray.direction.clone()
    },

    toScreen(x, y, z) {
      projected.set(x, y, z).project(camera)
      return { x: (projected.x + 1) * 0.5 * viewport.width, y: (1 - projected.y) * 0.5 * viewport.height, behind: projected.z > 1 }
    },

    /*
     * Screen positions of a card's corners [top-left, top-right, bottom-right, bottom-left],
     * following its turn around the vertical axis. A point (u, 0, 0) on the card maps to
     * (u·cos θ, 0, −u·sin θ) in the world.
     */
    projectCorners(record, z, rotation = 0) {
      const halfWidth = toWorldLength(record.width) / 2
      const halfHeight = toWorldLength(record.height) / 2
      const x = toWorldX(record.x)
      const y = toWorldY(record.y)
      const across = Math.cos(rotation) * halfWidth
      const deep = -Math.sin(rotation) * halfWidth
      const corners = [
        this.toScreen(x - across, y + halfHeight, z - deep),
        this.toScreen(x + across, y + halfHeight, z + deep),
        this.toScreen(x + across, y - halfHeight, z + deep),
        this.toScreen(x - across, y - halfHeight, z - deep),
      ]
      const nearestDepth = camera.position.z - (z + Math.abs(deep))
      return { corners, behind: corners.some((corner) => corner.behind) || nearestDepth < NEAR_FULL }
    },

    // Screen bounding box of a card (exact while it faces the camera).
    screenRect(record, z, rotation = 0) {
      const { corners, behind } = this.projectCorners(record, z, rotation)
      const xs = corners.map((corner) => corner.x)
      const ys = corners.map((corner) => corner.y)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(...xs) - left
      const topEdge = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y)

      return {
        left,
        top,
        width,
        height: Math.max(...ys) - top,
        // Screen pixels per workspace pixel along the card's height (unaffected by the turn).
        zoom: Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) / record.height || topEdge / record.width,
        corners,
        behind,
      }
    },
  }
}
