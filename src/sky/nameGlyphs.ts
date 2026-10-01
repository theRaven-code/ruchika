type Glyph = {
  width: number
  /** Star positions on a grid 6 units tall, y up. */
  stars: [number, number][]
  /** Stick-figure lines as paths through star indices. */
  paths: number[][]
}

const O_STARS: [number, number][] = [
  [1.7, 6], [0.3, 4.9], [0, 3], [0.3, 1.1], [1.7, 0], [3.1, 1.1], [3.4, 3], [3.1, 4.9],
]

const GLYPHS: Record<string, Glyph> = {
  A: { width: 3.6, stars: [[0, 0], [0.85, 2.5], [1.8, 6], [2.75, 2.5], [3.6, 0]], paths: [[0, 1, 2, 3, 4], [1, 3]] },
  B: {
    width: 3.2,
    stars: [[0, 0], [0, 3], [0, 6], [2.5, 5.9], [3, 4.6], [2.3, 3.1], [3.2, 1.6], [2.5, 0.1]],
    paths: [[0, 1, 2, 3, 4, 5, 1], [5, 6, 7, 0]],
  },
  C: {
    width: 3.3,
    stars: [[3.3, 5], [1.9, 6], [0.45, 5], [0, 3], [0.45, 1], [1.9, 0], [3.3, 1]],
    paths: [[0, 1, 2, 3, 4, 5, 6]],
  },
  D: { width: 3.3, stars: [[0, 0], [0, 6], [2.2, 5.6], [3.3, 3.6], [3.2, 1.8], [2.1, 0.3]], paths: [[0, 1, 2, 3, 4, 5, 0]] },
  E: { width: 3, stars: [[3, 6], [0, 6], [0, 3], [2.4, 3], [0, 0], [3, 0]], paths: [[0, 1, 2, 4, 5], [2, 3]] },
  F: { width: 3, stars: [[3, 6], [0, 6], [0, 3], [2.4, 3], [0, 0]], paths: [[0, 1, 2, 4], [2, 3]] },
  G: {
    width: 3.3,
    stars: [[3.2, 5], [1.8, 6], [0.4, 4.9], [0, 3], [0.5, 1], [1.9, 0], [3.2, 0.8], [3.3, 2.6], [1.9, 2.6]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 7, 8]],
  },
  H: { width: 3.2, stars: [[0, 0], [0, 3], [0, 6], [3.2, 6], [3.2, 3], [3.2, 0]], paths: [[0, 1, 2], [3, 4, 5], [1, 4]] },
  I: { width: 1.2, stars: [[0.6, 0], [0.6, 3], [0.6, 6]], paths: [[0, 1, 2]] },
  J: { width: 2.8, stars: [[2.6, 6], [2.6, 1.4], [1.4, 0], [0.2, 1]], paths: [[0, 1, 2, 3]] },
  K: { width: 3.3, stars: [[0, 0], [0, 2.8], [0, 6], [3.1, 6], [1.1, 3.7], [3.3, 0]], paths: [[0, 1, 2], [3, 4, 1], [4, 5]] },
  L: { width: 2.9, stars: [[0, 6], [0, 0], [2.9, 0]], paths: [[0, 1, 2]] },
  M: { width: 4, stars: [[0, 0], [0.3, 6], [2, 2.4], [3.7, 6], [4, 0]], paths: [[0, 1, 2, 3, 4]] },
  N: { width: 3.2, stars: [[0, 0], [0, 6], [3.2, 0], [3.2, 6]], paths: [[0, 1, 2, 3]] },
  O: { width: 3.4, stars: O_STARS, paths: [[0, 1, 2, 3, 4, 5, 6, 7, 0]] },
  P: { width: 3.2, stars: [[0, 0], [0, 3], [0, 6], [2.5, 5.8], [3.2, 4.5], [2.4, 3.1]], paths: [[0, 1, 2, 3, 4, 5, 1]] },
  Q: { width: 3.6, stars: [...O_STARS, [2.3, 1], [3.6, -0.4]], paths: [[0, 1, 2, 3, 4, 5, 6, 7, 0], [8, 9]] },
  R: {
    width: 3.4,
    stars: [[0, 0], [0, 3], [0, 6], [2.6, 5.8], [3.3, 4.5], [2.4, 3.15], [3.4, 0]],
    paths: [[0, 1, 2, 3, 4, 5, 1], [5, 6]],
  },
  S: {
    width: 3.1,
    stars: [[3.1, 5.2], [1.7, 6], [0.3, 5.1], [0.5, 3.6], [2.7, 2.5], [3.1, 1], [1.6, 0], [0.1, 0.8]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 7]],
  },
  T: { width: 3.4, stars: [[0, 6], [1.7, 6], [3.4, 6], [1.7, 3], [1.7, 0]], paths: [[0, 1, 2], [1, 3, 4]] },
  U: { width: 3.2, stars: [[0, 6], [0.1, 1.5], [1.6, 0], [3.1, 1.5], [3.2, 6]], paths: [[0, 1, 2, 3, 4]] },
  V: { width: 3.4, stars: [[0, 6], [0.85, 3], [1.7, 0], [2.55, 3], [3.4, 6]], paths: [[0, 1, 2, 3, 4]] },
  W: { width: 4, stars: [[0, 6], [0.9, 0], [2, 3.6], [3.1, 0], [4, 6]], paths: [[0, 1, 2, 3, 4]] },
  X: { width: 3.2, stars: [[0, 6], [1.6, 3], [3.2, 0], [3.2, 6], [0, 0]], paths: [[0, 1, 2], [3, 1, 4]] },
  Y: { width: 3.2, stars: [[0, 6], [1.6, 3.2], [3.2, 6], [1.6, 0]], paths: [[0, 1, 2], [1, 3]] },
  Z: { width: 3.2, stars: [[0, 6], [3.2, 6], [0, 0], [3.2, 0]], paths: [[0, 1, 2, 3]] },
  ' ': { width: 2.2, stars: [], paths: [] },
}

const LETTER_GAP = 1.3
export const GLYPH_HEIGHT = 6

export type NameStar = { x: number; y: number; mag: number; bv: number }

/** Lays out text as star figures, centred on (0, 0), in glyph units. */
export function layoutName(text: string) {
  const stars: NameStar[] = []
  const paths: number[][] = []
  let x = 0
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch]
    if (!glyph) continue
    const base = stars.length
    const ends = new Set(glyph.paths.flatMap((p) => [p[0], p.at(-1)!]))
    glyph.stars.forEach(([sx, sy], i) => {
      const r1 = Math.abs(Math.sin((base + i) * 12.9898) * 43758.5453) % 1
      const r2 = Math.abs(Math.sin((base + i) * 78.233) * 12345.678) % 1
      stars.push({ x: x + sx, y: sy, mag: 1.5 + 1.4 * r1 - (ends.has(i) ? 0.4 : 0), bv: -0.1 + 0.7 * r2 })
    })
    glyph.paths.forEach((p) => paths.push(p.map((i) => base + i)))
    x += glyph.width + LETTER_GAP
  }
  const width = Math.max(0, x - LETTER_GAP)
  for (const s of stars) {
    s.x -= width / 2
    s.y -= GLYPH_HEIGHT / 2
  }
  return { stars, paths, width }
}
