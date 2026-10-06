/*
 * Project metadata (spec §74), persisted in localStorage.
 */

const STORAGE_KEY = 'spatial-archive-projects'
const SCHEMA_KEY = 'spatial-archive-projects-schema'
const SCHEMA_VERSION = 2

// Invented placeholder projects from early prototyping. Schema v2 replaces them with the
// real Luxury Apartment record; projects the user created are kept untouched.
const LEGACY_PLACEHOLDER_IDS = ['atlas-of-voids', 'signal-garden', 'quiet-interfaces']

export const DEMO_PROJECT_ID = 'luxury-apartment'

function createDemoProject() {
  const timestamp = new Date().toISOString()

  return {
    id: DEMO_PROJECT_ID,
    name: 'Luxury Apartment',
    category: 'Architectural design',
    description: 'Research archive for the Luxury Apartment design project.',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function normalizeProject(project) {
  return {
    id: String(project.id),
    name: String(project.name || 'Untitled project'),
    category: String(project.category || project.tag || ''),
    description: String(project.description || ''),
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
  }
}

function readStoredProjects() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    return Array.isArray(parsed) ? parsed.filter((project) => project && project.id) : []
  } catch {
    return []
  }
}

function writeProjects(projects) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
  } catch {
    // Storage can be full or disabled; the in-memory list keeps working for this session.
  }
}

function loadProjects() {
  let projects = readStoredProjects().map(normalizeProject)
  let schema = 1

  try {
    schema = Number(window.localStorage.getItem(SCHEMA_KEY) || 1)
  } catch {
    schema = 1
  }

  if (schema < SCHEMA_VERSION || !projects.length) {
    projects = projects.filter((project) => !LEGACY_PLACEHOLDER_IDS.includes(project.id))

    if (!projects.some((project) => project.id === DEMO_PROJECT_ID)) {
      projects.push(createDemoProject())
    }

    writeProjects(projects)
  }

  return projects
}

function createProjectId() {
  const random = window.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10)
  return `project-${Date.now().toString(36)}-${random}`
}

export function createProjectStore() {
  let projects = loadProjects()

  return {
    list() {
      return projects
    },

    get(id) {
      return projects.find((project) => project.id === id) || null
    },

    add({ name, category = '', description = '' }) {
      const timestamp = new Date().toISOString()
      const project = {
        id: createProjectId(),
        name: String(name).trim(),
        category: String(category).trim(),
        description: String(description).trim(),
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      projects = [project, ...projects]
      writeProjects(projects)
      return project
    },

    touch(id) {
      const project = projects.find((item) => item.id === id)

      if (project) {
        project.updatedAt = new Date().toISOString()
        writeProjects(projects)
      }
    },
  }
}
