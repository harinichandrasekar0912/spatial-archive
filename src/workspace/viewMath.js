import { CAMERA, WORKSPACE } from '../app/constants.js'
import { clamp } from '../utils/easing.js'

/*
 * Workspace geometry.
 *   - Records store x / y / width / height in "workspace pixels" (y down) and z as a layer index.
 *   - World units: X = x / P, Y = -y / P, and a card on layer k sits at itemZ(k).
 *   - Layer 0 is the front of the archive volume; deeper layers recede into the dot lattice.
 */

const P = WORKSPACE.pxPerUnit
export const TAN_HALF_FOV = Math.tan((CAMERA.fov * Math.PI) / 360)

export const toWorldX = (x) => x / P
export const toWorldY = (y) => -y / P
export const fromWorldX = (X) => X * P
export const fromWorldY = (Y) => -Y * P
export const toWorldLength = (px) => px / P

export function clampLayer(layer) {
  return clamp(Math.round(Number(layer) || 0), 0, WORKSPACE.maxLayer)
}

// World z of a card on a layer: just in front of that layer's plane of dots.
export function itemZ(layer) {
  return WORKSPACE.layer0Z - layer * WORKSPACE.layerSpacing + WORKSPACE.itemOffset
}

// Camera distance from a plane at which one workspace pixel is `zoom` screen pixels.
export function distanceForZoom(zoom, viewportHeight) {
  return viewportHeight / 2 / (zoom * TAN_HALF_FOV) / P
}

export function zoomAtDistance(distance, viewportHeight) {
  return viewportHeight / 2 / (Math.max(0.001, distance) * TAN_HALF_FOV) / P
}

export function clampCameraZ(z) {
  return clamp(z, itemZ(WORKSPACE.maxLayer) + WORKSPACE.minCameraGap, WORKSPACE.layer0Z + WORKSPACE.maxCameraDistance)
}

// The first layer at least `gap` units in front of the camera: the plane that panning and
// flying are measured against, so content on it follows the pointer 1:1.
export function referenceLayer(cameraZ, gap = 1) {
  for (let layer = 0; layer <= WORKSPACE.maxLayer; layer += 1) {
    if (itemZ(layer) < cameraZ - gap) {
      return layer
    }
  }

  return WORKSPACE.maxLayer
}

/*
 * The view a workspace opens on, and Home returns to: every item in view and centred, with
 * the floor's front edge exactly on the bottom edge of the screen, so nothing below the floor
 * shows and the floor recedes from the bottom of the screen into the space. The camera faces
 * straight in, so the floor constraint fixes its height for each depth; a binary search on the
 * depth then finds the closest view that holds everything (never closer than 1:1 zoom).
 * boxes: [{ x, y, z, halfWidth, halfHeight }] in world units.
 */
export function computeEntryView(boxes, { floorY, frontZ }, { width, height }) {
  const tanV = TAN_HALF_FOV
  const tanH = TAN_HALF_FOV * (width / height)
  const xMax = 1 - (2 * WORKSPACE.fitMarginPx) / width
  const yMax = 1 - (2 * WORKSPACE.fitTopPx) / height
  const heightAt = (cameraZ) => floorY + (cameraZ - frontZ) * tanV

  // The floor's front edge stays far enough ahead to be drawn crisply (lines dissolve up close).
  const minZ = frontZ + WORKSPACE.entryFloorGap

  if (!boxes.length) {
    const z = clampCameraZ(Math.max(itemZ(0) + distanceForZoom(1, height), minZ))
    return { x: 0, y: heightAt(z), z }
  }

  const solve = (cameraZ) => {
    const y = heightAt(cameraZ)
    let xLow = -Infinity
    let xHigh = Infinity

    for (const box of boxes) {
      const depth = cameraZ - box.z

      if (depth <= 0.5 || box.y + box.halfHeight > y + yMax * tanV * depth) {
        return null
      }

      xLow = Math.max(xLow, box.x + box.halfWidth - xMax * tanH * depth)
      xHigh = Math.min(xHigh, box.x - box.halfWidth + xMax * tanH * depth)
    }

    return xLow <= xHigh ? { x: (xLow + xHigh) / 2, y } : null
  }

  const nearestZ = Math.max(...boxes.map((box) => box.z))
  let near = Math.max(nearestZ + distanceForZoom(WORKSPACE.fitMaxZoom, height), nearestZ + WORKSPACE.minCameraGap, minZ)
  let far = Math.max(near, WORKSPACE.layer0Z + WORKSPACE.maxCameraDistance)
  const closeFit = solve(near)

  if (closeFit) {
    return { ...closeFit, z: near }
  }

  if (!solve(far)) {
    const xs = boxes.flatMap((box) => [box.x - box.halfWidth, box.x + box.halfWidth])
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: heightAt(far), z: far }
  }

  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (near + far) / 2

    if (solve(middle)) {
      far = middle
    } else {
      near = middle
    }
  }

  return { ...solve(far), z: far }
}
