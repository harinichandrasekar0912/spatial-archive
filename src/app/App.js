import { LandingPage } from '../ui/LandingPage.js'
import { NavigationOverlay } from '../ui/NavigationOverlay.js'
import { ProjectsPage } from '../ui/ProjectsPage.js'
import { WorkspacePage } from '../ui/WorkspacePage.js'
import { CreateProjectModal } from '../ui/CreateProjectModal.js'
import { initialState } from './state.js'
import { loadProjects } from '../data/projects.js'

export function App({ state = initialState, projectList = loadProjects() } = {}) {
  const selectedProject = projectList.find((project) => project.id === state.selectedProjectId) || null
  const isProjectsView = state.view === 'projects'
  const isWorkspaceView = state.view === 'workspace'
  const isCreateOpen = state.createModalOpen === true

  return `
    <div class="app-shell ${isProjectsView ? 'is-projects-view' : ''} ${isWorkspaceView ? 'is-workspace-view' : ''} ${isCreateOpen ? 'is-create-modal-open' : ''}">
      ${NavigationOverlay({ state })}
      <main class="page-shell">
        ${LandingPage({ state })}
        ${ProjectsPage({ projects: projectList })}
        ${WorkspacePage({ project: selectedProject })}
      </main>
      ${CreateProjectModal({ state })}
    </div>
  `
}
