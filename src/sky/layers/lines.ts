import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { PROJECT_GLSL, projectionUniforms } from '../shaders'

const vertexShader = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aCorner;
attribute float aOrder;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uReveal;
varying float vEdge;
varying float vReveal;
${PROJECT_GLSL}

void main() {
  vReveal = clamp((uReveal - aOrder) * 25.0, 0.0, 1.0);
  vec4 a = skyProject((modelViewMatrix * vec4(aStart, 1.0)).xyz);
  vec4 b = skyProject((modelViewMatrix * vec4(aEnd, 1.0)).xyz);
  if (a.z > 1.0 || b.z > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec2 halfViewport = uViewport * 0.5;
  vec2 sa = a.xy * halfViewport;
  vec2 sb = b.xy * halfViewport;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  float halfWidth = uWidth * 0.5 + 1.0;
  vec2 s = mix(sa, sb, aCorner.x) + vec2(-dir.y, dir.x) * aCorner.y * halfWidth;
  vEdge = aCorner.y * halfWidth;
  gl_Position = vec4(s / halfViewport, mix(a.z, b.z, aCorner.x), 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uWidth;
varying float vEdge;
varying float vReveal;

void main() {
  float coverage = clamp(uWidth * 0.5 + 0.5 - abs(vEdge), 0.0, 1.0);
  gl_FragColor = vec4(uColor, coverage * uOpacity * vReveal);
}
`

/** Splits the great-circle arc a->b into pieces no longer than maxStep radians. */
export function arcSegments(a: Vector3, b: Vector3, maxStep: number, out: number[]) {
  const angle = a.angleTo(b)
  const steps = Math.max(1, Math.ceil(angle / maxStep))
  const sin = Math.sin(angle)
  let prev = a
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const next =
      sin < 1e-6
        ? b
        : a
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle) / sin)
            .add(b.clone().multiplyScalar(Math.sin(t * angle) / sin))
    out.push(prev.x, prev.y, prev.z, next.x, next.y, next.z)
    prev = next
  }
}

export function polylineSegments(points: Vector3[], closed: boolean, out: number[]) {
  for (let i = 0; i < points.length - 1; i++) out.push(...points[i].toArray(), ...points[i + 1].toArray())
  if (closed && points.length > 2) out.push(...points.at(-1)!.toArray(), ...points[0].toArray())
}

export type LineStyle = { color: string; opacity: number; width: number }

/**
 * `order` (0..1 per segment) lets a figure be traced in over time by raising
 * the uReveal uniform from 0 to 1.
 */
export function createLines(segments: number[], style: LineStyle, renderOrder: number, order?: number[]) {
  const count = segments.length / 6
  const start = new Float32Array(count * 12)
  const end = new Float32Array(count * 12)
  const corner = new Float32Array(count * 8)
  const orderAttr = new Float32Array(count * 4)
  const index = new Uint32Array(count * 6)
  const corners = [0, -1, 0, 1, 1, -1, 1, 1]
  for (let s = 0; s < count; s++) {
    for (let v = 0; v < 4; v++) {
      const k = s * 4 + v
      start.set(segments.slice(s * 6, s * 6 + 3), k * 3)
      end.set(segments.slice(s * 6 + 3, s * 6 + 6), k * 3)
      corner[k * 2] = corners[v * 2]
      corner[k * 2 + 1] = corners[v * 2 + 1]
      orderAttr[k] = order?.[s] ?? 0
    }
    index.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('aStart', new BufferAttribute(start, 3))
  geometry.setAttribute('aEnd', new BufferAttribute(end, 3))
  geometry.setAttribute('aCorner', new BufferAttribute(corner, 2))
  geometry.setAttribute('aOrder', new BufferAttribute(orderAttr, 1))
  // three.js needs a position attribute to size draw calls.
  geometry.setAttribute('position', new BufferAttribute(start, 3))
  geometry.setIndex(new BufferAttribute(index, 1))

  const uniforms = {
    ...projectionUniforms(),
    uViewport: { value: new Vector2(1, 1) },
    uWidth: { value: style.width },
    // Shaders work in display (sRGB) values, so skip three's colour conversion.
    uColor: { value: new Color().setStyle(style.color, LinearSRGBColorSpace) },
    uOpacity: { value: style.opacity },
    uReveal: { value: 2 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return { mesh, uniforms, baseWidth: style.width }
}
