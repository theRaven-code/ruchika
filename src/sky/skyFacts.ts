import * as Astronomy from 'astronomy-engine'
import { AU_KM, type BodyId, type BodyState, type Observer } from './astro'
import type { SkyData, StarDetails } from './data'
import { OBSERVER } from './observer'
import { nextPoya } from './poya'
import { formatLocalDate, formatLocalTime, localDateValue, localMidnight, withLocalDate } from './time'

export type SelectionTarget =
  | { kind: 'star'; index: number }
  | { kind: 'body'; id: BodyId }
  | { kind: 'constellation'; index: number }

export type Fact = { label: string; value: string; target?: SelectionTarget }

/** What the selection card shows. */
export type Selection = {
  name: string
  kind: string
  /** The constellation it lies in, offered as a link. */
  constellation: { name: string; target: SelectionTarget } | null
  about: string[]
  facts: Fact[]
}

/** Where a direction is in the sky over Kamand right now. */
export type Sighting = {
  az: number
  alt: number
  /** Above the horizon, but behind the ridges. */
  hidden: boolean
  /** Hours. */
  ra: number
  dec: number
}

const COMPASS_POINTS = [
  'north', 'north-northeast', 'northeast', 'east-northeast',
  'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest',
  'west', 'west-northwest', 'northwest', 'north-northwest',
]

export const compassPoint = (az: number) => COMPASS_POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16]

export function heightInSky(alt: number) {
  if (alt < 12) return 'just above the horizon'
  if (alt < 30) return 'low in the sky'
  if (alt < 55) return 'about halfway up the sky'
  if (alt < 75) return 'high in the sky'
  return 'almost straight overhead'
}

function formatRa(hours: number) {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

function formatSigned(deg: number) {
  return `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(1)}°`
}

const formatNumber = (n: number) => n.toLocaleString('en-GB', { maximumSignificantDigits: 3 })
const joinKnown = (...parts: string[]) => parts.filter(Boolean).join(' · ')

const NAKED_EYE_LIMIT = 6
const SIDEREAL_HOURS_PER_HOUR = 1.00273790935
const LIGHT_SECONDS_PER_AU = 499.004784
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MOON_PHASES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
]
/** Lowest temperature (K) for each colour; anything cooler is red. */
const STAR_COLOURS: [number, string][] = [
  [25000, 'Blue'],
  [10000, 'Blue-white'],
  [7500, 'White'],
  [6000, 'Yellow-white'],
  [5200, 'Yellow'],
  [3700, 'Orange'],
]
const LUMINOSITY_CLASSES: Record<string, string> = {
  Iab: 'supergiant',
  Ia: 'supergiant',
  Ib: 'supergiant',
  I: 'supergiant',
  II: 'bright giant',
  III: 'giant',
  IV: 'subgiant',
  V: 'main-sequence star',
}
const BODY_ABOUT: Record<BodyId, string> = {
  Sun: 'Our own star. Every other point of light in this sky is a sun too, many of them far larger and brighter.',
  Moon: 'Earth’s only natural satellite, always turning the same face to us. Each full moon is a Poya day in Sri Lanka, kept with sil, quiet and fasting.',
  Mercury: 'The smallest planet and the closest to the Sun, so it never strays far from the twilight.',
  Venus: 'Wrapped in bright clouds, Venus outshines everything but the Sun and Moon: the evening or the morning star.',
  Mars: 'The red planet, coloured by iron-rich dust. It is brightest every 26 months, when Earth overtakes it.',
  Jupiter: 'The largest planet. Binoculars show its four big moons, first seen by Galileo in 1610.',
  Saturn: 'The ringed planet. Even a small telescope shows the rings.',
}

const wrapHours = (hours: number) => ((hours % 24) + 24) % 24
const localSiderealTime = (date: Date) => wrapHours(Astronomy.SiderealTime(date) + OBSERVER.longitude / 15)
/** Altitude at the meridian; zero or less means it never rises here. */
const highestAltitude = (dec: number) => 90 - Math.abs(OBSERVER.latitude - dec)

/** Ballesteros (2012) blackbody fit to the B−V colour index. */
const colourTemperature = (bv: number) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
const colourName = (kelvin: number) => STAR_COLOURS.find(([min]) => kelvin >= min)?.[1] ?? 'Red'

