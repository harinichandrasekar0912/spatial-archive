import './styles.css'
import { App } from './app/App.js'
import { initialState } from './app/state.js'
import { createProjectRecord, loadProjects, persistProjects } from './data/projects.js'
import { initSpatialScene } from './three/SpatialScene.js'
import { applyMotionPreference, initLandingTypewriter } from './utils/animation.js'

const appRoot = document.querySelector('#app')
const spatialRoot = document.querySelector('#spatial-root')
const state = { ...initialState }
const sceneState = { cameraZ: 0 }
const viewDepths = {
  landing: 0,
  projects: -18,
  workspace: -42,
}
let projects = loadProjects()
let sceneController = initSpatialScene(spatialRoot, sceneState)
let transitionLocked = false
let wheelLockUntil = 0
let touchStartY = null
let touchStartTime = 0

function renderApp() {
  sceneState.cameraZ = sceneController?.getCameraDepth?.() ?? sceneState.cameraZ

  appRoot.innerHTML = App({ state, projectList: projects })
  applyMotionPreference()
  initLandingTypewriter()

  const targetDepth = viewDepths[state.view] ?? 0

  if (sceneController && targetDepth !== sceneState.cameraZ) {
    sceneController.startEntryTransition({
      targetZ: targetDepth,
      duration: state.view === 'landing' ? 0 : 1500,
    })
  }
}

function enterProjects() {
  if (transitionLocked || state.view === 'projects') {
    return
  }

  transitionLocked = true
  state.navOpen = false
  state.view = 'projects'
  state.createModalOpen = false

  renderApp()

  window.setTimeout(() => {
    transitionLocked = false
  }, 1200)
}

function openCreateModal() {
  state.createModalOpen = true
  state.navOpen = false
  renderApp()
}

function closeCreateModal() {
  state.createModalOpen = false
  renderApp()
}

function openWorkspace(projectId) {
  if (transitionLocked) {
    return
  }

  transitionLocked = true
  state.navOpen = false
  state.selectedProjectId = projectId
  state.view = 'workspace'
  state.createModalOpen = false

  renderApp()

  window.setTimeout(() => {
    transitionLocked = false
  }, 1200)
}

renderApp()

appRoot.addEventListener('click', (event) => {
  const menuToggle = event.target.closest('.menu-toggle')

  if (menuToggle) {
    state.navOpen = !state.navOpen
    renderApp()
    return
  }

  const navLink = event.target.closest('.nav-link')

  if (navLink) {
    const action = navLink.dataset.action

    if (action === 'projects') {
      enterProjects()
      return
    }

    if (action === 'create') {
      openCreateModal()
      return
    }

    state.navOpen = false
    state.view = 'landing'
    renderApp()
    return
  }

  const closeModalButton = event.target.closest('[data-action="close-create-modal"]')

  if (closeModalButton) {
    closeCreateModal()
    return
  }

  const projectCard = event.target.closest('.project-card')

  if (projectCard) {
    const projectType = projectCard.dataset.projectType

    if (projectType === 'create') {
      openCreateModal()
      return
    }

    openWorkspace(projectCard.dataset.projectId)
  }
})

appRoot.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-create-form]')) {
    return
  }

  event.preventDefault()

  const form = event.target
  const formData = new FormData(form)
  const name = String(formData.get('name') || '').trim()
  const category = String(formData.get('category') || '').trim()
  const description = String(formData.get('description') || '').trim()

  if (!name) {
    const fieldError = form.querySelector('.form-error')

    if (fieldError) {
      fieldError.textContent = 'Project name is required.'
    }

    return
  }

  const project = createProjectRecord({ name, category, description })
  projects = [project, ...projects]
  persistProjects(projects)

  state.selectedProjectId = project.id
  state.view = 'workspace'
  state.createModalOpen = false

  renderApp()
})

appRoot.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.createModalOpen) {
      closeCreateModal()
      return
    }

    if (state.navOpen) {
      state.navOpen = false
      renderApp()
    }

    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    const projectCard = event.target.closest('.project-card')

    if (projectCard) {
      event.preventDefault()

      if (projectCard.dataset.projectType === 'create') {
        openCreateModal()
        return
      }

      openWorkspace(projectCard.dataset.projectId)
    }
  }
})

window.addEventListener(
  'wheel',
  (event) => {
    if (state.view !== 'landing' || transitionLocked) {
      return
    }

    if (Math.abs(event.deltaY) < 45 || Date.now() < wheelLockUntil) {
      return
    }

    event.preventDefault()
    wheelLockUntil = Date.now() + 1200
    enterProjects()
  },
  { passive: false },
)

document.addEventListener(
  'touchstart',
  (event) => {
    if (state.view !== 'landing') {
      return
    }

    const touch = event.touches[0]
    touchStartY = touch.clientY
    touchStartTime = Date.now()
  },
  { passive: true },
)

document.addEventListener(
  'touchmove',
  (event) => {
    if (state.view !== 'landing' || touchStartY === null || transitionLocked) {
      return
    }

    const touch = event.touches[0]
    const deltaY = touchStartY - touch.clientY

    if (deltaY > 60 && Date.now() - touchStartTime > 120) {
      event.preventDefault()
      touchStartY = null
      enterProjects()
    }
  },
  { passive: false },
)

window.addEventListener('beforeunload', () => {
  sceneController?.destroy?.()
})
