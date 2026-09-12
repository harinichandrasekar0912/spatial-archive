const STORAGE_KEY = 'spatial-archive-projects'

export const defaultProjects = [
  {
    id: 'atlas-of-voids',
    name: 'Atlas of Voids',
    tag: 'Spatial Identity System',
    category: 'Spatial Identity System',
    description:
      'A field-based archive of urban remnants mapped as navigable spatial objects and memory anchors.',
    year: '2025',
    accent: 'violet',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'signal-garden',
    name: 'Signal Garden',
    tag: 'Interactive Storytelling',
    category: 'Interactive Storytelling',
    description:
      'A layered landscape of diary fragments, environmental data, and visual traces reconstructed for exploration.',
    year: '2024',
    accent: 'cyan',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'quiet-interfaces',
    name: 'Quiet Interfaces',
    tag: 'Archive UX',
    category: 'Archive UX',
    description:
      'A minimal reading experience designed for slow browsing, reduced motion, and accessible discovery.',
    year: '2023',
    accent: 'amber',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
  },
]

export function loadProjects() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return [...defaultProjects]
    }

    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) && parsed.length ? parsed : [...defaultProjects]
  } catch {
    return [...defaultProjects]
  }
}

export function persistProjects(projects) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch {
    // Ignore persistence errors and keep the in-memory state intact.
  }
}

export function createProjectRecord({ name, category = '', description = '' } = {}) {
  const timestamp = new Date().toISOString()

  return {
    id: `project-${timestamp}-${Math.random().toString(16).slice(2, 8)}`,
    name: String(name || '').trim(),
    category: String(category || '').trim(),
    description: String(description || '').trim(),
    tag: String(category || 'PROJECT'),
    year: 'NEW',
    accent: 'neutral',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
