export function buildDotField({ layers = 8, spread = 60, step = 1.25, debugMode = false } = {}) {
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

        const baseColor = debugMode ? 0.4 : 0.62 + layerIndex * 0.008
        colors.push(baseColor, baseColor, baseColor)
      }
    }

    const opacityByLayer = [0.5, 0.44, 0.38, 0.32, 0.26, 0.2, 0.14, 0.1]
    const opacity = debugMode ? 0.8 : opacityByLayer[layerIndex] ?? 0.1
    const size = debugMode ? 0.14 : 0.06 + layerIndex * 0.003

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
