import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'

const EARTH_RADIUS_M = 6371008.8
const REFRACTION_K = 0.13

const tiles = new Map()

function tileName(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${ns}${String(Math.abs(lat)).padStart(2, '0')}${ew}${String(Math.abs(lon)).padStart(3, '0')}`
}

function loadTile(dir, lat, lon) {
  const key = `${lat},${lon}`
  if (tiles.has(key)) return tiles.get(key)
  let tile = null
  try {
    const raw = gunzipSync(readFileSync(join(dir, `${tileName(lat, lon)}.hgt.gz`)))
    const size = Math.round(Math.sqrt(raw.length / 2))
    const data = new Int16Array(size * size)
    for (let i = 0; i < data.length; i++) data[i] = raw.readInt16BE(i * 2)
    tile = { size, data }
  } catch {
    tile = null
  }
  tiles.set(key, tile)
  return tile
}

/** Bilinear SRTM elevation in metres. Returns NaN outside downloaded tiles. */
export function elevationAt(dir, lat, lon) {
  const tLat = Math.floor(lat)
  const tLon = Math.floor(lon)
  const tile = loadTile(dir, tLat, tLon)
  if (!tile) return Number.NaN
  const n = tile.size - 1
  const row = (tLat + 1 - lat) * n
  const col = (lon - tLon) * n
  const r0 = Math.min(Math.floor(row), n - 1)
  const c0 = Math.min(Math.floor(col), n - 1)
  const fr = row - r0
  const fc = col - c0
  const at = (r, c) => {
    const v = tile.data[r * tile.size + c]
    return v === -32768 ? 0 : v
  }
  const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc
  const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc
  return top * (1 - fr) + bottom * fr
}

function destination(latDeg, lonDeg, bearingRad, distanceM) {
  const lat1 = (latDeg * Math.PI) / 180
  const lon1 = (lonDeg * Math.PI) / 180
  const delta = distanceM / EARTH_RADIUS_M
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearingRad),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    )
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI]
}

/**
 * Ray-marches the DEM around an observer and returns, for every azimuth
 * sample and every distance band, the highest apparent altitude of terrain
 * inside that band (painter's-algorithm silhouettes, far to near).
 */
export function computeHorizon(dir, { lat, lon, eyeHeight, azimuthStep, bands, maxDistance }) {
  const ground = elevationAt(dir, lat, lon)
  const eye = ground + eyeHeight
  const effectiveRadius = EARTH_RADIUS_M / (1 - REFRACTION_K)
  const samples = Math.round(360 / azimuthStep)
  const layers = bands.map(() => ({
    altitude: new Float32Array(samples).fill(-90),
    distance: new Float32Array(samples),
    elevation: new Float32Array(samples),
  }))

  for (let i = 0; i < samples; i++) {
    const bearing = ((i * azimuthStep) * Math.PI) / 180
    let d = bands[0][0]
    while (d <= maxDistance) {
      const [pLat, pLon] = destination(lat, lon, bearing, d)
      const h = elevationAt(dir, pLat, pLon)
      if (!Number.isNaN(h)) {
        const drop = (d * d) / (2 * effectiveRadius)
        const altitude = (Math.atan2(h - eye - drop, d) * 180) / Math.PI
        const band = bands.findIndex(([from, to]) => d >= from && d < to)
        if (band >= 0 && altitude > layers[band].altitude[i]) {
          layers[band].altitude[i] = altitude
          layers[band].distance[i] = d
          layers[band].elevation[i] = h
        }
      }
      d += Math.max(25, d * 0.0025)
    }
  }

  return { ground, eye, samples, layers }
}
