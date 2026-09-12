export function WorkspacePage({ project = null }) {
  if (!project) {
    return `
      <section class="workspace-page" aria-live="polite">
        <div class="workspace-shell">
          <div class="workspace-empty" aria-label="Empty workspace"></div>
        </div>
      </section>
    `
  }

  return `
    <section class="workspace-page" aria-live="polite">
      <div class="workspace-shell">
        <div class="workspace-header">
          <p class="eyebrow">PROJECT</p>
          <h2>${project.name}</h2>
        </div>

        <div class="workspace-grid">
          <article class="workspace-panel panel-primary">
            <p class="panel-label">${project.category || 'ARCHIVE'}</p>
            <h3>${project.name}</h3>
            <p>${project.description || 'A new project space is ready for future content.'}</p>
          </article>

          <article class="workspace-panel panel-secondary">
            <p class="panel-label">STATUS</p>
            <h3>READY</h3>
            <p>Workspace shell prepared for the next spatial layer.</p>
          </article>

          <article class="workspace-panel panel-tertiary">
            <p class="panel-label">NOTES</p>
            <h3>ARCHIVE</h3>
            <p>Project content can be replaced later without changing the spatial system.</p>
          </article>
        </div>
      </div>
    </section>
  `
}
