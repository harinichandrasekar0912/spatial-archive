export function announceStatus(message) {
  const liveRegion = document.getElementById('live-region') || document.createElement('div')

  liveRegion.id = 'live-region'
  liveRegion.setAttribute('role', 'status')
  liveRegion.setAttribute('aria-live', 'polite')
  liveRegion.setAttribute('aria-atomic', 'true')
  liveRegion.className = 'sr-only'
  liveRegion.textContent = message

  document.body.appendChild(liveRegion)
}
