import { LandingPage } from '../ui/LandingPage.js'
import { ProjectsPage } from '../ui/ProjectsPage.js'
import { WorkspacePage } from '../ui/WorkspacePage.js'
import { CreateProjectModal } from '../ui/CreateProjectModal.js'

/*
 * Static application shell, rendered exactly once. Views never replace each other's DOM:
 * transitions only change transforms and opacity, so there are no flashes or re-mounts.
 */
export function App() {
  return `
    <h1 class="brand" data-brand>SPATIAL ARCHIVE</h1>

    <main class="page-shell" data-page-shell>
      ${LandingPage()}
      ${ProjectsPage()}
      ${WorkspacePage()}
    </main>

    ${CreateProjectModal()}

    <div class="sr-only" role="status" aria-live="polite" data-announcer></div>
  `
}
