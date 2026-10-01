import * as Astronomy from 'astronomy-engine'
import type { Observer } from './astro'
import { OBSERVER } from './observer'

const OFFSET_MS = OBSERVER.utcOffsetMinutes * 60_000
const HOUR_MS = 3_600_000

export type TimePreset = 'dawn' | 'morning' | 'night'

function shifted(date: Date) {
  return new Date(date.getTime() + OFFSET_MS)
}

export function localMidnight(date: Date) {
  const d = shifted(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET_MS)
}

/** Hours since local (IST) midnight, 0..24. */
export function localHours(date: Date) {
  return (date.getTime() - localMidnight(date).getTime()) / HOUR_MS
}

export function withLocalHours(date: Date, hours: number) {
  return new Date(localMidnight(date).getTime() + hours * HOUR_MS)
}

/** yyyy-mm-dd of the local (IST) calendar day, for <input type="date">. */
export function localDateValue(date: Date) {
  return shifted(date).toISOString().slice(0, 10)
}

export function withLocalDate(date: Date, value: string) {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS + localHours(date) * HOUR_MS)
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatLocalDate(date: Date) {
  return dateFormat.format(shifted(date))
}

export function formatLocalTime(date: Date) {
  return `${timeFormat.format(shifted(date))} ${OBSERVER.timeZoneLabel}`
}

function azAlt(body: Astronomy.Body, date: Date, observer: Observer) {
  const eq = Astronomy.Equator(body, date, observer, true, true)
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal')
  return { az: hor.azimuth, alt: hor.altitude }
}

const altitude = (body: Astronomy.Body, date: Date, observer: Observer) => azAlt(body, date, observer).alt

/**
 * The darkest moment of the evening, close to 22:00: astronomical night with
 * as little moonlight as possible (ideally the Moon below the horizon).
 */
function darkestNight(midnight: Date, observer: Observer) {
  const phase = Astronomy.Illumination(Astronomy.Body.Moon, new Date(midnight.getTime() + 22 * HOUR_MS)).phase_fraction
  let best = new Date(midnight.getTime() + 22 * HOUR_MS)
  let bestScore = Infinity
  for (let h = 19; h <= 28; h += 1 / 6) {
    const t = new Date(midnight.getTime() + h * HOUR_MS)
    if (altitude(Astronomy.Body.Sun, t, observer) > -18) continue
    const moonAlt = altitude(Astronomy.Body.Moon, t, observer)
    const moonlight = moonAlt < -2 ? 0 : phase * Math.min(1, (moonAlt + 2) / 27)
    const score = moonlight + 0.03 * Math.abs(h - 22)
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/**
 * Picks a moment on the local day of `date`:
 * - dawn: the Sun is 10 degrees below the horizon, stars fading into blue
 * - morning: a few minutes after the Sun first clears the surrounding ridges
 * - night: the darkest, least moonlit moment near 22:00
 */
export function presetTime(
  preset: TimePreset,
  date: Date,
  observer: Observer,
  ridgeAltitude: (azDeg: number) => number,
) {
  const midnight = localMidnight(date)
  if (preset === 'night') return darkestNight(midnight, observer)

  if (preset === 'dawn') {
    const t = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, +1, midnight, 1, -10)
    return t ? t.date : new Date(midnight.getTime() + 5.5 * HOUR_MS)
  }

  const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, +1, midnight, 1)
  const start = sunrise ? sunrise.date.getTime() : midnight.getTime() + 6 * HOUR_MS
  for (let t = start; t < start + 5 * HOUR_MS; t += 2 * 60_000) {
    const sun = azAlt(Astronomy.Body.Sun, new Date(t), observer)
    if (sun.alt > ridgeAltitude(sun.az) + 0.6) return new Date(t + 8 * 60_000)
  }
  return new Date(start + 2 * HOUR_MS)
}