function luminosityClass(spectrum: string) {
  const match = /^[OBAFGKM][\d.]*:?\s*(Iab|Ia|Ib|III|II|IV|I|V)/.exec(spectrum)
  return match ? LUMINOSITY_CLASSES[match[1]] : 'star'
}

function lightTime(au: number) {
  const minutes = (au * LIGHT_SECONDS_PER_AU) / 60
  if (minutes < 10) return `${Math.floor(minutes)} min ${Math.round((minutes % 1) * 60)} s`
  if (minutes < 60) return `${Math.round(minutes)} min`
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`
}

function whereNow({ az, alt, hidden }: Sighting): Fact {
  const where = alt < 0 ? 'Below the horizon' : hidden ? 'Behind the ridges' : `Up, ${heightInSky(alt)}`
  return { label: 'Now', value: `${where} to the ${compassPoint(az)}` }
}

function highest({ ra, dec }: Sighting, date: Date): Fact {
  const alt = highestAltitude(dec)
  if (alt <= 0) return { label: 'Highest', value: 'Never rises here' }
  const time = new Date(date.getTime() + (wrapHours(ra - localSiderealTime(date)) / SIDEREAL_HOURS_PER_HOUR) * 3_600_000)
  const neverSets = dec >= 90 - OBSERVER.latitude
  return { label: 'Highest', value: joinKnown(`${formatLocalTime(time)}, ${Math.round(alt)}° up`, neverSets ? 'never sets' : '') }
}

const position = (s: Sighting): Fact[] => [
  { label: 'Az / Alt', value: `${s.az.toFixed(1)}° / ${formatSigned(s.alt)}` },
  { label: 'RA / Dec', value: `${formatRa(s.ra)} / ${formatSigned(s.dec)}` },
]

/** The month whose evenings, at 21:00, bring this right ascension to the meridian. */
function bestMonth(ra: number, date: Date) {
  const gaps = MONTHS.map((_, month) => {
    const evening = new Date(Date.UTC(date.getUTCFullYear(), month, 15, 21) - OBSERVER.utcOffsetMinutes * 60_000)
    const ahead = wrapHours(ra - localSiderealTime(evening))
    return Math.min(ahead, 24 - ahead)
  })
  return MONTHS[gaps.indexOf(Math.min(...gaps))]
}

function riseAndSet(body: Astronomy.Body, observer: Observer, date: Date): Fact[] {
  const midnight = localMidnight(date)
  const time = (direction: number) => {
    const event = Astronomy.SearchRiseSet(body, observer, direction, midnight, 1)
    return event ? formatLocalTime(event.date) : 'Not today'
  }
  return [
    { label: 'Rises', value: time(+1) },
    { label: 'Sets', value: time(-1) },
  ]
}

function poya(date: Date): Fact {
  const next = nextPoya(date)
  const when = next.day === localDateValue(date) ? 'today' : formatLocalDate(withLocalDate(date, next.day))
  return { label: 'Poya', value: `${next.name} Poya, ${when}` }
}

function constellationLink({ constellations }: SkyData, index: number): Selection['constellation'] {
  const constellation = constellations[index]
  return constellation ? { name: constellation.name, target: { kind: 'constellation', index } } : null
}

/** The proper name, else the Bayer or Flamsteed designation, else the Hipparcos number. */
function starName(index: number, { stars, starNames }: SkyData, details: StarDetails | null) {
  const hip = stars.hip[index]
  return starNames[hip] ?? (details?.designation[index] || (hip ? `HIP ${hip}` : 'Star'))
}

export function starSelection(
  index: number,
  data: SkyData,
  details: StarDetails | null,
  sighting: Sighting,
  date: Date,
): Selection {
  const { stars } = data
  const hip = stars.hip[index]
  const designation = details?.designation[index] ?? ''
  const spectrum = details?.spectrum[index] ?? ''
  const lightYears = details?.lightYears[index] ?? 0
  const luminosity = details?.luminosity[index] ?? 0
  const kelvin = colourTemperature(stars.bv[index])
  const year = date.getUTCFullYear() - Math.round(lightYears)
  const catalogue = joinKnown(designation, hip ? `HIP ${hip}` : '')
  return {
    name: starName(index, data, details),
    kind: `${colourName(kelvin)} ${luminosityClass(spectrum)}`,
    constellation: constellationLink(data, stars.con[index]),
    about: [],
    facts: [
      whereNow(sighting),
      highest(sighting, date),
      ...(lightYears
        ? [
            { label: 'Distance', value: `${formatNumber(lightYears)} light-years` },
            { label: 'Its light left', value: `around ${year > 0 ? year : `${1 - year} BCE`}` },
          ]
        : []),
      {
        label: 'Brightness',
        value: joinKnown(`mag ${stars.mag[index].toFixed(2)}`, luminosity ? `${formatNumber(luminosity)} × the Sun` : ''),
      },
      { label: 'Colour', value: joinKnown(spectrum, `about ${formatNumber(Math.round(kelvin / 100) * 100)} K`) },
      ...(catalogue ? [{ label: 'Catalogue', value: catalogue }] : []),
      ...position(sighting),
    ],
  }
}

export function bodySelection(
  body: BodyState,
  constellationIndex: number,
  sighting: Sighting,
  data: SkyData,
  observer: Observer,
  date: Date,
): Selection {
  const card = {
    name: body.id,
    constellation: constellationLink(data, constellationIndex),
    about: [BODY_ABOUT[body.id]],
  }
  if (body.id === 'Sun') {
    return {
      ...card,
      kind: 'Our star',
      facts: [
        whereNow(sighting),
        ...riseAndSet(Astronomy.Body.Sun, observer, date),
        { label: 'Light takes', value: lightTime(body.dist) },
        ...position(sighting),
      ],
    }
  }
  if (body.id === 'Moon') {
    const phase = MOON_PHASES[Math.round(Astronomy.MoonPhase(date) / 45) % 8]
    return {
      ...card,
      kind: `${phase} · ${Math.round(body.phase * 100)}% lit`,
      facts: [
        poya(date),
        whereNow(sighting),
        ...riseAndSet(Astronomy.Body.Moon, observer, date),
        { label: 'Distance', value: `${Math.round(body.dist * AU_KM).toLocaleString('en-GB')} km` },
        ...position(sighting),
      ],
    }
  }
  return {
    ...card,
    kind: 'Planet',
    facts: [
      whereNow(sighting),
      highest(sighting, date),
      { label: 'Distance', value: `${body.dist.toFixed(2)} AU · light takes ${lightTime(body.dist)}` },
      { label: 'Brightness', value: `mag ${body.mag.toFixed(1)}` },
      ...(body.phase < 0.95 ? [{ label: 'Lit', value: `${Math.round(body.phase * 100)}%` }] : []),
      ...position(sighting),
    ],
  }
}

/** `sighting` is the middle of the figure. */
export function constellationSelection(
  index: number,
  data: SkyData,
  details: StarDetails | null,
  sighting: Sighting,
  date: Date,
): Selection {
  const { stars } = data
  const constellation = data.constellations[index]
  // The catalogue is sorted by magnitude, so the first member found is the brightest.
  let brightest = -1
  let nakedEye = 0
  for (let i = 0; i < stars.count; i++) {
    if (stars.con[i] !== index) continue
    if (brightest < 0) brightest = i
    if (stars.mag[i] <= NAKED_EYE_LIMIT) nakedEye++
  }
  const rises = highestAltitude(sighting.dec) > 0
  return {
    name: constellation.name,
    kind: constellation.english === constellation.name ? 'Constellation' : `Constellation · ${constellation.english}`,
    constellation: null,
    about: constellation.description.split('\n\n'),
    facts: [
      {
        label: 'Brightest star',
        value: `${starName(brightest, data, details)} · mag ${stars.mag[brightest].toFixed(1)}`,
        target: { kind: 'star', index: brightest },
      },
      { label: 'To the eye', value: `${nakedEye} stars on a dark night` },
      ...(rises ? [{ label: 'Best seen', value: `${bestMonth(sighting.ra, date)} evenings` }] : []),
      whereNow(sighting),
      highest(sighting, date),
    ],
  }
}
