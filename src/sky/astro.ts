import * as Astronomy from 'astronomy-engine'
import { Matrix4, Vector3 } from 'three'
import { OBSERVER } from './observer'

export type Observer = Astronomy.Observer

export function createObserver(elevation: number): Observer {
  return new Astronomy.Observer(OBSERVER.latitude, OBSERVER.longitude, elevation)
}

export function raDecToVector(ra: number, dec: number, out = new Vector3()) {
  const c = Math.cos(dec)
  return out.set(c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec))
}

/**
 * Rotation from J2000 equatorial coordinates (EQJ) to the local world frame
 * used by the renderer: +x east, +y zenith, -z north.
 */
export function celestialToWorld(date: Date, observer: Observer, out: Matrix4) {
  // Astronomy Engine's HOR frame is (north, west, zenith) and element
  // (row i, column j) of its EQJ->HOR matrix is stored as rot[j][i].
  const r = Astronomy.Rotation_EQJ_HOR(date, observer).rot
  return out.set(
    -r[0][1], -r[1][1], -r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    -r[0][0], -r[1][0], -r[2][0], 0,
    0, 0, 0, 1,
  )
}

/** Azimuth (degrees clockwise from north) and altitude (degrees) of a world direction. */
export function worldToAzAlt(v: Vector3) {
  const az = (Math.atan2(v.x, -v.z) * 180) / Math.PI
  return {
    az: (az + 360) % 360,
    alt: (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI,
  }
}

export function azAltToWorld(azDeg: number, altDeg: number, out = new Vector3()) {
  const az = (azDeg * Math.PI) / 180
  const alt = (altDeg * Math.PI) / 180
  return out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt))
}

export type BodyId = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn'

export type BodyState = {
  id: BodyId
  eqj: Vector3
  world: Vector3
  mag: number
  /** Apparent angular radius in radians. */
  radius: number
  /** Illuminated fraction of the disc (Moon and planets). */
  phase: number
}

const BODY_IDS: BodyId[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']
const AU_KM = 149597870.7
const RADIUS_KM: Partial<Record<BodyId, number>> = { Sun: 695700, Moon: 1737.4 }

export function computeBodies(date: Date, observer: Observer, toWorld: Matrix4): BodyState[] {
  return BODY_IDS.map((id) => {
    const body = Astronomy.Body[id]
    const eq = Astronomy.Equator(body, date, observer, false, true)
    const eqj = raDecToVector((eq.ra * Math.PI) / 12, (eq.dec * Math.PI) / 180)
    const world = eqj.clone().applyMatrix4(toWorld)
    const illumination = id === 'Sun' ? null : Astronomy.Illumination(body, date)
    const radiusKm = RADIUS_KM[id]
    return {
      id,
      eqj,
      world,
      mag: illumination ? illumination.mag : -26.7,
      radius: radiusKm ? Math.asin(radiusKm / (eq.dist * AU_KM)) : 0,
      phase: illumination ? illumination.phase_fraction : 1,
    }
  })
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Naked-eye limiting magnitude against solar altitude, from daylight through
// civil, nautical and astronomical twilight to full darkness.
const TWILIGHT_LIMIT: [number, number][] = [
  [8, -3.0],
  [0, -0.2],
  [-3, 1.6],
  [-6, 3.1],
  [-9, 4.4],
  [-12, 5.3],
  [-15, 5.9],
  [-18, 6.3],
]

export function limitingMagnitude(sunAlt: number, moonAlt: number, moonPhase: number) {
  let limit = TWILIGHT_LIMIT.at(-1)![1]
  if (sunAlt >= TWILIGHT_LIMIT[0][0]) {
    limit = TWILIGHT_LIMIT[0][1]
  } else {
    for (let i = 0; i < TWILIGHT_LIMIT.length - 1; i++) {
      const [a0, m0] = TWILIGHT_LIMIT[i]
      const [a1, m1] = TWILIGHT_LIMIT[i + 1]
      if (sunAlt <= a0 && sunAlt >= a1) {
        limit = m0 + ((sunAlt - a0) / (a1 - a0)) * (m1 - m0)
        break
      }
    }
  }
  return limit - 1.4 * moonPhase * smooth(-2, 15, moonAlt)
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  return smooth(edge0, edge1, x)
}
