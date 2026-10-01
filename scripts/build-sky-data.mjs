// Builds the web-ready sky datasets in public/sky from public sources.
//
//   node scripts/build-sky-data.mjs
//
// Raw downloads are cached in .cache/sky-raw so the script can be re-run
// offline. See public/sky/CREDITS.md for sources and licenses.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { computeHorizon } from './sky-data/terrain.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = join(root, '.cache/sky-raw')
const outDir = join(root, 'public/sky')

const OBSERVER = {
  name: 'IIT Mandi',
  place: 'Kamand, Himachal Pradesh',
  lat: 31.77167,
  lon: 76.98361,
  eyeHeight: 10,
}

const STELLARIUM = 'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern'
const SOURCES = {
  hyg: {
    url: 'https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz',
    file: 'hyg/hyg_v44.csv.gz',
  },
  stellariumIndex: { url: `${STELLARIUM}/index.json`, file: 'stellarium/index.json' },
  milkyWay: {
    // NASA SVS "Deep Star Maps 2020" Milky Way layer (bright stars removed),
    // mirrored on Wikimedia Commons because svs.gsfc.nasa.gov is often unreachable.
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Deep_Star_Maps_2020_%E2%80%93_Milkyway_2020_64k.jpg/3840px-Deep_Star_Maps_2020_%E2%80%93_Milkyway_2020_64k.jpg',
    file: 'nasa/milkyway_2020_3840.jpg',
  },
}

const STAR_MAG_LIMIT = 7.5
const HORIZON_BANDS_M = [
  [60, 600],
  [600, 1800],
  [1800, 5000],
  [5000, 14000],
  [14000, 40000],
  [40000, 160000],
]
const HORIZON_STEP_DEG = 0.1

async function download(url, file) {
  const path = join(rawDir, file)
  if (existsSync(path)) return path
  mkdirSync(dirname(path), { recursive: true })
  console.log(`download ${url}`)
  const response = await fetch(url, { headers: { 'user-agent': 'ruchika-sky-data/1.0' } })
  if (!response.ok) throw new Error(`${response.status} for ${url}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
  return path
}

async function ensureTerrainTiles() {
  const dir = join(rawDir, 'terrain')
  const lat0 = Math.floor(OBSERVER.lat)
  const lon0 = Math.floor(OBSERVER.lon)
  for (let lat = lat0 - 1; lat <= lat0 + 1; lat++) {
    for (let lon = lon0 - 1; lon <= lon0 + 2; lon++) {
      const name = `N${lat}E${String(lon).padStart(3, '0')}`
      await download(
        `https://s3.amazonaws.com/elevation-tiles-prod/skadi/N${lat}/${name}.hgt.gz`,
        `terrain/${name}.hgt.gz`,
      )
    }
  }
  return dir
}

function parseCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

function readConstellations(index) {
  return index.constellations.map((c) => ({
    id: c.id.replace(/^CON modern /, ''),
    name: c.common_name?.native ?? c.common_name?.english ?? c.id,
    english: c.common_name?.english ?? '',
    lines: c.lines.map((line) => line.filter((v) => typeof v === 'number')),
    image: c.image
      ? {
          file: c.image.file.replace(/^illustrations\//, ''),
          size: c.image.size,
          anchors: c.image.anchors.map((a) => ({ pos: a.pos, hip: a.hip })),
        }
      : null,
  }))
}

function buildStars(hygPath, requiredHip) {
  const lines = gunzipSync(readFileSync(hygPath)).toString('utf8').split('\n')
  const header = parseCsvLine(lines[0])
  const col = Object.fromEntries(header.map((name, i) => [name, i]))
  const byHip = new Map()

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const f = parseCsvLine(lines[i])
    const hip = Number(f[col.hip])
    const mag = Number(f[col.mag])
    if (f[col.proper] === 'Sol' || !Number.isFinite(mag)) continue
    if (mag > STAR_MAG_LIMIT && !(hip && requiredHip.has(hip))) continue
    const star = {
      hip: hip || 0,
      ra: (Number(f[col.ra]) * Math.PI) / 12,
      dec: (Number(f[col.dec]) * Math.PI) / 180,
      mag,
      bv: f[col.ci] === '' ? 0.6 : Number(f[col.ci]),
    }
    // HYG lists some Hipparcos components twice; keep the brighter entry.
    if (star.hip) {
      const existing = byHip.get(star.hip)
      if (existing && existing.mag <= mag) continue
      byHip.set(star.hip, star)
    } else {
      byHip.set(`hr${i}`, star)
    }
  }

  const stars = [...byHip.values()].sort((a, b) => a.mag - b.mag)
  const n = stars.length
  const buffer = new ArrayBuffer(4 + n * 4 * 5)
  new Uint32Array(buffer, 0, 1)[0] = n
  const ra = new Float32Array(buffer, 4, n)
  const dec = new Float32Array(buffer, 4 + n * 4, n)
  const mag = new Float32Array(buffer, 4 + n * 8, n)
  const bv = new Float32Array(buffer, 4 + n * 12, n)
  const hip = new Int32Array(buffer, 4 + n * 16, n)
  stars.forEach((s, i) => {
    ra[i] = s.ra
    dec[i] = s.dec
    mag[i] = s.mag
    bv[i] = s.bv
    hip[i] = s.hip
  })
  writeFileSync(join(outDir, 'stars.bin'), Buffer.from(buffer))

  const missing = [...requiredHip].filter((h) => !byHip.has(h))
  console.log(`stars: ${n} (mag <= ${STAR_MAG_LIMIT} plus figure stars), missing figure stars: ${missing.length}`)
  return byHip
}

