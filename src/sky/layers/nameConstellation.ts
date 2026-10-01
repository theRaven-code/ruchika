import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three'
import { layoutName } from '../nameGlyphs'
import { PROJECT_GLSL, projectionUniforms } from '../shaders'
import { arcSegments, createLines } from './lines'
import { bvToRgb } from './stars'

/** A patch of sky (J2000 frame) where glyph coordinates are laid out. */
export type SkyFrame = {
  center: Vector3
  right: Vector3
  up: Vector3
  /** Radians per glyph unit. */
  unit: number
}

export function framePoint(frame: SkyFrame, x: number, y: number, out = new Vector3()) {
  return out
    .copy(frame.center)
    .addScaledVector(frame.right, x * frame.unit)
    .addScaledVector(frame.up, y * frame.unit)
    .normalize()
}

const sparkleVertex = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
attribute float aPhase;
attribute float aOrder;
uniform float uLimMag;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uTime;
uniform float uFade;
uniform float uWave;
uniform float uWaveStrength;
uniform float uMaxPointSize;
varying vec3 vColor;
varying float vIntensity;
varying float vCore;
varying float vSize;
varying float vSpike;
${PROJECT_GLSL}

void main() {
  float delta = uLimMag - aMag;
  if (delta <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float flux = pow(10.0, 0.4 * min(delta, 9.5));
  // Rare, sharp glints: the peaks of a slow per-star sine.
  float glint = pow(max(0.0, sin(uTime * (0.5 + 0.7 * aPhase) + aPhase * 37.0)), 30.0);
  // A wave of light that runs through the stars in writing order.
  float w = (uWave - aOrder) * 7.0;
  float wave = uWaveStrength * exp(-w * w);
  float flare = clamp(max(glint * 0.9, wave), 0.0, 1.6);

  float scale = uSizeScale * uPixelRatio;
  vCore = (0.8 + 0.3 * pow(flux, 0.33)) * scale * (1.0 + 0.45 * flare);
  vSpike = 0.3 + 0.9 * flare;
  vSize = min(vCore * (7.0 + 9.0 * flare) + 2.0, uMaxPointSize);
  vIntensity = clamp(0.5 + 0.15 * delta, 0.0, 1.0) * smoothstep(0.0, 0.6, delta) * uFade * (1.0 + 0.7 * flare);
  vColor = aColor;
  gl_PointSize = vSize;
  gl_Position = skyProject((modelViewMatrix * vec4(position, 1.0)).xyz);
}
`

const sparkleFragment = /* glsl */ `
varying vec3 vColor;
varying float vIntensity;
varying float vCore;
varying float vSize;
varying float vSpike;

void main() {
  vec2 c = (gl_PointCoord - 0.5) * vSize;
  float r = length(c);
  float core = exp(-1.6 * (r / vCore) * (r / vCore));
  float halo = exp(-2.0 * r / vCore) * 0.35;
  // Four-point diffraction spikes, thin along the axes.
  float spikeX = exp(-abs(c.y) / (0.3 * vCore)) * exp(-abs(c.x) / (2.4 * vCore));
  float spikeY = exp(-abs(c.x) / (0.3 * vCore)) * exp(-abs(c.y) / (2.4 * vCore));
  float spikes = (spikeX + spikeY) * vSpike * 0.7;
  float edge = 1.0 - smoothstep(vSize * 0.4, vSize * 0.5, r);
  vec3 col = mix(vColor, vec3(1.0), core * 0.6) * (core + halo + spikes) * vIntensity * edge;
  gl_FragColor = vec4(col, 1.0);
}
`

/** The name drawn as an asterism: sparkling stars joined by soft starlight lines. */
export function createNameConstellation(text: string, frame: SkyFrame) {
  const layout = layoutName(text)
  const n = layout.stars.length
  const points3d = layout.stars.map((s) => framePoint(frame, s.x, s.y))

  // Trace order follows the writing order, so reveals and waves run letter by letter.
  const total = layout.paths.reduce((sum, path) => {
    for (let i = 0; i < path.length - 1; i++) sum += points3d[path[i]].angleTo(points3d[path[i + 1]])
    return sum
  }, 0)
  const starOrder = new Float32Array(n).fill(-1)
  const segments: number[] = []
  const order: number[] = []
  let travelled = 0
  for (const path of layout.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = points3d[path[i]]
      const b = points3d[path[i + 1]]
      if (starOrder[path[i]] < 0) starOrder[path[i]] = travelled / total
      const before = segments.length / 6
      arcSegments(a, b, (0.6 * Math.PI) / 180, segments)
      const pieces = segments.length / 6 - before
      const length = a.angleTo(b)
      for (let k = 0; k < pieces; k++) order.push((travelled + (length * k) / pieces) / total)
      travelled += length
      if (starOrder[path[i + 1]] < 0) starOrder[path[i + 1]] = travelled / total
    }
  }
  const lines = createLines(segments, { color: '#c9d8ff', opacity: 0.42, width: 1.3 }, 33, order)

  const position = new Float32Array(n * 3)
  const color = new Float32Array(n * 3)
  const mag = new Float32Array(n)
  const phase = new Float32Array(n)
  points3d.forEach((p, i) => {
    position.set([p.x, p.y, p.z], i * 3)
    color.set(bvToRgb(layout.stars[i].bv), i * 3)
    mag[i] = layout.stars[i].mag
    phase[i] = (i * 0.618034) % 1
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aMag', new BufferAttribute(mag, 1))
  geometry.setAttribute('aColor', new BufferAttribute(color, 3))
  geometry.setAttribute('aPhase', new BufferAttribute(phase, 1))
  geometry.setAttribute('aOrder', new BufferAttribute(starOrder.map((o) => Math.max(0, o)), 1))

  const starUniforms = {
    ...projectionUniforms(),
    uLimMag: { value: 6 },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 1 },
    uTime: { value: 0 },
    uFade: { value: 0 },
    uWave: { value: -10 },
    uWaveStrength: { value: 0 },
    uMaxPointSize: { value: 64 },
  }
  const material = new ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: sparkleVertex,
    fragmentShader: sparkleFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const stars = new Points(geometry, material)
  stars.frustumCulled = false
  stars.renderOrder = 52

  return { stars, starUniforms, lines, layout }
}
