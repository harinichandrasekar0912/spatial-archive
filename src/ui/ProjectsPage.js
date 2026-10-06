import { CreateTile, ProjectTile } from './ProjectCard.js'

export function ProjectsPage() {
  return `
    <section class="view projects" data-view="projects" aria-labelledby="projects-heading">
      <h2 class="view-heading" id="projects-heading" data-projects-heading>PROJECTS</h2>
      <div class="projects-grid" data-projects-grid></div>
    </section>
  `
}

// The Create tile is always first (spec §68).
export function renderProjectTiles(projects) {
  return [CreateTile(), ...projects.map(ProjectTile)].join('')
}
