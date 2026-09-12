import { SpatialScene } from '../three/SpatialScene.js'

export function LandingPage() {
  return `
    <section id="landing" class="landing-page">
      <div class="landing-copy">
        <h1 class="brand-name">SPATIAL ARCHIVE</h1>
        <p class="tagline" aria-live="polite">
          <span class="typewriter-text" data-typewriter-text="Start with an idea..."></span>
          <span class="typewriter-caret" aria-hidden="true"></span>
        </p>
      </div>
      ${SpatialScene()}
    </section>
  `
}
