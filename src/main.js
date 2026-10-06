import './styles.css'
import { App } from './app/App.js'
import { INPUT } from './app/constants.js'
import { createNavigator } from './app/navigator.js'
import { createProjectStore } from './data/projects.js'
import { warmEffects } from './app/dustEffects.js'
import { createDotGlow } from './three/dotGlow.js'
import { createDustLayer } from './three/DustLayer.js'
import { createSpatialScene } from './three/SpatialScene.js'
import { createCreateModal } from './ui/CreateModal.js'
import { createLandingView } from './ui/LandingView.js'
import { createProjectsView } from './ui/ProjectsView.js'
import { prefersReducedMotion } from './utils/easing.js'
import { createWorkspace } from './workspace/Workspace.js'

const appRoot = document.querySelector('#app')
const spatialRoot = document.querySelector('#spatial-root')
const reducedMotion = prefersReducedMotion()
document.documentElement.classList.toggle('reduced-motion', reducedMotion)

// The shell is rendered once; from here on views only change transforms and opacity.
appRoot.innerHTML = App()

const scene = createSpatialScene(spatialRoot)
const dust = createDustLayer(scene)
const projectStore = createProjectStore()
const landing = createLandingView(appRoot)
const projects = createProjectsView(appRoot)
let nav = null

const modal = createCreateModal(appRoot, {
  pageShell: appRoot.querySelector('[data-page-shell]'),
  reducedMotion,
  getCreateTile: () => projects.getCreateTile(),
  onSubmit(values) {
    const project = projectStore.add(values)
    nav.openWorkspace(project.id, { fromCreate: true })
  },
})

const workspace = createWorkspace(appRoot, {
  scene,
  reducedMotion,
  onRequestClose: () => nav.closeWorkspace(),
})

nav = createNavigator({
  scene,
  brand: appRoot.querySelector('[data-brand]'),
  landing,
  projects,
  modal,
  workspace,
  projectStore,
  dust,
  reducedMotion,
})

scene.onFrame(nav.frame)

// Landing and Projects: the dots near the pointer brighten like stars (after nav.frame, so it
// sees this frame's view and fade).
createDotGlow(scene, {
  reducedMotion,
  isEnabled() {
    const view = nav.getView()
    return (view === 'landing' || view === 'projects') && !modal.isActive()
  },
})

nav.boot()
scene.start()
// Compile the scene's and the dust's shaders now, in parallel, rather than mid-transition, and
// give the dust effects one invisible run while the page is idle.
scene.renderer.compileAsync(scene.world, scene.camera).catch(() => {})
dust.warm(scene.renderer).catch(() => {})
;(window.requestIdleCallback || ((callback) => setTimeout(callback, 1500)))(
  () => {
    if (!dust.isActive()) {
      warmEffects(dust, { viewport: scene.viewport })
      dust.drawInvisibly(scene.renderer)
    }
  },
  { timeout: 4000 },
)

// Development-only handle for inspecting the camera and views from the console.
if (import.meta.env.DEV) {
  window.__spatialArchive = { scene, nav, workspace, projects, modal, dust }
}

// ── Project tiles ─────────────────────────────────────────────────────────────────────

projects.element.addEventListener('click', (event) => {
  const tile = event.target.closest('[data-tile]')

  if (!tile || !nav.isIdleIn('projects') || modal.isActive()) {
    return
  }

  if (tile.dataset.tile === 'create') {
    modal.open(tile)
  } else {
    nav.openWorkspace(tile.dataset.projectId)
  }
})

// ── Wheel intent (spec §48–49) ────────────────────────────────────────────────────────
// Scrolling up zooms in (Landing → Projects); scrolling down zooms out (Projects → Landing).
// The page never scrolls on Landing; wheel movement is accumulated as navigation intent.
// A wheel "stream" that began before the current view became idle (e.g. trackpad momentum
// from the previous transition) is ignored.

let wheelIntent = 0
let lastWheelAt = -Infinity
let wheelStreamStart = -Infinity
let lastProjectsScrollAt = -Infinity

projects.element.addEventListener(
  'scroll',
  () => {
    lastProjectsScrollAt = performance.now()
  },
  { passive: true },
)

