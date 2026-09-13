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
let transitionProgress = 0
let landingIntroPlayed = false

function applyProjectsVisualProgress() {
  const projectSection = appRoot.querySelector('.projects-page')

  if (!projectSection) {
    return
  }

  const rootProgress = clampTransitionProgress(transitionProgress)
  const progressValue = state.view === 'projects' ? rootProgress : 1 - rootProgress
  const scale = 0.12 + progressValue * 0.88
  const opacity = 0.12 + progressValue * 0.88

  projectSection.style.setProperty('--projects-progress', rootProgress.toFixed(3))
  projectSection.style.setProperty('--project-scale', scale.toFixed(3))
  projectSection.style.setProperty('--project-opacity', opacity.toFixed(3))
}

function clampTransitionProgress(value) {
  return Math.max(0, Math.min(1, value))
}

function syncLandingTagline() {
  const elements = document.querySelectorAll('[data-typewriter-text]')

  elements.forEach((element) => {
    const text = element.dataset.typewriterText || ''
    const caret = element.nextElementSibling

    if (!text) {
      return
    }

    element.textContent = text

    if (caret) {
      caret.classList.add('is-visible', 'is-finished')
    }
  })
}

function syncAppShellState() {
  const appShell = appRoot.querySelector('.app-shell')

  if (!appShell) {
    return
  }

  appShell.classList.toggle('is-projects-view', state.view === 'projects')
  appShell.classList.toggle('is-workspace-view', state.view === 'workspace')
  appShell.classList.toggle('is-create-modal-open', state.createModalOpen === true)
}

function renderApp({ refreshDOM = false } = {}) {
  sceneState.cameraZ = sceneController?.getCameraDepth?.() ?? sceneState.cameraZ

  if (refreshDOM || !appRoot.querySelector('.app-shell')) {
    appRoot.innerHTML = App({ state, projectList: projects })
  }

  syncAppShellState()
  applyMotionPreference()

  if (!landingIntroPlayed) {
    initLandingTypewriter()
    landingIntroPlayed = true
  } else if (state.view === 'landing') {
    syncLandingTagline()
  }

  applyProjectsVisualProgress()

  const targetDepth = viewDepths[state.view] ?? 0

  if (sceneController && targetDepth !== sceneState.cameraZ) {
    sceneController.startEntryTransition({
      targetZ: targetDepth,
      duration: state.view === 'landing' ? 0 : 1500,
      onProgress: (progress) => {
        transitionProgress = progress
        applyProjectsVisualProgress()
      },
      onComplete: () => {
        transitionLocked = false
      },
    })
  } else {
    transitionLocked = false
  }
}

function enterProjects() {
  if (transitionLocked || state.view === 'projects') {
    return
  }

  transitionLocked = true
  state.createModalOpen = false
  state.view = 'projects'
  transitionProgress = 0

  renderApp()
}

function returnToLanding() {
  if (transitionLocked || state.view === 'landing') {
    return
  }

  transitionLocked = true
  state.createModalOpen = false
  state.view = 'landing'
  transitionProgress = 0

  renderApp()
}

function openCreateModal() {
  state.createModalOpen = true
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
  state.selectedProjectId = projectId
  state.view = 'workspace'
  state.createModalOpen = false

  renderApp({ refreshDOM: true })
}

renderApp()

appRoot.addEventListener('click', (event) => {
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
    if (transitionLocked) {
      return
    }

    if (state.view === 'landing' && event.deltaY > 45 && Date.now() >= wheelLockUntil) {
      event.preventDefault()
      wheelLockUntil = Date.now() + 1200
      enterProjects()
      return
    }

    if (state.view === 'projects' && event.deltaY < -45 && Date.now() >= wheelLockUntil) {
      event.preventDefault()
      wheelLockUntil = Date.now() + 1200
      returnToLanding()
    }
  },
  { passive: false },
)

document.addEventListener(
  'touchstart',
  (event) => {
    if (transitionLocked) {
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
    if (touchStartY === null || transitionLocked) {
      return
    }

    const touch = event.touches[0]
    const deltaY = touchStartY - touch.clientY

    if (state.view === 'landing' && deltaY > 60 && Date.now() - touchStartTime > 120) {
      event.preventDefault()
      touchStartY = null
      enterProjects()
      return
    }

    if (state.view === 'projects' && deltaY < -60 && Date.now() - touchStartTime > 120) {
      event.preventDefault()
      touchStartY = null
      returnToLanding()
    }
  },
  { passive: false },
)

window.addEventListener('beforeunload', () => {
  sceneController?.destroy?.()
})
