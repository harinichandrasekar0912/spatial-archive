import * as THREE from 'three'

export function createCameraRig(camera, transitionState = {}) {
  const desiredPosition = new THREE.Vector3(0, 0, 24)
  const easeInOutCubic = (value) => {
    if (value < 0.5) {
      return 4 * value * value * value
    }

    return 1 - Math.pow(-2 * value + 2, 3) / 2
  }

  return {
    desiredPosition,
    update(time) {
      const transitionProgress = transitionState.entryProgress || 0
      const easedProgress = easeInOutCubic(Math.min(transitionProgress, 1))

      desiredPosition.x = Math.sin(time * (transitionState.isTransitioning ? 0.5 : 0.28)) * (transitionState.isTransitioning ? 1.2 : 0.7)
      desiredPosition.y = Math.cos(time * (transitionState.isTransitioning ? 0.38 : 0.22)) * (transitionState.isTransitioning ? 0.8 : 0.45)
      desiredPosition.z = THREE.MathUtils.lerp(24, transitionState.reducedMotion ? 18 : 8, easedProgress)

      camera.position.lerp(desiredPosition, 0.03)
      camera.lookAt(0, 0, -10)
    },
  }
}
