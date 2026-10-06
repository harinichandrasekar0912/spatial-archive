import * as THREE from 'three'
import { THEME, WORKSPACE } from '../app/constants.js'

/*
 * Card shaders. Cards are drawn inside the same WebGL scene as the dot lattice:
 *   - they write depth, so dots behind a card are hidden and dots in front of it stay visible;
 *   - they fade towards the background colour with distance (atmospheric depth), so deeper
 *     layers read as quieter rather than merely smaller;
 *   - uPresence fades the whole workspace in and out during view transitions.
 */

// Shared by every card material (uniform objects are shared, not copied).
export const sharedUniforms = {
  // Deeper cards recede into the dark of the space.
  uFogColor: { value: new THREE.Color(THEME.background) },
  uFogNear: { value: WORKSPACE.fogNear },
  uFogFar: { value: WORKSPACE.fogFar },
  uPresence: { value: 1 },
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vDistance;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDistance = length(mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fogChunk = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uPresence;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDistance;

  float fogAmount() {
    return smoothstep(uFogNear, uFogFar, vDistance) * 0.85;
  }
`

const cardFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uSize;
  uniform float uRadius;
  ${fogChunk}

  // Signed distance to a rounded rectangle, in workspace pixels.
  float roundedBox(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    float edgeDistance = roundedBox((vUv - 0.5) * uSize, uSize * 0.5, uRadius);
    float pixel = fwidth(edgeDistance);
    float shape = 1.0 - smoothstep(-pixel, pixel, edgeDistance);
    float alpha = shape * uOpacity * uPresence;

    if (alpha < 0.002) discard;

    vec3 color = mix(texture2D(uMap, vUv).rgb, uFogColor, fogAmount());
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

const shadowFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  ${fogChunk}

  void main() {
    float alpha = texture2D(uMap, vUv).a * uOpacity * uPresence * (1.0 - fogAmount());

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(vec3(0.0), alpha);
    #include <colorspace_fragment>
  }
`

const captionFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  ${fogChunk}

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    float alpha = texel.a * uOpacity * uPresence;

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(mix(texel.rgb, uFogColor, fogAmount()), alpha);
    #include <colorspace_fragment>
  }
`

// Thin edge for turned panels, so a card seen nearly edge-on never vanishes.
const outlineFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  ${fogChunk}

  void main() {
    float alpha = uOpacity * uPresence * (1.0 - fogAmount());

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

function material(fragmentShader, uniforms, { depthWrite }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms, uOpacity: { value: 1 }, ...uniforms },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite,
  })
}

export function createCardMaterial(map, { width, height, radius }) {
  return material(
    cardFragmentShader,
    { uMap: { value: map }, uSize: { value: new THREE.Vector2(width, height) }, uRadius: { value: radius } },
    { depthWrite: true },
  )
}

export function createShadowMaterial(map) {
  return material(shadowFragmentShader, { uMap: { value: map } }, { depthWrite: false })
}

export function createCaptionMaterial(map) {
  return material(captionFragmentShader, { uMap: { value: map } }, { depthWrite: false })
}

export function createOutlineMaterial() {
  return material(outlineFragmentShader, { uColor: { value: new THREE.Color(THEME.ink) } }, { depthWrite: false })
}
