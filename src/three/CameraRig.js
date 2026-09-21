import * as THREE from 'three'

export function createCameraRig(camera, transitionState = {}) {
  camera.rotation.order = 'YXZ'

  return {
    update(time) {
      const ambientStrength = Number(transitionState.ambientStrength ?? 0)
      const currentDepth = transitionState.currentDepth ?? camera.position.z
      const baseYaw = Number(transitionState.currentYaw ?? transitionState.targetYaw ?? 0)
      const basePitch = Number(transitionState.currentPitch ?? transitionState.targetPitch ?? 0)
      const targetX = Number(transitionState.targetPositionX ?? 0)
      const targetY = Number(transitionState.targetPositionY ?? 0)
      const maxYaw = Number(transitionState.maxYaw ?? 0.0125)
      const maxPitch = Number(transitionState.maxPitch ?? 0.0022)
      const ambientYaw = Math.sin(time * Number(transitionState.ambientSpeed ?? 0.38)) * maxYaw * ambientStrength
      const ambientPitch = Math.sin(time * Number(transitionState.ambientPitchSpeed ?? 0.22) + 0.6) * maxPitch * ambientStrength

      camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, basePitch + ambientPitch, 0.05)
      camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, baseYaw + ambientYaw, 0.05)
      camera.rotation.z = 0

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.04)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.04)
      camera.position.z = currentDepth
    },
  }
}
