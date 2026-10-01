import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
  type Vector3,
} from 'three'
import { PROJECT_GLSL, projectionUniforms } from '../shaders'

const vertexShader = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec4 aTiming;
attribute vec3 aColor;
attribute vec2 aCorner;
uniform float uTime;
uniform vec2 uViewport;
uniform float uPixelRatio;
varying float vAlong;
varying float vSide;
varying vec3 vColor;
varying float vAlpha;
${PROJECT_GLSL}

void main() {
  // aTiming: birth (s), duration (s), trail length (fraction of path), brightness.
  float p = (uTime - aTiming.x) / aTiming.y;
  if (p < 0.0 || p > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float headT = 1.0 - pow(1.0 - p, 1.4);
  float tailT = max(0.0, headT - aTiming.z * smoothstep(0.0, 0.35, p));
  vec4 head = skyProject((viewMatrix * vec4(normalize(mix(aFrom, aTo, headT)), 0.0)).xyz);
  vec4 tail = skyProject((viewMatrix * vec4(normalize(mix(aFrom, aTo, tailT)), 0.0)).xyz);
  if (head.z > 1.0 || tail.z > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec2 halfViewport = uViewport * 0.5;
  vec2 sh = head.xy * halfViewport;
  vec2 st = tail.xy * halfViewport;
  vec2 dir = sh - st;
  float len = length(dir);
  dir = len > 1e-3 ? dir / len : vec2(0.0, -1.0);
  float width = (1.2 + 2.0 * aTiming.w) * uPixelRatio;
  float halfWidth = width * mix(0.12, 1.0, aCorner.x) + uPixelRatio;
  vec2 s = mix(st, sh, aCorner.x) + vec2(-dir.y, dir.x) * aCorner.y * halfWidth + dir * aCorner.x * width;
  vAlong = aCorner.x;
  vSide = aCorner.y;
  vColor = aColor;
  vAlpha = aTiming.w * smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.7, 1.0, p));
  gl_Position = vec4(s / halfViewport, head.z, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform float uVisibility;
varying float vAlong;
varying float vSide;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float across = 1.0 - abs(vSide);
  float core = across * across * across;
  float trail = pow(vAlong, 2.0);
  // The head burns white-hot; the train keeps the meteor's tint.
  float head = pow(vAlong, 6.0);
  vec3 col = mix(vColor, vec3(1.0), head * core) * (1.0 + 1.2 * head);
  gl_FragColor = vec4(col * core * trail * vAlpha * uVisibility * 1.3, 1.0);
}
`

export type MeteorOptions = {
  birth: number
  duration: number
  trail: number
  brightness: number
  color: [number, number, number]
}

const POOL = 16

/** A small ring buffer of shooting stars, drawn in the horizon (world) frame. */
export function createMeteors() {
  const from = new Float32Array(POOL * 4 * 3)
  const to = new Float32Array(POOL * 4 * 3)
  const timing = new Float32Array(POOL * 4 * 4).fill(-1000)
  const color = new Float32Array(POOL * 4 * 3)
  const corner = new Float32Array(POOL * 4 * 2)
  const index: number[] = []
  const corners = [0, -1, 0, 1, 1, -1, 1, 1]
  for (let m = 0; m < POOL; m++) {
    corner.set(corners, m * 8)
    index.push(m * 4, m * 4 + 1, m * 4 + 2, m * 4 + 2, m * 4 + 1, m * 4 + 3)
  }
  const geometry = new BufferGeometry()
  const attrs = {
    aFrom: new BufferAttribute(from, 3),
    aTo: new BufferAttribute(to, 3),
    aTiming: new BufferAttribute(timing, 4),
    aColor: new BufferAttribute(color, 3),
  }
  Object.entries(attrs).forEach(([name, attr]) => geometry.setAttribute(name, attr))
  geometry.setAttribute('aCorner', new BufferAttribute(corner, 2))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(POOL * 4 * 3), 3))
  geometry.setIndex(index)

  const uniforms = {
    ...projectionUniforms(),
    uTime: { value: 0 },
    uViewport: { value: new Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uVisibility: { value: 1 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 58

  let next = 0
  function spawn(start: Vector3, end: Vector3, options: MeteorOptions) {
    const slot = next
    next = (next + 1) % POOL
    for (let v = 0; v < 4; v++) {
      const k = slot * 4 + v
      from.set([start.x, start.y, start.z], k * 3)
      to.set([end.x, end.y, end.z], k * 3)
      timing.set([options.birth, options.duration, options.trail, options.brightness], k * 4)
      color.set(options.color, k * 3)
    }
    Object.values(attrs).forEach((attr) => (attr.needsUpdate = true))
  }

  return { mesh, uniforms, spawn }
}
