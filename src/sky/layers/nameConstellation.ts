import { BufferAttribute, BufferGeometry, Points, Vector3 } from 'three'
import { layoutName } from '../nameGlyphs'
import { arcSegments, createLines } from './lines'
import { bvToRgb, createStarMaterial } from './stars'

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

/** The name drawn as an asterism: star points joined by soft starlight lines. */
export function createNameConstellation(text: string, frame: SkyFrame) {
  const layout = layoutName(text)
  const n = layout.stars.length
  const position = new Float32Array(n * 3)
  const color = new Float32Array(n * 3)
  const mag = new Float32Array(n)
  const phase = new Float32Array(n)
  const points3d = layout.stars.map((s, i) => {
    const p = framePoint(frame, s.x, s.y)
    position.set([p.x, p.y, p.z], i * 3)
    color.set(bvToRgb(s.bv), i * 3)
    mag[i] = s.mag
    phase[i] = (i * 0.618) % 1
    return p
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aMag', new BufferAttribute(mag, 1))
  geometry.setAttribute('aColor', new BufferAttribute(color, 3))
  geometry.setAttribute('aPhase', new BufferAttribute(phase, 1))
  const starMaterial = createStarMaterial()
  const stars = new Points(geometry, starMaterial.material)
  stars.frustumCulled = false
  stars.renderOrder = 52

  // Trace order follows the writing order, so the reveal runs letter by letter.
  const total = layout.paths.reduce((sum, path) => {
    for (let i = 0; i < path.length - 1; i++) sum += points3d[path[i]].angleTo(points3d[path[i + 1]])
    return sum
  }, 0)
  const segments: number[] = []
  const order: number[] = []
  let travelled = 0
  for (const path of layout.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = points3d[path[i]]
      const b = points3d[path[i + 1]]
      const before = segments.length / 6
      arcSegments(a, b, (0.6 * Math.PI) / 180, segments)
      const pieces = segments.length / 6 - before
      const length = a.angleTo(b)
      for (let k = 0; k < pieces; k++) order.push((travelled + (length * k) / pieces) / total)
      travelled += length
    }
  }
  const lines = createLines(segments, { color: '#c9d8ff', opacity: 0.42, width: 1.3 }, 33, order)

  return { stars, starUniforms: starMaterial.uniforms, lines, layout }
}
