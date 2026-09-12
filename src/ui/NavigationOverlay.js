export function NavigationOverlay({ state = {} } = {}) {
  const isOpen = state.navOpen === true

  return `
    <header class="topbar">
      <button
        type="button"
        class="menu-toggle ${isOpen ? 'is-open' : ''}"
        aria-expanded="${isOpen}"
        aria-controls="nav-overlay"
        aria-label="${isOpen ? 'Close navigation menu' : 'Open navigation menu'}"
      >
        <span class="menu-line menu-line-top"></span>
        <span class="menu-line menu-line-middle"></span>
        <span class="menu-line menu-line-bottom"></span>
      </button>
    </header>

    <div id="nav-overlay" class="nav-overlay ${isOpen ? 'is-open' : ''}" aria-hidden="${isOpen ? 'false' : 'true'}">
      <nav class="overlay-nav" aria-label="Main navigation">
        <button type="button" class="nav-link" data-action="create">CREATE</button>
        <button type="button" class="nav-link" data-action="projects">PROJECTS</button>
        <button type="button" class="nav-link" data-action="about">ABOUT</button>
      </nav>
    </div>
  `
}
