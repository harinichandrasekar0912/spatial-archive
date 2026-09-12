export function ProjectCard({ project }) {
  const isNewCard = project.type === 'new'

  return `
    <article
      class="project-card ${project.accent || 'neutral'} ${isNewCard ? 'is-new' : ''}"
      data-project-id="${project.id}"
      data-project-type="${project.type || 'existing'}"
      tabindex="0"
      role="button"
      aria-label="${project.name}"
      aria-pressed="false"
    >
      <div class="project-header">
        <span class="project-tag">${project.tag}</span>
        <span class="project-year">${project.year}</span>
      </div>

      <div class="project-body">
        <h3>${project.name}</h3>
        <p>${project.description}</p>
      </div>

      ${isNewCard ? '<div class="new-archive-mark" aria-hidden="true">+</div>' : '<button type="button" class="project-link">Open project</button>'}
    </article>
  `
}
