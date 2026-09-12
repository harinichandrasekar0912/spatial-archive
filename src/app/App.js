import { LandingPage } from '../ui/LandingPage.js'
import { NavigationOverlay } from '../ui/NavigationOverlay.js'
import { ProjectsPage } from '../ui/ProjectsPage.js'
import { initialState } from './state.js'
import { projects } from '../data/projects.js'

export function App({ state = initialState, projectList = projects } = {}) {
  return `
    <div class="app-shell">
      ${NavigationOverlay({ state })}
      <main class="page-shell">
        ${LandingPage({ state })}
        ${ProjectsPage({ projects: projectList })}
      </main>
    </div>
  `
}