window.addEventListener(
  'wheel',
  (event) => {
    const now = performance.now()
    const view = nav.getView()

    if (now - lastWheelAt > INPUT.wheelIdleResetMs) {
      wheelIntent = 0
      wheelStreamStart = now
    }

    lastWheelAt = now
    const freshStream = wheelStreamStart >= nav.getIdleAt()

    if (view === 'landing') {
      event.preventDefault()

      // Only scrolling up (zooming in) leads anywhere from Landing.
      if (event.deltaY > 0) {
        wheelIntent = 0
      }

      if (!freshStream || !nav.canLeaveLanding() || event.deltaY >= 0) {
        return
      }

      wheelIntent += -event.deltaY

      if (wheelIntent >= INPUT.wheelThreshold) {
        wheelIntent = 0
        nav.enterProjects()
      }

      return
    }

    if (view !== 'projects' || !nav.isIdleIn('projects') || modal.isActive() || !freshStream) {
      return
    }

    // Zooming out takes over once the list (if it scrolls at all) has reached its bottom.
    const settled = now - lastProjectsScrollAt > INPUT.scrollSettleMs

    if (event.deltaY > 0 && projects.isScrolledToBottom() && settled) {
      wheelIntent += event.deltaY

      if (wheelIntent >= INPUT.wheelThreshold) {
        wheelIntent = 0
        nav.returnToLanding()
      }
    } else {
      wheelIntent = 0
    }
  },
  { passive: false },
)

// ── Touch swipes ──────────────────────────────────────────────────────────────────────
// A finger dragging down scrolls up (zoom in); dragging up scrolls down (zoom out).

let touchStart = null

window.addEventListener(
  'touchstart',
  (event) => {
    touchStart = event.touches.length === 1 ? { y: event.touches[0].clientY, time: performance.now() } : null
  },
  { passive: true },
)

window.addEventListener(
  'touchmove',
  (event) => {
    if (!touchStart) {
      return
    }

    const view = nav.getView()
    const travelled = touchStart.y - event.touches[0].clientY
    const deliberate = performance.now() - touchStart.time > INPUT.swipeMinMs

    if (view === 'landing') {
      event.preventDefault()

      // Any deliberate swipe leaves Landing: there is nothing to zoom out to.
      if (Math.abs(travelled) > INPUT.swipeThresholdPx && deliberate && nav.canLeaveLanding()) {
        touchStart = null
        nav.enterProjects()
      }

      return
    }

    const pushingUp = travelled > INPUT.swipeThresholdPx

    if (view === 'projects' && pushingUp && deliberate && nav.isIdleIn('projects') && !modal.isActive() && projects.isScrolledToBottom()) {
      touchStart = null
      nav.returnToLanding()
    }
  },
  { passive: false },
)

// ── Keyboard ──────────────────────────────────────────────────────────────────────────

const ENTER_KEYS = new Set(['ArrowUp', 'PageUp', 'Enter', ' '])
const BACK_KEYS = new Set(['ArrowDown', 'PageDown', 'Escape'])

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey) {
    return
  }

  // A long transition (opening a workspace) can be hurried along with any key.
  if (nav.isTransitioning()) {
    nav.skipTransition()
  }

  // Escape on the Create form always uses the same reverse animation as X / backdrop.
  if (modal.isActive()) {
    if (event.key === 'Escape' && modal.isDismissible()) {
      event.preventDefault()
      modal.close()
    }

    return
  }

  const view = nav.getView()

  if (view === 'workspace') {
    if (workspace.handleKeyDown(event)) {
      event.preventDefault()
    }

    return
  }

  if (event.ctrlKey || event.metaKey) {
    return
  }

  if (view === 'landing' && ENTER_KEYS.has(event.key) && nav.canLeaveLanding()) {
    event.preventDefault()
    nav.enterProjects({ viaKeyboard: true })
    return
  }

  // Arrows and Escape zoom back out once the list has reached its end.
  if (view === 'projects' && BACK_KEYS.has(event.key) && nav.isIdleIn('projects') && projects.isScrolledToBottom()) {
    event.preventDefault()
    nav.returnToLanding()
  }
})

window.addEventListener('pointerdown', () => {
  if (nav.isTransitioning()) {
    nav.skipTransition()
  }
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => projects.measure())

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    workspace.flush()
  }
})

window.addEventListener('pagehide', () => workspace.flush())

// The app updates the hash with replaceState (which fires no event). A hashchange therefore
// means the user edited the URL or used history: boot straight into that view.
window.addEventListener('hashchange', () => {
  workspace.flush()
  window.location.reload()
})
