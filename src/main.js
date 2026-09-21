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
let wheelIntent = 0
let wheelResetTimer = null
let createModalCloseTimer = null

function clampTransitionProgress(value) {
  return Math.max(0, Math.min(1, value))
}

function easeOutCubic(value) {
  const safeValue = clampTransitionProgress(value)
  return 1 - Math.pow(1 - safeValue, 3)
}

function getProjectRevealProgress(progress) {
  const revealStart = 0.66
  const revealRange = 1 - revealStart
  return clampTransitionProgress((progress - revealStart) / Math.max(0.01, revealRange))
}

function measureProjectCardOrigins() {
  const projectSection = appRoot.querySelector('.projects-page')

  if (!projectSection) {
    return
  }

  const viewportCentreX = window.innerWidth / 2
  const viewportCentreY = window.innerHeight / 2

  projectSection.querySelectorAll('.project-card').forEach((card) => {
    const rect = card.getBoundingClientRect()
    const finalCardCentreX = rect.left + rect.width / 2
    const finalCardCentreY = rect.top + rect.height / 2

    card.dataset.startTranslateX = String(viewportCentreX - finalCardCentreX)
    card.dataset.startTranslateY = String(viewportCentreY - finalCardCentreY)
  })
}

function syncCreateModalOrigin() {
  const modal = appRoot.querySelector('.create-modal')

  if (!modal || state.createModalOpen !== true) {
    return
  }

  const createCard = appRoot.querySelector('.project-card.is-create')

  if (!createCard) {
    return
  }

  const rect = createCard.getBoundingClientRect()
  const originX = rect.left + rect.width / 2
  const originY = rect.top + rect.height / 2
  const viewportCentreX = window.innerWidth / 2
  const viewportCentreY = window.innerHeight / 2

  modal.style.setProperty('--create-translate-x', `${originX - viewportCentreX}px`)
  modal.style.setProperty('--create-translate-y', `${originY - viewportCentreY}px`)
  modal.style.setProperty('--create-scale', '0.02')
  modal.style.setProperty('--create-opacity', '0.2')
  modal.style.setProperty('--create-blur', '0px')

  requestAnimationFrame(() => {
    const activeModal = appRoot.querySelector('.create-modal')

    if (!activeModal) {
      return
    }

    activeModal.classList.add('is-opening')
    activeModal.classList.remove('is-closing')
    activeModal.style.setProperty('--create-scale', '1')
    activeModal.style.setProperty('--create-opacity', '1')
    activeModal.style.setProperty('--create-blur', '5px')
    activeModal.style.setProperty('--create-translate-x', '0px')
    activeModal.style.setProperty('--create-translate-y', '0px')
  })
}

function applyProjectsVisualProgress() {
  const projectSection = appRoot.querySelector('.projects-page')

  if (!projectSection) {
    return
  }

  const rootProgress = clampTransitionProgress(transitionProgress)
  const revealProgress = state.view === 'projects'
    ? getProjectRevealProgress(rootProgress)
    : getProjectRevealProgress(1 - rootProgress)
  const easedReveal = easeOutCubic(revealProgress)

  projectSection.style.setProperty('--projects-progress', rootProgress.toFixed(3))
  projectSection.style.setProperty('--project-scale', (0.02 + easedReveal * 0.98).toFixed(3))
  projectSection.style.setProperty('--project-opacity', (0.18 + easedReveal * 0.82).toFixed(3))

  projectSection.querySelectorAll('.project-card').forEach((card) => {
    const startTranslateX = Number(card.dataset.startTranslateX || 0)
    const startTranslateY = Number(card.dataset.startTranslateY || 0)
    const translateX = startTranslateX * (1 - easedReveal)
    const translateY = startTranslateY * (1 - easedReveal)
    const scale = 0.02 + easedReveal * 0.98
    const opacity = 0.18 + easedReveal * 0.82
    const pointerActive = state.view === 'projects' && easedReveal >= 0.98

    card.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`
    card.style.opacity = opacity.toFixed(3)
    card.style.pointerEvents = pointerActive ? 'auto' : 'none'
  })

  const heading = projectSection.querySelector('.section-heading')

  if (heading) {
    const headingProgress = clampTransitionProgress((rootProgress - 0.75) / 0.25)
    const headingEased = easeOutCubic(headingProgress)
    heading.style.opacity = (0.08 + headingEased * 0.92).toFixed(3)
    heading.style.transform = `translate3d(0, ${12 - headingEased * 12}px, 0)`
    heading.style.pointerEvents = headingEased >= 0.9 && state.view === 'projects' ? 'auto' : 'none'
  }
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

  requestAnimationFrame(() => {
    measureProjectCardOrigins()
    applyProjectsVisualProgress()

    if (state.createModalOpen) {
      syncCreateModalOrigin()
    }
  })

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
  if (transitionLocked || state.createModalOpen) {
    return
  }

  state.createModalOpen = true
  renderApp()
}

function closeCreateModal() {
  const modal = appRoot.querySelector('.create-modal')

  if (!modal) {
    state.createModalOpen = false
    renderApp()
    return
  }

  modal.classList.remove('is-opening')
  modal.classList.add('is-closing')
  modal.style.setProperty('--create-scale', '0.02')
  modal.style.setProperty('--create-opacity', '0.2')
  modal.style.setProperty('--create-blur', '0px')

  clearTimeout(createModalCloseTimer)
  createModalCloseTimer = setTimeout(() => {
    state.createModalOpen = false
    renderApp()
  }, 420)
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

    if (state.view === 'landing') {
      event.preventDefault()
      wheelIntent += Math.abs(event.deltaY)

      if (wheelResetTimer) {
        clearTimeout(wheelResetTimer)
      }

      wheelResetTimer = setTimeout(() => {
        wheelIntent = 0
      }, 160)

      if (wheelIntent >= 110) {
        wheelIntent = 0
        if (wheelResetTimer) {
          clearTimeout(wheelResetTimer)
        }
        enterProjects()
      }
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

window.addEventListener('resize', () => {
  measureProjectCardOrigins()
  applyProjectsVisualProgress()
  syncCreateModalOrigin()
})

window.addEventListener('beforeunload', () => {
  sceneController?.destroy?.()
})
