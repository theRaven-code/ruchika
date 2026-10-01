import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  Points,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import type { BodyState } from '../astro'
import { PROJECT_GLSL, type Uniforms } from '../shaders'
import { createStarMaterial } from './stars'

const billboardVertex = /* glsl */ `
attribute vec2 aCorner;
uniform vec3 uDir;
uniform vec3 uNorth;
uniform float uHalfSize;
uniform vec2 uViewport;
varying vec2 vUv;
${PROJECT_GLSL}

void main() {
  vec4 c = skyProject((viewMatrix * vec4(uDir, 0.0)).xyz);
  vec4 n = skyProject((viewMatrix * vec4(uNorth, 0.0)).xyz);
  if (c.z > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec2 halfViewport = uViewport * 0.5;
  vec2 up = (n.xy - c.xy) * halfViewport;
  up = length(up) > 1e-6 ? normalize(up) : vec2(0.0, 1.0);
  vec2 right = vec2(up.y, -up.x);
  vec2 s = c.xy * halfViewport + (right * aCorner.x + up * aCorner.y) * uHalfSize;
  vUv = aCorner;
  gl_Position = vec4(s / halfViewport, c.z, 1.0);
}
`

const sunFragment = /* glsl */ `
uniform float uDisc;
uniform float uGlow;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float disc = 1.0 - smoothstep(uDisc * 0.85, uDisc, r);
  float glow = (exp(-r * 7.0) * 0.55 + exp(-r * 22.0) * 0.6) * uGlow;
  vec3 col = vec3(1.0, 0.97, 0.9) * disc + vec3(1.0, 0.82, 0.6) * glow;
  gl_FragColor = vec4(col * (1.0 - smoothstep(0.85, 1.0, r)), 1.0);
}
`

// The photo is oriented with lunar north up and the western limb on the right,
// matching the billboard axes (up = celestial north, right = west).
const moonFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunLocal;
uniform float uDisc;
uniform float uGlow;
uniform float uBrightness;
varying vec2 vUv;
void main() {
  vec2 p = vUv / uDisc;
  float r2 = dot(p, p);
  vec3 col = vec3(0.0);
  if (r2 < 1.0) {
    vec3 normal = vec3(p, sqrt(1.0 - r2));
    float lit = smoothstep(-0.06, 0.1, dot(normal, uSunLocal));
    vec3 albedo = texture2D(uMap, p * 0.5 + 0.5).rgb;
    float edge = 1.0 - smoothstep(0.96, 1.0, sqrt(r2));
    col = albedo * (lit * 1.0 + 0.03) * edge * uBrightness;
  }
  float r = length(vUv);
  col += vec3(0.55, 0.62, 0.75) * exp(-r * 6.0) * uGlow * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(col, 1.0);
}
`

function quadGeometry() {
  const geometry = new BufferGeometry()
  const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  geometry.setAttribute('aCorner', new BufferAttribute(corners, 2))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return geometry
}

function billboard<T extends Uniforms>(fragmentShader: string, extra: T, shared: Uniforms, renderOrder: number) {
  const uniforms = {
    ...shared,
    ...extra,
    uDir: { value: new Vector3(0, 1, 0) },
    uNorth: { value: new Vector3(0, 1, 0) },
    uHalfSize: { value: 10 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: billboardVertex,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(quadGeometry(), material)
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return { mesh, uniforms }
}

export const PLANET_COLORS: Record<string, [number, number, number]> = {
  Mercury: [0.92, 0.86, 0.8],
  Venus: [1, 0.97, 0.88],
  Mars: [1, 0.62, 0.42],
  Jupiter: [1, 0.94, 0.84],
  Saturn: [1, 0.9, 0.7],
}

export function createBodies(moonMap: Texture, shared: Uniforms & { uViewport: { value: Vector2 } }) {
  const sun = billboard(sunFragment, { uDisc: { value: 0.1 }, uGlow: { value: 1 } }, shared, 60)
  const moon = billboard(
    moonFragment,
    {
      uMap: { value: moonMap },
      uSunLocal: { value: new Vector3(0, 0, 1) },
      uDisc: { value: 0.6 },
      uGlow: { value: 0.3 },
      uBrightness: { value: 1 },
    },
    shared,
    61,
  )

  const planetNames = Object.keys(PLANET_COLORS)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(planetNames.length * 3), 3))
  geometry.setAttribute('aMag', new BufferAttribute(new Float32Array(planetNames.length), 1))
  geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(planetNames.flatMap((p) => PLANET_COLORS[p])), 3))
  geometry.setAttribute('aPhase', new BufferAttribute(new Float32Array(planetNames.length), 1))
  const planetMaterial = createStarMaterial()
  const planets = new Points(geometry, planetMaterial.material)
  planets.frustumCulled = false
  planets.renderOrder = 55

  const north = new Vector3()
  const west = new Vector3()

  /** Updates billboards and planet points. `ncp` is the celestial pole in world space. */
  function update(bodies: BodyState[], ncp: Vector3, pxPerRadian: number, pixelRatio: number) {
    const sunState = bodies.find((b) => b.id === 'Sun')!
    const moonState = bodies.find((b) => b.id === 'Moon')!

    for (const [state, target, minRadius, glowPx] of [
      [sunState, sun, 3.5, 70],
      [moonState, moon, 4, 26],
    ] as const) {
      const f = state.world
      north.copy(ncp).addScaledVector(f, -f.dot(ncp)).normalize()
      const disc = Math.max(state.radius * pxPerRadian, minRadius * pixelRatio)
      const half = disc + glowPx * pixelRatio
      target.uniforms.uDir.value.copy(f)
      target.uniforms.uNorth.value.copy(f).addScaledVector(north, 0.01).normalize()
      target.uniforms.uHalfSize.value = half
      ;(target.uniforms as Uniforms).uDisc.value = disc / half
    }

    // Disc frame for the Moon: x = west, y = north, z = towards the observer.
    const f = moonState.world
    north.copy(ncp).addScaledVector(f, -f.dot(ncp)).normalize()
    west.crossVectors(f, north)
    const s = sunState.world
    moon.uniforms.uSunLocal.value.set(s.dot(west), s.dot(north), -s.dot(f))

    const pos = geometry.getAttribute('position') as BufferAttribute
    const mag = geometry.getAttribute('aMag') as BufferAttribute
    planetNames.forEach((name, i) => {
      const state = bodies.find((b) => b.id === name)!
      pos.setXYZ(i, state.eqj.x, state.eqj.y, state.eqj.z)
      mag.setX(i, state.mag)
    })
    pos.needsUpdate = true
    mag.needsUpdate = true
  }

  return { sun, moon, planets, planetUniforms: planetMaterial.uniforms, update }
}
