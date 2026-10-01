import { smoothstep } from './astro'

export type VerseRect = [number, number, number, number]

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
const LIGHT = 1.2
const HOLD = 1.2
const FADE = 0.85
const GAP = 0.3
const SLOT = LIGHT + HOLD + FADE + GAP

/** Seconds from the start until every line has faded. The sky stays still until then. */
export function versePreludeSeconds(count: number) {
  if (count <= 0) return 0
  return count * SLOT - GAP
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return [text]
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

/**
 * One screen-fixed line at a time. It lights left to right, holds, then fades
 * before the next line. Nothing here follows the camera.
 */
export function drawCelestialVerses(
  ctx: CanvasRenderingContext2D,
  verses: string[],
  centerX: number,
  centerY: number,
  size: number,
  maxWidth: number,
  elapsed: number,
): VerseRect[] {
  if (verses.length === 0 || size < 8 || elapsed < 0) return []
  const index = Math.floor(elapsed / SLOT)
  if (index < 0 || index >= verses.length) return []
  const local = elapsed - index * SLOT
  if (local >= LIGHT + HOLD + FADE) return []

  const reveal = smoothstep(0, LIGHT, local)
  const block = 1 - smoothstep(LIGHT + HOLD, LIGHT + HOLD + FADE, local)
  const lineHeight = size * 1.85
  ctx.font = `italic 400 ${size}px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0.2px'

  const lines = wrap(ctx, verses[index], maxWidth)
  const top = centerY - ((lines.length - 1) * lineHeight) / 2
  return lines.map((line, row) => drawLine(ctx, line, centerX, top + row * lineHeight, size, reveal, block, elapsed))
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  size: number,
  reveal: number,
  block: number,
  elapsed: number,
): VerseRect {
  const width = ctx.measureText(text).width
  let cursor = centerX - width / 2
  let sparkX = cursor
  ctx.font = `italic 400 ${size}px ${FONT}`

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const chWidth = ctx.measureText(ch).width
    const along = (cursor - (centerX - width / 2)) / Math.max(1, width)
    const lit = smoothstep(along - 0.02, along + 0.1, reveal)
    if (lit > 0.02) {
      const shimmer = 0.92 + 0.08 * Math.sin(elapsed * 1.4 + i * 0.4)
      ctx.globalAlpha = block * lit
      ctx.shadowColor = 'rgba(0, 0, 8, 0.95)'
      ctx.shadowBlur = size * 0.85
      ctx.fillStyle = 'rgba(6, 10, 22, 0.85)'
      ctx.fillText(ch, cursor, y)
      ctx.globalAlpha = block * lit * shimmer
      ctx.shadowColor = 'rgba(186, 208, 255, 0.8)'
      ctx.shadowBlur = size * 0.3
      ctx.fillStyle = 'rgb(238, 244, 255)'
      ctx.fillText(ch, cursor, y)
    }
    if (lit < 0.98) sparkX = cursor + chWidth * 0.5
    cursor += chWidth
  }

  if (reveal > 0.04 && reveal < 0.98) drawStar(ctx, sparkX, y - size * 0.42, size * 0.16, block)
  return [centerX - width / 2 - 8, y - size * 1.2, centerX + width / 2 + 8, y + size * 0.45]
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = 'rgba(200, 220, 255, 0.95)'
  ctx.shadowBlur = s * 6
  ctx.fillStyle = 'rgb(255, 252, 245)'
  ctx.beginPath()
  ctx.moveTo(x, y - s * 2.4)
  ctx.quadraticCurveTo(x + s * 0.35, y - s * 0.35, x + s * 2.4, y)
  ctx.quadraticCurveTo(x + s * 0.35, y + s * 0.35, x, y + s * 2.4)
  ctx.quadraticCurveTo(x - s * 0.35, y + s * 0.35, x - s * 2.4, y)
  ctx.quadraticCurveTo(x - s * 0.35, y - s * 0.35, x, y - s * 2.4)
  ctx.fill()
  ctx.restore()
}
