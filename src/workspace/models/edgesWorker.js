import { featureEdgePositions } from './edges.js'

// The white model's edge lines, worked out away from the page so loading a model never stalls
// an animation. Message: { id, jobs: [{ position, index }], thresholdDeg }.
self.onmessage = ({ data: { id, jobs, thresholdDeg } }) => {
  const results = jobs.map(({ position, index }) => featureEdgePositions(position, index, thresholdDeg))
  self.postMessage({ id, results }, results.map((result) => result.buffer))
}
