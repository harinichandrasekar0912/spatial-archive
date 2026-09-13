import { ProjectCard } from './ProjectCard.js'

export function ProjectsPage({ projects = [] }) {
  const createCard = {
    id: 'create-project',
    name: 'CREATE',
    tag: 'NEW',
    description: '',
    year: '',
    accent: 'neutral',
    type: 'create',
  }

  const content = [createCard, ...projects]

  return `
    <section id="projects" class="projects-page">
      <div class="section-heading">
        <p class="eyebrow">SPATIAL ARCHIVE</p>
        <h2>PROJECTS</h2>
      </div>
      <div class="projects-grid">
        ${content.map((project) => ProjectCard({ project })).join('')}
      </div>
    </section>
  `
}
