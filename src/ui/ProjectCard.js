import { escapeHtml } from '../utils/dom.js'

// Tiles are real <button>s, so Enter / Space activation and focus come for free.
export function CreateTile() {
  return `
    <button type="button" class="project-tile project-tile--create" data-tile="create" aria-haspopup="dialog" aria-label="Create a new project">
      <span class="create-plus" aria-hidden="true"></span>
      <span class="create-label">CREATE</span>
    </button>
  `
}

export function ProjectTile(project) {
  const year = new Date(project.createdAt).getFullYear()

  return `
    <button type="button" class="project-tile" data-tile="project" data-project-id="${escapeHtml(project.id)}" aria-label="Open ${escapeHtml(project.name)}">
      <span class="project-tile__meta">
        <span class="project-tile__category">${escapeHtml(project.category || 'Project')}</span>
        <span>${Number.isFinite(year) ? year : ''}</span>
      </span>
      <span class="project-tile__body">
        <span class="project-tile__name">${escapeHtml(project.name)}</span>
        ${project.description ? `<span class="project-tile__description">${escapeHtml(project.description)}</span>` : ''}
      </span>
    </button>
  `
}
