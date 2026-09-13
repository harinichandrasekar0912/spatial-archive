export function buildDotField({ layers = 8, spread = 36, step = 1.4, debugMode = false } = {}) {
  const planeCount = Math.max(1, Math.min(layers, 8))
  const layerDepths = Array.from({ length: planeCount }, (_, layerIndex) => -(layerIndex + 1) * 10)
  const layerDefinitions = []

  for (let layerIndex = 0; layerIndex < layerDepths.length; layerIndex += 1) {
    const depth = layerDepths[layerIndex]
    const localSpread = spread + layerIndex * 1.5
    const positions = []
    const colors = []

    for (let x = -localSpread; x <= localSpread; x += step) {
      for (let y = -localSpread; y <= localSpread; y += step) {
        positions.push(x, y, 0)

        const baseColor = debugMode ? 0.16 + layerIndex * 0.02 : 0.54 + layerIndex * 0.018
        colors.push(baseColor, baseColor, baseColor)
      }
    }

    const opacity = debugMode ? 0.8 - layerIndex * 0.08 : layerIndex < 2 ? 0.35 : layerIndex < 4 ? 0.24 : 0.12
    const size = debugMode ? 0.18 + layerIndex * 0.01 : 0.09 + layerIndex * 0.004

    layerDefinitions.push({
      positions,
      colors,
      opacity,
      size,
      depth,
      layerIndex,
    })
  }

  return { layers: layerDefinitions, layerDepths }
}
