import { PROJECTS_MOTION, PROJECTS_PLANE, VIEW_DEPTH } from '../app/constants.js'
import { smoothstep } from '../utils/easing.js'
import { renderProjectTiles } from './ProjectsPage.js'

/*
 * Projects DOM controller.
 * The project panels live on a lattice plane deep in the space (PROJECTS_PLANE). While the
 * camera travels, each panel is placed with true perspective for the camera's depth, so from
 * Landing they are lost in the distance and flying in brings them forward like the dots.
 * Ownership rule (spec §71): during any transition JavaScript writes the tile transforms and
 * CSS transitions are disabled; once idle the inline styles are removed and CSS owns the hover.
 */
export function createProjectsView(root) {
  const section = root.querySelector('[data-view="projects"]')
  const grid = section.querySelector('[data-projects-grid]')
  const heading = section.querySelector('[data-projects-heading]')
  let tiles = []
  let origins = []

  // Final tile centres relative to the viewport centre. offsetLeft/Top ignore transforms,
  // so this is valid even while tiles are mid-animation.
  function measure() {
    const gridRect = grid.getBoundingClientRect()
    const centreX = window.innerWidth / 2
    const centreY = window.innerHeight / 2

    origins = tiles.map((tile) => ({
      x: gridRect.left + tile.offsetLeft + tile.offsetWidth / 2 - centreX,
      y: gridRect.top + tile.offsetTop + tile.offsetHeight / 2 - centreY,
    }))
  }

  // spread 0 puts every tile at the viewport centre, 1 at its responsive layout position.
  function setTileFrame(scale, spread, opacity, except = null) {
    tiles.forEach((tile, index) => {
      if (tile === except) {
        return
      }

      const origin = origins[index] || { x: 0, y: 0 }
      const x = origin.x * (spread - 1)
      const y = origin.y * (spread - 1)
      tile.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      tile.style.opacity = opacity.toFixed(3)
    })
  }

  function setHeading(visibility) {
    heading.style.opacity = visibility.toFixed(3)
    heading.style.transform = `translate3d(0, ${(PROJECTS_MOTION.headingOffsetPx * (1 - visibility)).toFixed(2)}px, 0)`
  }

  function beginAnimating() {
    section.classList.add('is-visible')
    section.classList.remove('is-idle')
    section.inert = true
  }

  return {
    element: section,

    render(projects) {
      grid.innerHTML = renderProjectTiles(projects)
      tiles = Array.from(grid.children)
      measure()
    },

    measure,
    beginAnimating,

    /*
     * Landing ⇄ Projects: the panels as seen from a camera at depth cameraZ. A panel at
     * distance d appears at (resting distance / d) of its size, from the vanishing point
     * outwards, and emerges from the dark between PROJECTS_PLANE.emergeFrom and clearAt.
     */
    applyDepth(cameraZ, headingVisibility) {
      const restingDistance = VIEW_DEPTH.projects - PROJECTS_PLANE.z
      const distance = Math.max(0.5, cameraZ - PROJECTS_PLANE.z)
      const scale = restingDistance / distance
      const opacity = 1 - smoothstep(PROJECTS_PLANE.clearAt, PROJECTS_PLANE.emergeFrom, distance)
      setTileFrame(scale, scale, opacity)
      setHeading(headingVisibility)
    },

    // Opening a workspace: everything but the chosen panel fades away.
    applyFocus(chosen, othersVisibility) {
      setTileFrame(1, 1, othersVisibility, chosen)
      setHeading(othersVisibility)
    },

    // prefers-reduced-motion, and Projects returning after a workspace: a fade and slight scale.
    applyFade(visibility) {
      setTileFrame(0.98 + 0.02 * visibility, 1, visibility)
      setHeading(visibility)
    },

    setIdle() {
      tiles.forEach((tile) => {
        tile.style.transform = ''
        tile.style.opacity = ''
      })
      heading.style.opacity = ''
      heading.style.transform = ''
      section.classList.add('is-visible', 'is-idle')
      section.inert = false
    },

    hide() {
      section.classList.remove('is-visible', 'is-idle')
      section.inert = true
    },

    // The list can scroll; zooming out (scrolling down) only takes over at its bottom.
    isScrolledToBottom() {
      return section.scrollTop + section.clientHeight >= section.scrollHeight - 2
    },

    resetScroll() {
      section.scrollTop = 0
    },

    focusFirstTile() {
      tiles[0]?.focus({ preventScroll: true })
    },

    getCreateTile() {
      return grid.querySelector('[data-tile="create"]')
    },

    getProjectTile(projectId) {
      return tiles.find((tile) => tile.dataset.projectId === projectId) || null
    },
  }
}
