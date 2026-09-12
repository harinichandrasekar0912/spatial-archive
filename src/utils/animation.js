export function applyMotionPreference() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (prefersReducedMotion) {
    document.body.classList.add('reduced-motion')
  }

  return prefersReducedMotion
}

export function initLandingTypewriter() {
  const elements = document.querySelectorAll('[data-typewriter-text]')

  if (!elements.length) {
    return
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  elements.forEach((element) => {
    const text = element.dataset.typewriterText || ''
    const caret = element.nextElementSibling

    if (!text) {
      return
    }

    if (prefersReducedMotion) {
      element.textContent = text

      if (caret) {
        caret.classList.add('is-visible', 'is-finished')
      }

      return
    }

    let index = 0

    const typeNextCharacter = () => {
      element.textContent = text.slice(0, index)
      index += 1

      if (index <= text.length) {
        window.setTimeout(typeNextCharacter, 75)
        return
      }

      if (caret) {
        caret.classList.add('is-finished')
      }
    }

    if (caret) {
      caret.classList.add('is-visible')
    }

    window.setTimeout(typeNextCharacter, 180)
  })
}

export function bindNavigationControls() {
  const toggleButton = document.querySelector('.menu-toggle')
  const navOverlay = document.querySelector('.nav-overlay')

  if (!toggleButton || !navOverlay) {
    return
  }

  const setNavState = (isOpen) => {
    toggleButton.classList.toggle('is-open', isOpen)
    toggleButton.setAttribute('aria-expanded', String(isOpen))
    toggleButton.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu')
    navOverlay.classList.toggle('is-open', isOpen)
    navOverlay.setAttribute('aria-hidden', String(!isOpen))
  }

  toggleButton.addEventListener('click', () => {
    const willOpen = !toggleButton.classList.contains('is-open')
    setNavState(willOpen)
  })

  toggleButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleButton.click()
    }
  })

  navOverlay.addEventListener('click', (event) => {
    const link = event.target.closest('a')

    if (link) {
      setNavState(false)
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggleButton.classList.contains('is-open')) {
      setNavState(false)
    }
  })
}

export function bindDirectEntryControls({ appShell, sceneController } = {}) {
  if (!appShell) {
    return
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let wheelLockUntil = 0
  let touchStartY = null
  let touchStartTime = 0

  const triggerEntry = () => {
    if (appShell.classList.contains('is-projects-view') || appShell.classList.contains('is-transitioning')) {
      return
    }

    appShell.classList.add('is-transitioning')
    sceneController?.startEntryTransition?.()

    window.setTimeout(() => {
      appShell.classList.remove('is-transitioning')
      appShell.classList.add('is-projects-view')

      const projectsSection = document.querySelector('#projects')
      const behavior = prefersReducedMotion ? 'auto' : 'smooth'

      if (projectsSection) {
        projectsSection.scrollIntoView({ behavior, block: 'start' })
      }
    }, prefersReducedMotion ? 180 : 1100)
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (appShell.classList.contains('is-projects-view')) {
        return
      }

      if (event.deltaY <= 45 || Date.now() < wheelLockUntil) {
        return
      }

      event.preventDefault()
      wheelLockUntil = Date.now() + 1200
      triggerEntry()
    },
    { passive: false },
  )

  document.addEventListener(
    'touchstart',
    (event) => {
      if (appShell.classList.contains('is-projects-view')) {
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
      if (appShell.classList.contains('is-projects-view') || touchStartY === null) {
        return
      }

      const touch = event.touches[0]
      const deltaY = touchStartY - touch.clientY

      if (deltaY > 60 && Date.now() - touchStartTime > 120) {
        event.preventDefault()
        touchStartY = null
        triggerEntry()
      }
    },
    { passive: false },
  )
}

export function bindProjectCardInteractions() {
  const cards = document.querySelectorAll('.project-card')

  if (!cards.length) {
    return
  }

  cards.forEach((card) => {
    const focusCard = () => {
      cards.forEach((item) => {
        const isFocused = item === card
        item.classList.toggle('is-focused', isFocused)
        item.classList.toggle('is-dimmed', !isFocused)
        item.setAttribute('aria-pressed', String(isFocused))
      })
    }

    card.addEventListener('click', focusCard)

    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        focusCard()
      }
    })
  })
}
