import type { Vector3 } from 'three'
import { azAltToWorld, raDecToVector } from '../astro'
import { createLines, polylineSegments } from './lines'

const DEG = Math.PI / 180

function sphericalGrid(toVector: (lonDeg: number, latDeg: number) => Vector3, lonStep: number, latStep: number) {
  const segments: number[] = []
  for (let lat = -90 + latStep; lat < 90; lat += latStep) {
    const ring: Vector3[] = []
    for (let lon = 0; lon < 360; lon += 1) ring.push(toVector(lon, lat))
    polylineSegments(ring, true, segments)
  }
  for (let lon = 0; lon < 360; lon += lonStep) {
    const limit = lon % 90 === 0 ? 90 : 90 - latStep
    const meridian: Vector3[] = []
    for (let lat = -limit; lat <= limit; lat += 1) meridian.push(toVector(lon, lat))
    polylineSegments(meridian, false, segments)
  }
  return segments
}

/** Altitude/azimuth grid, fixed to the observer's horizon (world frame). */
export function createAzimuthalGrid() {
  return createLines(
    sphericalGrid((az, alt) => azAltToWorld(az, alt), 15, 10),
    { color: '#d9714f', opacity: 0.55, width: 1.1 },
    20,
  )
}

/** Right ascension/declination grid, fixed to the stars (J2000 frame). */
export function createEquatorialGrid() {
  return createLines(
    sphericalGrid((ra, dec) => raDecToVector(ra * DEG, dec * DEG), 15, 10),
    { color: '#5d8fe0', opacity: 0.55, width: 1.1 },
    21,
  )
}
