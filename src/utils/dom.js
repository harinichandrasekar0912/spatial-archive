const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// User-entered names, notes and filenames are always escaped before entering markup.
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])

const icon = (paths, size = 18, weight = 1.25) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`

// Thin-line icons, plus heavier versions for the workspace chrome, which has to hold its own
// over a busy 3D view (the spec's thin-line rule, §68, was relaxed there on request).
export const ICON = {
  close: icon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  plus: icon('<path d="M12 4.5v15M4.5 12h15"/>', 22),
  home: icon('<path d="M4.5 11.25L12 5l7.5 6.25"/><path d="M6.75 9.75v9h10.5v-9"/>'),
  search: icon('<circle cx="10.5" cy="10.5" r="5.75"/><path d="M15 15l4.75 4.75"/>'),
  closeBold: icon('<path d="M6.75 6.75l10.5 10.5M17.25 6.75l-10.5 10.5"/>', 20, 2.1),
  plusBold: icon('<path d="M12 5v14M5 12h14"/>', 22, 2.1),
  // A solid house with the door cut out.
  homeSolid: icon('<path fill="currentColor" stroke="none" d="M11.36 4.3a1 1 0 0 1 1.28 0l7.27 6.07a.9.9 0 0 1-.58 1.6H18v7.03a1 1 0 0 1-1 1h-3.3v-5.1h-3.4V20H7a1 1 0 0 1-1-1v-7.03H4.67a.9.9 0 0 1-.58-1.6z"/>', 20),
}

export function announce(message) {
  const region = document.querySelector('[data-announcer]')

  if (region) {
    region.textContent = ''
    // A fresh text node makes screen readers repeat identical consecutive messages.
    window.setTimeout(() => {
      region.textContent = message
    }, 30)
  }
}
