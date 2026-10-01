export type CountdownParts = {
  days: number
  hours: number
  minutes: number
  seconds: number
}

const second = 1000
const minute = second * 60
const hour = minute * 60
const day = hour * 24

/** Ruchika's birthday, counted from local midnight in India (IST, UTC+5:30). */
export const birthday = { month: 12, day: 14, utcOffsetMinutes: 330 }

export type BirthdayState =
  | { kind: 'countdown'; target: Date; parts: CountdownParts }
  | { kind: 'birthday' }

function birthdayStart(year: number) {
  return new Date(Date.UTC(year, birthday.month - 1, birthday.day) - birthday.utcOffsetMinutes * minute)
}

/** Counts down to the next birthday, or reports that today is the day. */
export function getBirthdayState(now = new Date()): BirthdayState {
  const localYear = new Date(now.getTime() + birthday.utcOffsetMinutes * minute).getUTCFullYear()
  let start = birthdayStart(localYear)
  if (now.getTime() >= start.getTime() + day) start = birthdayStart(localYear + 1)
  if (now >= start) return { kind: 'birthday' }
  return { kind: 'countdown', target: start, parts: getCountdownParts(start, now) }
}

export function getCountdownParts(target: Date, now = new Date()): CountdownParts {
  const totalMilliseconds = Math.max(0, target.getTime() - now.getTime())

  return {
    days: Math.floor(totalMilliseconds / day),
    hours: Math.floor((totalMilliseconds % day) / hour),
    minutes: Math.floor((totalMilliseconds % hour) / minute),
    seconds: Math.floor((totalMilliseconds % minute) / second),
  }
}
