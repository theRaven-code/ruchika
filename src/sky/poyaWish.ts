import { smoothstep } from './astro'

export type WishRect = [number, number, number, number]

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
const LIGHT = 1.6
const HOLD = 4.2
const FADE = 1.2
const SLOT = LIGHT + HOLD + FADE + 0.6
/** Text wider than this arc (radians) moves out to a larger circle instead of wrapping round the Moon. */
const MAX_SPAN = (150 * Math.PI) / 180

/**
 * Writes `text` centred over the top of a circle, upright and reading left to
 * right. `paint` draws one character at the origin, given how far along the
 * text it is (0..1). Returns the bounds of the arc.
 */
function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  minRadius: number,
  size: number,
  spacing: number,
  paint: (ch: string, along: number) => void,
): WishRect {
  const chars = [...text]
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((sum, w) => sum + w, 0) + spacing * (chars.length - 1)
  const radius = Math.max(minRadius, total / MAX_SPAN)
  let walked = 0
  chars.forEach((ch, i) => {
    const angle = -Math.PI / 2 + (walked + widths[i] / 2 - total / 2) / radius
    ctx.save()
    ctx.translate(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
    ctx.rotate(angle + Math.PI / 2)
    paint(ch, walked / total)
    ctx.restore()
    walked += widths[i] + spacing
  })
  const reach = Math.sin(Math.min(total / radius / 2, Math.PI / 2)) * radius
  return [cx - reach - size, cy - radius - size * 1.2, cx + reach + size, cy - Math.sqrt(radius * radius - reach * reach) + size * 0.4]
}

/**
 * A faint ring around the full Moon with the Poya's name over it. While
 * `elapsed` runs through them, the wishes are written one at a time on a wider
 * arc above, each lighting left to right and fading before the next.
 */
export function drawPoyaWish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ringRadius: number,
  title: string,
  wishes: string[],
  elapsed: number,
): WishRect[] {
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 232, 196, 0.2)'
  ctx.lineWidth = 1
  ctx.shadowColor = 'rgba(255, 220, 170, 0.8)'
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '0px'
  const titleSize = Math.min(11, Math.max(9, ringRadius * 0.08))
  ctx.font = `600 ${titleSize}px ${FONT}`
  ctx.shadowColor = 'rgba(0, 0, 8, 0.9)'
  ctx.shadowBlur = 5
  ctx.fillStyle = 'rgba(255, 226, 168, 0.78)'
  const rects = [
    arcText(ctx, title.toUpperCase(), x, y, ringRadius + 7, titleSize, titleSize * 0.28, (ch) => ctx.fillText(ch, 0, 0)),
  ]

  const index = Math.floor(elapsed / SLOT)
  const local = elapsed - index * SLOT
  if (elapsed >= 0 && index < wishes.length && local < LIGHT + HOLD + FADE) {
    const size = Math.min(16, Math.max(12, ringRadius * 0.11))
    const reveal = smoothstep(0, LIGHT, local)
    const fade = 1 - smoothstep(LIGHT + HOLD, LIGHT + HOLD + FADE, local)
    ctx.font = `italic 400 ${size}px ${FONT}`
    const minRadius = ringRadius + 7 + titleSize + size * 0.9
    rects.push(
      arcText(ctx, wishes[index], x, y, minRadius, size, 0.2, (ch, along) => {
        const alpha = fade * smoothstep(along - 0.02, along + 0.1, reveal)
        if (alpha < 0.02) return
        ctx.globalAlpha = alpha
        ctx.shadowColor = 'rgba(0, 0, 8, 0.95)'
        ctx.shadowBlur = size * 0.85
        ctx.fillStyle = 'rgba(6, 10, 22, 0.7)'
        ctx.fillText(ch, 0, 0)
        ctx.shadowColor = 'rgba(255, 226, 190, 0.7)'
        ctx.shadowBlur = size * 0.35
        ctx.fillStyle = 'rgb(255, 248, 236)'
        ctx.fillText(ch, 0, 0)
      }),
    )
  }
  ctx.restore()
  return rects
}
