import { ProjectCard } from './ProjectCard.js'

export function ProjectsPage({ projects = [] }) {
  const archiveCards = [
    {
      id: 'luxury-apartment',
      name: 'LUXURY APARTMENT',
      tag: '24 OBJECTS',
      description: 'Placeholder project entry for the current Spatial Archive phase.',
      year: 'CURRENT',
      accent: 'neutral',
      type: 'existing',
    },
    {
      id: 'new-archive',
      name: 'NEW ARCHIVE',
      tag: 'ADD OBJECT',
      description: 'Reserve location for the next spatial archive entry.',
      year: 'UPCOMING',
      accent: 'neutral',
      type: 'new',
    },
  ]

  const content = projects.length ? projects : archiveCards

  return `
    <section id="projects" class="projects-page">
      <div class="section-heading">
        <p class="eyebrow">ARCHIVE</p>
        <h2>PROJECTS</h2>
      </div>
      <div class="projects-grid">
        ${content.map((project) => ProjectCard({ project })).join('')}
      </div>
    </section>
  `
}
