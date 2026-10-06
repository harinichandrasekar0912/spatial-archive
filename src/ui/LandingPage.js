export const TAGLINE = 'Start with an idea...'

const ARROW_UP = '<svg class="zoom-hint__arrow" width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 14.5V2M1.75 6.25L6 2l4.25 4.25"/></svg>'

// The invisible "measure" copy reserves the final width, so the phrase is centred as a whole
// and typing runs left to right instead of re-centring on every character.
export function LandingPage() {
  return `
    <section class="view landing" data-view="landing" aria-label="Spatial Archive">
      <p class="tagline">
        <span class="sr-only">${TAGLINE}</span>
        <span class="tagline__measure" aria-hidden="true">${TAGLINE}</span>
        <span class="tagline__typed" data-tagline-line aria-hidden="true"><span data-tagline></span><span class="tagline__caret" data-caret></span></span>
      </p>

      <p class="zoom-hint" data-zoom-hint>
        <span class="zoom-hint__bounce" aria-hidden="true">${ARROW_UP}<span>zoom in to start</span></span>
        <span class="sr-only">Scroll up, or press Enter, to see the projects.</span>
      </p>
    </section>
  `
}
