import * as Astronomy from 'astronomy-engine'
import { localDateValue, localMidnight } from './time'

/** By calendar month. An adhi (leap) Poya, every two or three years, borrows a neighbour's name. */
const POYA_NAMES = ['Duruthu', 'Navam', 'Medin', 'Bak', 'Vesak', 'Poson', 'Esala', 'Nikini', 'Binara', 'Vap', 'Il', 'Unduvap']

/** The Sri Lankan Poya calendar reckons the evening at Colombo (same UTC+5:30 day as IST). */
const COLOMBO = new Astronomy.Observer(6.93, 79.85, 5)
const DAY_MS = 86_400_000
/** The full-moon tithi is the last 12° of the Moon's elongation before opposition. */
const TITHI_START = 168

export type Poya = {
  name: string
  /** Local calendar day, yyyy-mm-dd. */
  day: string
  fullMoon: Date
}

/**
 * Poya is the evening the Moon is full: the last sunset before the full moon,
 * when that sunset already falls in the full-moon tithi, otherwise the day of
 * the full moon itself. This reproduces the official 2024–2027 calendar.
 */
function poyaFor(fullMoon: Date): Poya {
  const tithiStart = Astronomy.SearchMoonPhase(TITHI_START, new Date(fullMoon.getTime() - 2 * DAY_MS), 2)!
  const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, COLOMBO, -1, fullMoon, -1)!
  const day = localDateValue(sunset.ut >= tithiStart.ut ? sunset.date : fullMoon)
  return { name: POYA_NAMES[Number(day.slice(5, 7)) - 1], day, fullMoon }
}

const nextFullMoon = (after: Date) => Astronomy.SearchMoonPhase(180, after, 40)!.date

const upcoming = new Map<string, Poya>()

/** Today's Poya, or the next one. */
export function nextPoya(date: Date): Poya {
  const today = localDateValue(date)
  let poya = upcoming.get(today)
  if (poya) return poya
  // A full moon early in the morning belongs to the Poya of the evening before.
  poya = poyaFor(nextFullMoon(localMidnight(date)))
  if (poya.day < today) poya = poyaFor(nextFullMoon(new Date(poya.fullMoon.getTime() + DAY_MS)))
  upcoming.set(today, poya)
  return poya
}

export function poyaOn(date: Date): Poya | null {
  const poya = nextPoya(date)
  return poya.day === localDateValue(date) ? poya : null
}
