import { smoothstep } from './astro'

/** Sky notes folded together with how much she is loved. */
export const SKY_QUOTES = [
  
  'I heard twilight is the sky refusing to let go of the light. I know that feeling.',
   "I know you are seeing this in the worst possible time, but I've never faked my love for you mama.",
  'The darker the night, the more stars. The longer I know you, the more I love you.',
  "Let me be the guy that takes your hand and leads you through the darkness.",
  "You really don't have to mother me anymore, I'll be your responsible appa",
  "You've made me into a better man, and its time I take care of you.",
  "We'll be a team, and face the universe love", 
  "This is the largest and most ambitious project I've ever worked on,in my entire career.",
]

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
const PERIOD = 8.5

export type QuoteRect = [number, number, number, number]

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

/** One quote at a time, fading in and out. `elapsed` only advances the cycle. */
export function drawSkyQuote(
  ctx: CanvasRenderingContext2D,
  quotes: string[],
  order: number[],
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  elapsed: number,
): QuoteRect | null {
  if (quotes.length === 0 || elapsed < 0.4 || size < 9) return null
  const slot = Math.floor(elapsed / PERIOD)
  const local = elapsed - slot * PERIOD
  const alpha = smoothstep(0, 0.7, local) * (1 - smoothstep(PERIOD - 0.9, PERIOD, local))
  if (alpha <= 0.02) return null

  const quote = quotes[order[slot % order.length] % quotes.length]
  ctx.save()
  ctx.font = `italic 400 ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '0.15px'
  const lines = wrap(ctx, quote, maxWidth)
  const lineHeight = size * 1.55
  // `y` is the last line, nearest the name; extra wraps step up, not into the letters.
  lines.forEach((line, i) => {
    const ly = y - (lines.length - 1 - i) * lineHeight
    ctx.globalAlpha = alpha
    ctx.shadowColor = 'rgba(0, 0, 8, 0.9)'
    ctx.shadowBlur = size * 0.7
    ctx.fillStyle = 'rgba(8, 12, 24, 0.75)'
    ctx.fillText(line, x, ly)
    ctx.globalAlpha = alpha * 0.92
    ctx.shadowColor = 'rgba(170, 198, 255, 0.45)'
    ctx.shadowBlur = size * 0.2
    ctx.fillStyle = 'rgb(214, 226, 255)'
    ctx.fillText(line, x, ly)
  })
  ctx.restore()
  const width = Math.min(maxWidth, size * 42)
  const top = y - (lines.length - 1) * lineHeight - size * 1.2
  return [x - width / 2, top, x + width / 2, y + size * 0.35]
}

/** A stable shuffle so the cycle is random but doesn't jump every frame. */
export function shuffledQuoteOrder(count: number) {
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
