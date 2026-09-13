export function buildDotField({ layers = 8, spread = 28, step = 1.25, debugMode = false } = {}) {
  const planeCount = Math.max(1, Math.min(layers, 8))
  const layerDepths = Array.from({ length: planeCount }, (_, layerIndex) => -(layerIndex + 1) * 10)
  const layerDefinitions = []

  for (let layerIndex = 0; layerIndex < layerDepths.length; layerIndex += 1) {
    const depth = layerDepths[layerIndex]
    const localSpread = spread + layerIndex * 2
    const positions = []
    const colors = []

    for (let x = -localSpread; x <= localSpread; x += step) {
      for (let y = -localSpread; y <= localSpread; y += step) {
        positions.push(x, y, 0)

        const baseColor = debugMode ? 0.16 + layerIndex * 0.02 : 0.62 + layerIndex * 0.008
        colors.push(baseColor, baseColor, baseColor)
      }
    }

    const opacityByLayer = [0.32, 0.28, 0.24, 0.2, 0.16, 0.12, 0.08, 0.05]
    const opacity = debugMode ? 0.8 - layerIndex * 0.08 : opacityByLayer[layerIndex] ?? 0.05
    const size = debugMode ? 0.18 + layerIndex * 0.01 : 0.06 + layerIndex * 0.003

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
