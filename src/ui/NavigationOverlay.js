export function NavigationOverlay({ state = {} } = {}) {
  const isOpen = state.navOpen === true

  return `
    <header class="topbar">
      <div class="brand-mark" aria-label="Spatial Archive home">
        <span class="brand-dot"></span>
        <span>Spatial Archive</span>
      </div>

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
        <a href="#projects">PROJECTS</a>
        <a href="#how-it-works">HOW IT WORKS</a>
        <a href="#about">ABOUT</a>
      </nav>
    </div>
  `
}