function buildConstellationData(index, starsByHip) {
  const constellations = readConstellations(index)
  const starNames = {}
  for (const [key, names] of Object.entries(index.common_names)) {
    const hip = Number(key.replace(/^HIP /, ''))
    if (!hip || !starsByHip.has(hip) || !names[0]) continue
    starNames[hip] = names[0].english ?? names[0].native
  }

  const artDir = join(outDir, 'art')
  mkdirSync(artDir, { recursive: true })
  for (const c of constellations) {
    if (!c.image) continue
    copyFileSync(join(rawDir, 'stellarium/illustrations', c.image.file), join(artDir, c.image.file))
  }

  writeFileSync(join(outDir, 'constellations.json'), JSON.stringify({ constellations, starNames }))
  console.log(`constellations: ${constellations.length}, star names: ${Object.keys(starNames).length}`)
}

async function ensureIllustrations(index) {
  for (const c of readConstellations(index)) {
    if (c.image) await download(`${STELLARIUM}/illustrations/${c.image.file}`, `stellarium/illustrations/${c.image.file}`)
  }
}

function buildHorizon(terrainDir) {
  const horizon = computeHorizon(terrainDir, {
    lat: OBSERVER.lat,
    lon: OBSERVER.lon,
    eyeHeight: OBSERVER.eyeHeight,
    azimuthStep: HORIZON_STEP_DEG,
    bands: HORIZON_BANDS_M,
    maxDistance: HORIZON_BANDS_M.at(-1)[1],
  })
  const data = {
    observer: { ...OBSERVER, ground: Math.round(horizon.ground) },
    step: HORIZON_STEP_DEG,
    bands: HORIZON_BANDS_M,
    // Per layer, per azimuth sample (clockwise from north): apparent
    // altitude in centidegrees and distance to the ridge in metres.
    altitude: horizon.layers.map((l) => Array.from(l.altitude, (v) => Math.round(v * 100))),
    distance: horizon.layers.map((l) => Array.from(l.distance, (v) => Math.round(v))),
  }
  writeFileSync(join(outDir, 'horizon.json'), JSON.stringify(data))
  const envelope = data.altitude[0].map((_, i) => Math.max(...data.altitude.map((l) => l[i])) / 100)
  console.log(
    `horizon: ground ${data.observer.ground} m, ridge altitude ${Math.min(...envelope).toFixed(1)}..${Math.max(...envelope).toFixed(1)} deg`,
  )
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const hygPath = await download(SOURCES.hyg.url, SOURCES.hyg.file)
  const indexPath = await download(SOURCES.stellariumIndex.url, SOURCES.stellariumIndex.file)
  const milkyWayPath = await download(SOURCES.milkyWay.url, SOURCES.milkyWay.file)
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  await ensureIllustrations(index)
  const terrainDir = await ensureTerrainTiles()

  const requiredHip = new Set()
  for (const c of readConstellations(index)) {
    c.lines.flat().forEach((hip) => requiredHip.add(hip))
    c.image?.anchors.forEach((a) => requiredHip.add(a.hip))
  }

  const starsByHip = buildStars(hygPath, requiredHip)
  buildConstellationData(index, starsByHip)
  copyFileSync(milkyWayPath, join(outDir, 'milkyway.jpg'))
  buildHorizon(terrainDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
