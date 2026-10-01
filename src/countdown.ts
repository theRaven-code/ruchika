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

export const birthdayTarget = '2027-01-01T00:00:00+06:30'

export function getCountdownParts(targetDateTime: string, now = new Date()) {
  const target = new Date(targetDateTime)
  const totalMilliseconds = Math.max(0, target.getTime() - now.getTime())

  return {
    days: Math.floor(totalMilliseconds / day),
    hours: Math.floor((totalMilliseconds % day) / hour),
    minutes: Math.floor((totalMilliseconds % hour) / minute),
    seconds: Math.floor((totalMilliseconds % minute) / second),
  }
}
