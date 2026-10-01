export type StarCatalog = {
  count: number
  ra: Float32Array
  dec: Float32Array
  mag: Float32Array
  bv: Float32Array
  hip: Int32Array
}

export type ConstellationArt = {
  file: string
  size: [number, number]
  anchors: { pos: [number, number]; hip: number }[]
}

export type Constellation = {
  id: string
  name: string
  english: string
  lines: number[][]
  image: ConstellationArt | null
}

export type HorizonData = {
  observer: { lat: number; lon: number; ground: number; eyeHeight: number }
  step: number
  bands: [number, number][]
  altitude: number[][]
  distance: number[][]
}

export type SkyData = {
  stars: StarCatalog
  constellations: Constellation[]
  starNames: Record<number, string>
  horizon: HorizonData
}

export const skyAsset = (file: string) => `${import.meta.env.BASE_URL}sky/${file}`

async function fetchOk(file: string) {
  const response = await fetch(skyAsset(file))
  if (!response.ok) throw new Error(`Failed to load ${file} (${response.status})`)
  return response
}

function parseStars(buffer: ArrayBuffer): StarCatalog {
  const count = new Uint32Array(buffer, 0, 1)[0]
  return {
    count,
    ra: new Float32Array(buffer, 4, count),
    dec: new Float32Array(buffer, 4 + count * 4, count),
    mag: new Float32Array(buffer, 4 + count * 8, count),
    bv: new Float32Array(buffer, 4 + count * 12, count),
    hip: new Int32Array(buffer, 4 + count * 16, count),
  }
}

export async function loadSkyData(): Promise<SkyData> {
  const [starsBuffer, constellationData, horizon] = await Promise.all([
    fetchOk('stars.bin').then((r) => r.arrayBuffer()),
    fetchOk('constellations.json').then((r) => r.json()),
    fetchOk('horizon.json').then((r) => r.json()),
  ])
  return {
    stars: parseStars(starsBuffer),
    constellations: constellationData.constellations,
    starNames: constellationData.starNames,
    horizon,
  }
}
