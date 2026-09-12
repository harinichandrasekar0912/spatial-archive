export function buildDotField({ layers = 6, spread = 16, step = 1.2 } = {}) {
  const layerDefinitions = []

  for (let layer = 0; layer < layers; layer += 1) {
    const depth = -10 - layer * 7
    const localSpread = spread + layer * 2.6
    const intensity = 0.3 + (layer / Math.max(layers - 1, 1)) * 0.5
    const size = 0.05 + layer * 0.01
    const opacity = Math.max(0.04, 0.3 - layer * 0.04)
    const positions = []
    const colors = []

    for (let x = -localSpread; x <= localSpread; x += step) {
      for (let y = -localSpread; y <= localSpread; y += step) {
        const jitterX = (Math.random() - 0.5) * 0.22
        const jitterY = (Math.random() - 0.5) * 0.22

        positions.push(x + jitterX, y + jitterY, depth)

        const base = 0.62 + intensity * 0.32
        colors.push(base, base, base)
      }
    }

    layerDefinitions.push({
      positions,
      colors,
      opacity,
      size,
      depth,
    })
  }

  return { layers: layerDefinitions }
}
