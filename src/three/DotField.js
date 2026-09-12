export function buildDotField({ layers = 8, spread = 18, step = 1.3 } = {}) {
  const positions = []
  const colors = []

  for (let layer = 0; layer < layers; layer += 1) {
    const depth = -6 - layer * 6.4
    const localSpread = spread - layer * 0.8
    const intensity = 0.4 + (layer / Math.max(layers - 1, 1)) * 0.7

    for (let x = -localSpread; x <= localSpread; x += step) {
      for (let y = -localSpread; y <= localSpread; y += step) {
        const jitterX = (Math.random() - 0.5) * 0.28
        const jitterY = (Math.random() - 0.5) * 0.28

        positions.push(x + jitterX, y + jitterY, depth)

        const base = 0.55 + intensity * 0.45
        colors.push(base, base, base)
      }
    }
  }

  return { positions, colors }
}
