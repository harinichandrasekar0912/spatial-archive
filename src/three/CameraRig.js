import * as THREE from 'three'

export function createCameraRig(camera, transitionState = {}) {
  const driftTarget = new THREE.Vector3()

  return {
    update(time) {
      const driftX = Math.sin(time * 0.42) * (transitionState.isTransitioning ? 1.1 : 0.7)
      const driftY = Math.cos(time * 0.31) * (transitionState.isTransitioning ? 0.9 : 0.45)
      const currentDepth = transitionState.currentDepth ?? camera.position.z

      driftTarget.set(driftX, driftY, currentDepth)

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, driftTarget.x, 0.05)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, driftTarget.y, 0.05)
      camera.position.z = currentDepth

      camera.lookAt(0, 0, -1)
    },
  }
}
