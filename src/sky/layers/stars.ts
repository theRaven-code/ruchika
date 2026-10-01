import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three'
import type { StarCatalog } from '../data'
import { PROJECT_GLSL, projectionUniforms } from '../shaders'

const vertexShader = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
attribute float aPhase;
uniform float uLimMag;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uTime;
uniform float uTwinkle;
uniform float uExtinction;
uniform float uFade;
varying vec3 vColor;
varying float vIntensity;
varying float vHalo;
varying float vCoreRadius;
varying float vSize;
${PROJECT_GLSL}

void main() {
  vec3 world = normalize(mat3(modelMatrix) * position);
  float sinAlt = clamp(world.y, 0.0, 1.0);
  float mag = aMag;
  if (uExtinction > 0.0) {
    float airmass = 1.0 / (sinAlt + 0.025 * exp(-11.0 * sinAlt));
    mag += uExtinction * 0.2 * (min(airmass, 40.0) - 1.0);
  }
  float delta = uLimMag - mag;
  if (delta <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float flux = pow(10.0, 0.4 * min(delta, 9.5));
  float twinkle = 1.0 + uTwinkle * (0.1 + 0.4 * pow(1.0 - sinAlt, 4.0))
                * sin(uTime * (2.3 + 3.1 * aPhase) + aPhase * 43.0);
  // Sizes in device pixels: a point-like core that grows slowly with
  // brightness, and a soft halo only for the brighter stars.
  float scale = uSizeScale * uPixelRatio;
  vCoreRadius = (0.75 + 0.3 * pow(flux, 0.33)) * scale;
  vHalo = clamp((delta - 1.5) / 6.0, 0.0, 1.0);
  vSize = 2.0 * vCoreRadius * (1.6 + 3.0 * vHalo) + 2.0;
  vIntensity = clamp(0.4 + 0.16 * delta, 0.0, 1.0) * smoothstep(0.0, 0.6, delta) * twinkle * uFade;
  vColor = aColor;
  gl_PointSize = vSize;
  gl_Position = skyProject((modelViewMatrix * vec4(position, 1.0)).xyz);
}
`

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vIntensity;
varying float vHalo;
varying float vCoreRadius;
varying float vSize;

void main() {
  float r = length(gl_PointCoord - 0.5) * vSize;
  float edge = 1.0 - smoothstep(vSize * 0.42, vSize * 0.5, r);
  float core = exp(-1.6 * (r / vCoreRadius) * (r / vCoreRadius));
  float halo = exp(-2.2 * r / vCoreRadius) * 0.35 * vHalo;
  vec3 col = mix(vColor, vec3(1.0), core * 0.55) * (core + halo) * vIntensity * edge;
  gl_FragColor = vec4(col, 1.0);
}
`

/** B-V colour index to a gently saturated RGB tint (Ballesteros + blackbody fit). */
export function bvToRgb(bv: number): [number, number, number] {
  const b = Math.max(-0.4, Math.min(2.0, bv))
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const bl = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const rgb = [r, g, bl].map((v) => Math.max(0, Math.min(255, v)) / 255)
  const max = Math.max(...rgb)
  return rgb.map((v) => 0.45 + 0.55 * (v / max)) as [number, number, number]
}

export type StarMaterialUniforms = ReturnType<typeof starUniforms>

function starUniforms() {
  return {
    ...projectionUniforms(),
    uLimMag: { value: 6 },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 1 },
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uExtinction: { value: 1 },
    uFade: { value: 1 },
  }
}

export function createStarMaterial() {
  const uniforms = starUniforms()
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  return { material, uniforms }
}

export function createStars(catalog: StarCatalog) {
  const n = catalog.count
  const position = new Float32Array(n * 3)
  const color = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const cd = Math.cos(catalog.dec[i])
    position[i * 3] = cd * Math.cos(catalog.ra[i])
    position[i * 3 + 1] = cd * Math.sin(catalog.ra[i])
    position[i * 3 + 2] = Math.sin(catalog.dec[i])
    color.set(bvToRgb(catalog.bv[i]), i * 3)
    phase[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aMag', new BufferAttribute(new Float32Array(catalog.mag), 1))
  geometry.setAttribute('aColor', new BufferAttribute(color, 3))
  geometry.setAttribute('aPhase', new BufferAttribute(phase.map(Math.abs), 1))

  const { material, uniforms } = createStarMaterial()
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 50
  return { points, uniforms, positions: position }
}
