import * as THREE from 'three'

/*
 * Screen-space dust: a particle overlay drawn by the app's one WebGL renderer, after the 3D
 * scene, from the same frame loop. Transitions turn text, panels and the workspace itself into
 * dust (see app/dustEffects.js); this layer only draws particles where they are told to be.
 *
 * Particles are written in CSS pixels (x right, y down) with an sRGB colour, an alpha and a
 * size, and are drawn as soft round points.
 */

const vertexShader = /* glsl */ `
  attribute vec4 tint;
  attribute float size;
  attribute float glow;
  uniform float uPixelRatio;
  varying vec4 vTint;
  varying float vSize;
  varying float vGlow;

  void main() {
    vTint = tint;
    vGlow = glow;
    vSize = size * uPixelRatio;
    gl_PointSize = max(vSize, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Colours arrive in sRGB and are written as they are (no colour-space conversion).
// Grains are crisp discs; glow particles (glow = 1) fall off softly from their centre.
const fragmentShader = /* glsl */ `
  varying vec4 vTint;
  varying float vSize;
  varying float vGlow;

  void main() {
    float alpha = vTint.a;

    if (vSize > 2.0) {
      float radius = length(gl_PointCoord - 0.5) * 2.0;
      float edge = 1.0 - smoothstep(1.0 - 2.4 / vSize, 1.0, radius);
      float soft = exp(-radius * radius * 4.5) * (1.0 - smoothstep(0.8, 1.0, radius));
      alpha *= mix(edge, soft, vGlow);
    }

    if (alpha < 0.003) discard;

    gl_FragColor = vec4(vTint.rgb, alpha);
  }
`

export function createDustLayer(spatial) {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10)
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.BufferGeometry()
  // Positions change every frame; a fixed bound stops three measuring a half-written buffer.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  scene.add(points)

  let capacity = 0
  let count = 0
  let active = false
  let buffers = null

  function allocate(size) {
    capacity = Math.max(size, Math.ceil(capacity * 1.5), 1024)
    buffers = {
      position: new Float32Array(capacity * 3),
      tint: new Float32Array(capacity * 4),
      size: new Float32Array(capacity),
      glow: new Float32Array(capacity),
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('tint', new THREE.BufferAttribute(buffers.tint, 4).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('size', new THREE.BufferAttribute(buffers.size, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('glow', new THREE.BufferAttribute(buffers.glow, 1).setUsage(THREE.DynamicDrawUsage))
  }

  const layer = {
    /*
     * Starts drawing `particleCount` particles and returns the arrays to write each frame:
     * position (x, y, 0 per particle, CSS px), tint (r, g, b, a in 0–1), size (CSS px),
     * glow (0 = a crisp grain, 1 = a soft light).
     * blending: 'normal' for falling dust, 'additive' for light (swirl, burst).
     */
    begin(particleCount, { blending = 'normal' } = {}) {
      if (particleCount > capacity) {
        allocate(particleCount)
      }

      count = particleCount
      active = count > 0
      material.blending = blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
      geometry.setDrawRange(0, count)
      return buffers
    },

    setBlending(blending) {
      material.blending = blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
    },

    // Call after writing the arrays for a frame.
    commit() {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.tint.needsUpdate = true
      geometry.attributes.size.needsUpdate = true
      geometry.attributes.glow.needsUpdate = true
    },

    end() {
      active = false
      count = 0
      geometry.setDrawRange(0, 0)
    },

    isActive: () => active,

    // Compiles the dust shader ahead of its first use.
    warm(renderer) {
      return renderer.compileAsync(scene, camera)
    },

    // One invisible draw (after warmEffects has filled the buffers), so the first real frame
    // does not pay for uploading them.
    drawInvisibly(renderer) {
      const wasActive = active
      geometry.setDrawRange(0, capacity)
      layer.commit()
      renderer.autoClear = false
      layer.render(renderer)
      renderer.autoClear = true
      geometry.setDrawRange(0, count)
      active = wasActive
    },

    // Drawn by SpatialScene after the 3D scene (never clears the frame).
    render(renderer) {
      const { width, height } = spatial.viewport
      // y grows downwards, as on screen.
      camera.left = 0
      camera.right = width
      camera.top = 0
      camera.bottom = height
      camera.updateProjectionMatrix()
      material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
      renderer.render(scene, camera)
    },
  }

  spatial.addOverlay(layer)
  return layer
}
