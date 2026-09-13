import * as THREE from 'three'

export function createCameraRig(camera, transitionState = {}) {
  camera.rotation.order = 'YXZ'

  return {
    update(time) {
      const ambientStrength = Number(transitionState.ambientStrength ?? 0)
      const currentDepth = transitionState.currentDepth ?? camera.position.z
      const targetYaw = Number(transitionState.targetYaw ?? 0)
      const targetPitch = Number(transitionState.targetPitch ?? 0)
      const maxYaw = Number(transitionState.maxYaw ?? 0.012)
      const maxPitch = Number(transitionState.maxPitch ?? 0.002)
      const ambientYaw = Math.sin(time * Number(transitionState.ambientSpeed ?? 0.38)) * maxYaw * ambientStrength
      const ambientPitch = Math.sin(time * Number(transitionState.ambientPitchSpeed ?? 0.22) + 0.6) * maxPitch * ambientStrength

      camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, targetPitch + ambientPitch, 0.05)
      camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, targetYaw + ambientYaw, 0.05)
      camera.rotation.z = 0

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0, 0.04)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0, 0.04)
      camera.position.z = currentDepth
    },
  }
}
