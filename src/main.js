import './styles.css'
import { App } from './app/App.js'
import { initSpatialScene } from './three/SpatialScene.js'
import {
  applyMotionPreference,
  bindDirectEntryControls,
  bindNavigationControls,
  bindProjectCardInteractions,
  initLandingTypewriter,
} from './utils/animation.js'

const appRoot = document.querySelector('#app')
appRoot.innerHTML = App({ state: { navOpen: false } })

const appShell = appRoot.querySelector('.app-shell')
const sceneController = initSpatialScene()

applyMotionPreference()
initLandingTypewriter()
bindNavigationControls()
bindDirectEntryControls({ appShell, sceneController })
bindProjectCardInteractions()

window.addEventListener('beforeunload', () => {
  sceneController?.destroy?.()
})
