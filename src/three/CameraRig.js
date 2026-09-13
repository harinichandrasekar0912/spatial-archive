import * as THREE from 'three'

export function createCameraRig(camera, transitionState = {}) {
  const driftTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()

  return {
    update(time) {
      const driftX = Math.sin(time * 0.24) * (transitionState.isTransitioning ? 1.2 : 0.6)
      const driftY = Math.cos(time * 0.18) * (transitionState.isTransitioning ? 1.0 : 0.45)
      const currentDepth = transitionState.currentDepth ?? camera.position.z

      driftTarget.set(driftX, driftY, currentDepth)
      lookTarget.set(driftX * 0.45, driftY * 0.35, currentDepth - 24)

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, driftTarget.x, 0.04)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, driftTarget.y, 0.04)
      camera.position.z = currentDepth

      camera.lookAt(lookTarget)
    },
  }
}
