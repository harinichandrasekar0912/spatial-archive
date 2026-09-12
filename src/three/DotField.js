export function buildDotField({ layers = 7, spread = 28, step = 1.25, debugMode = false } = {}) {
  const planeCount = Math.max(1, Math.min(layers, 7))
  const layerDepths = Array.from({ length: planeCount }, (_, layerIndex) => -(layerIndex + 1) * 8)
  const layerDefinitions = []

  for (let layerIndex = 0; layerIndex < layerDepths.length; layerIndex += 1) {
    const depth = layerDepths[layerIndex]
    const localSpread = spread + layerIndex * 2
    const positions = []
    const colors = []

    for (let x = -localSpread; x <= localSpread; x += step) {
      for (let y = -localSpread; y <= localSpread; y += step) {
        const jitterX = (Math.random() - 0.5) * 0.22
        const jitterY = (Math.random() - 0.5) * 0.22

        positions.push(x + jitterX, y + jitterY, depth)

        const baseColor = debugMode ? 0.16 + layerIndex * 0.02 : 0.58 + layerIndex * 0.02
        colors.push(baseColor, baseColor, baseColor)
      }
    }

    layerDefinitions.push({
      positions,
      colors,
      opacity: debugMode ? 0.8 - layerIndex * 0.08 : layerIndex < 2 ? 0.26 : layerIndex < 4 ? 0.18 : 0.08,
      size: debugMode ? 0.18 + layerIndex * 0.01 : 0.06 + layerIndex * 0.003,
      depth,
      layerIndex,
    })
  }

  return { layers: layerDefinitions, layerDepths }
}
