export function ProjectCard({ project }) {
  const isCreateCard = project.type === 'create'

  return `
    <article
      class="project-card ${project.accent || 'neutral'} ${isCreateCard ? 'is-create' : ''}"
      data-project-id="${project.id}"
      data-project-type="${project.type || 'existing'}"
      tabindex="0"
      role="button"
      aria-label="${project.name}"
      aria-pressed="false"
    >
      ${isCreateCard ? `
        <div class="create-card-body">
          <div class="new-archive-mark" aria-hidden="true">+</div>
          <span class="create-card-label">CREATE</span>
        </div>
      ` : `
        <div class="project-header">
          <span class="project-tag">${project.tag}</span>
          <span class="project-year">${project.year}</span>
        </div>

        <div class="project-body">
          <h3>${project.name}</h3>
          <p>${project.description}</p>
        </div>
      `}
    </article>
  `
}
