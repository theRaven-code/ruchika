export type CountdownPart = { value: number; label: string }
export type Rect = [number, number, number, number]

const ROLL_MS = 520
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

type Slot = { current: string; previous: string; changedAt: number }

/**
 * Draws the countdown as a row of fixed-width digit cells. A changing digit
 * rolls up out of its cell while the new one rolls in from below, and the
 * sparkles between units pulse once per second.
 */
export class CountdownRenderer {
  private slots = new Map<string, Slot>()
  private lastSeconds = -1
  private lastTick = 0

  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    parts: CountdownPart[],
    caption: string,
    alpha: number,
    now: number,
  ): Rect {
    const cell = size * 0.62
    const gap = size * 0.95
    const labelSize = Math.max(9, size * 0.2)
    const widths = parts.map((p) => Math.max(2, String(p.value).length) * cell)
    const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)
    const seconds = parts.at(-1)?.value ?? 0
    if (seconds !== this.lastSeconds) {
      this.lastSeconds = seconds
      this.lastTick = now
    }
    const pulse = Math.exp(-(now - this.lastTick) / 240)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    let cursor = x - total / 2
    parts.forEach((part, unit) => {
      const text = String(part.value).padStart(2, '0')
      for (let i = 0; i < text.length; i++) {
        const slot = this.slot(`${unit}:${text.length - 1 - i}`, text[i], now)
        this.drawDigit(ctx, slot, cursor + cell * (i + 0.5), y, size, cell, alpha, now)
      }

      const spacing = labelSize * 0.32
      ctx.globalAlpha = alpha * 0.75
      ctx.shadowColor = 'rgba(120, 160, 255, 0.5)'
      ctx.shadowBlur = 6
      ctx.fillStyle = 'rgb(190, 208, 255)'
      ctx.font = `600 ${labelSize}px ${FONT}`
      ctx.letterSpacing = `${spacing}px`
      ctx.fillText(part.label.toUpperCase(), cursor + widths[unit] / 2 + spacing / 2, y + labelSize * 2.1)

      cursor += widths[unit]
      if (unit < parts.length - 1) {
        this.drawSparkle(ctx, cursor + gap / 2, y - size * 0.36, size * 0.075, pulse, alpha)
        cursor += gap
      }
    })

    if (caption) {
      ctx.globalAlpha = alpha * 0.7
      ctx.shadowBlur = 8
      ctx.fillStyle = 'rgb(205, 218, 255)'
      ctx.font = `italic 400 ${labelSize * 1.05}px ${FONT}`
      ctx.letterSpacing = '0.5px'
      ctx.fillText(caption, x, y + labelSize * 4.6)
    }
    return [x - total / 2 - gap, y - size * 1.1, x + total / 2 + gap, y + labelSize * 5.5]
  }

  /** The birthday itself: a glowing greeting in place of the digits. */
  drawCelebration(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    title: string,
    caption: string,
    alpha: number,
    now: number,
  ): Rect {
    const breathe = 0.5 + 0.5 * Math.sin(now / 900)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = alpha
    ctx.shadowColor = `rgba(255, 200, 150, ${0.5 + 0.3 * breathe})`
    ctx.shadowBlur = size * (0.3 + 0.2 * breathe)
    ctx.fillStyle = 'rgb(255, 244, 232)'
    ctx.font = `300 ${size * 0.95}px ${FONT}`
    ctx.letterSpacing = `${size * 0.04}px`
    ctx.fillText(title, x, y)
    const width = ctx.measureText(title).width
    ;[-1, 1].forEach((side) =>
      this.drawSparkle(ctx, x + side * (width / 2 + size * 0.45), y - size * 0.35, size * 0.09, breathe, alpha),
    )
    if (caption) {
      ctx.globalAlpha = alpha * 0.75
      ctx.shadowBlur = 8
      ctx.fillStyle = 'rgb(225, 228, 255)'
      ctx.font = `italic 400 ${size * 0.28}px ${FONT}`
      ctx.letterSpacing = '0.5px'
      ctx.fillText(caption, x, y + size * 0.75)
    }
    return [x - width / 2 - size, y - size * 1.1, x + width / 2 + size, y + size]
  }

  private slot(key: string, char: string, now: number) {
    let slot = this.slots.get(key)
    if (!slot) {
      slot = { current: char, previous: '', changedAt: now }
      this.slots.set(key, slot)
    } else if (slot.current !== char) {
      slot.previous = slot.current
      slot.current = char
      slot.changedAt = now
    }
    return slot
  }

  private drawDigit(
    ctx: CanvasRenderingContext2D,
    slot: Slot,
    cx: number,
    y: number,
    size: number,
    cell: number,
    alpha: number,
    now: number,
  ) {
    const t = Math.min(1, (now - slot.changedAt) / ROLL_MS)
    const e = easeOut(t)
    const travel = size * 0.8
    ctx.save()
    ctx.beginPath()
    ctx.rect(cx - cell / 2 - 4, y - size * 1.05, cell + 8, size * 1.35)
    ctx.clip()
    ctx.font = `300 ${size}px ${FONT}`
    ctx.letterSpacing = '0px'
    ctx.fillStyle = 'rgb(240, 245, 255)'
    ctx.shadowColor = 'rgba(140, 175, 255, 0.7)'
    if (t < 1 && slot.previous) {
      ctx.globalAlpha = alpha * (1 - e)
      ctx.shadowBlur = size * 0.3
      ctx.fillText(slot.previous, cx, y - e * travel)
    }
    // The incoming digit arrives with a brief extra glow.
    ctx.globalAlpha = alpha * e
    ctx.shadowBlur = size * (0.3 + 0.5 * (1 - e))
    ctx.fillText(slot.current, cx, y + (1 - e) * travel)
    ctx.restore()
  }

  private drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, glow: number, alpha: number) {
    const reach = s * (2 + 1.2 * glow)
    const waist = s * 0.35
    ctx.globalAlpha = alpha * (0.45 + 0.55 * glow)
    ctx.shadowColor = 'rgba(170, 200, 255, 0.9)'
    ctx.shadowBlur = s * (2 + 4 * glow)
    ctx.fillStyle = 'rgb(225, 235, 255)'
    ctx.beginPath()
    ctx.moveTo(cx, cy - reach)
    ctx.quadraticCurveTo(cx + waist, cy - waist, cx + reach, cy)
    ctx.quadraticCurveTo(cx + waist, cy + waist, cx, cy + reach)
    ctx.quadraticCurveTo(cx - waist, cy + waist, cx - reach, cy)
    ctx.quadraticCurveTo(cx - waist, cy - waist, cx, cy - reach)
    ctx.fill()
  }
}
