import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Matrix3,
  Mesh,
  ShaderMaterial,
  TextureLoader,
  Vector3,
} from 'three'
import type { Constellation } from '../data'
import { skyAsset } from '../data'
import { PROJECT_GLSL, type Uniforms } from '../shaders'
import { arcSegments, createLines } from './lines'

const artVertex = /* glsl */ `
varying vec2 vUv;
${PROJECT_GLSL}
void main() {
  vUv = uv;
  gl_Position = skyProject((modelViewMatrix * vec4(position, 1.0)).xyz);
}
`

const artFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float v = texture2D(uMap, vUv).r;
  gl_FragColor = vec4(uTint * v * uOpacity, 1.0);
}
`

const ART_GRID = 14

/**
 * Builds a tessellated patch on the celestial sphere for one illustration.
 * The three anchors define M with M·(u, v, 1) = star direction, i.e. the image
 * is placed on the plane through the anchor stars and projected onto the sphere.
 */
function artGeometry(c: Constellation, starVector: (hip: number) => Vector3 | null) {
  const image = c.image!
  const [w, h] = image.size
  const anchors = image.anchors.map((a) => ({ u: a.pos[0] / w, v: a.pos[1] / h, s: starVector(a.hip) }))
  if (anchors.length !== 3 || anchors.some((a) => !a.s)) return null
  const [a, b, d] = anchors as { u: number; v: number; s: Vector3 }[]
  const p = new Matrix3().set(a.u, b.u, d.u, a.v, b.v, d.v, 1, 1, 1)
  if (Math.abs(p.determinant()) < 1e-9) return null
  const m = new Matrix3().set(a.s.x, b.s.x, d.s.x, a.s.y, b.s.y, d.s.y, a.s.z, b.s.z, d.s.z).multiply(p.invert())

  const n = ART_GRID + 1
  const position = new Float32Array(n * n * 3)
  const uv = new Float32Array(n * n * 2)
  const index: number[] = []
  const v = new Vector3()
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      v.set(i / ART_GRID, j / ART_GRID, 1).applyMatrix3(m).normalize()
      position.set([v.x, v.y, v.z], k * 3)
      uv.set([i / ART_GRID, 1 - j / ART_GRID], k * 2)
      if (i < ART_GRID && j < ART_GRID) index.push(k, k + n, k + 1, k + 1, k + n, k + n + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setIndex(index)
  return geometry
}

export type ConstellationLabel = { id: string; name: string; english: string; center: Vector3 }

export function createConstellations(
  constellations: Constellation[],
  starVector: (hip: number) => Vector3 | null,
  sharedProjection: Uniforms,
) {
  const segments: number[] = []
  const labels: ConstellationLabel[] = []
  for (const c of constellations) {
    const unique = new Set<number>()
    for (const line of c.lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = starVector(line[i])
        const b = starVector(line[i + 1])
        if (a && b) arcSegments(a, b, (1.5 * Math.PI) / 180, segments)
      }
      line.forEach((hip) => unique.add(hip))
    }
    const center = new Vector3()
    unique.forEach((hip) => {
      const s = starVector(hip)
      if (s) center.add(s)
    })
    if (center.lengthSq() > 0) labels.push({ id: c.id, name: c.name, english: c.english, center: center.normalize() })
  }

  const lines = createLines(segments, { color: '#4a7cc4', opacity: 0.6, width: 1.25 }, 31)

  const art = new Group()
  const artUniforms = {
    uTint: { value: new Color().setStyle('#c9d6ff', LinearSRGBColorSpace) },
    uOpacity: { value: 0.42 },
  }
  let artLoaded = false

  function loadArt() {
    if (artLoaded) return
    artLoaded = true
    const loader = new TextureLoader()
    for (const c of constellations) {
      if (!c.image) continue
      const geometry = artGeometry(c, starVector)
      if (!geometry) continue
      loader.load(skyAsset(`art/${c.image.file}`), (texture) => {
        texture.anisotropy = 4
        const material = new ShaderMaterial({
          uniforms: { ...sharedProjection, ...artUniforms, uMap: { value: texture } },
          vertexShader: artVertex,
          fragmentShader: artFragment,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        })
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        mesh.renderOrder = 30
        art.add(mesh)
      })
    }
  }

  return { lines, art, artUniforms, loadArt, labels }
}
