export type Label = {
  text: string
  x: number
  y: number
  color: string
  font: string
  /** Offset from the anchor point, in CSS pixels. */
  dx?: number
  dy?: number
  align?: CanvasTextAlign
  /** Lower draws first and wins overlaps. */
  priority: number
  letterSpacing?: string
}

/** 2D canvas overlay for text labels, with greedy overlap rejection. */
export class LabelLayer {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 1
  private height = 1
  private pixelRatio = 1

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'sky-labels'
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.width = width
    this.height = height
    this.pixelRatio = pixelRatio
    this.canvas.width = Math.round(width * pixelRatio)
    this.canvas.height = Math.round(height * pixelRatio)
  }

  /**
   * `overlay` draws free-form content first and returns the rectangles it
   * covered, so ordinary labels avoid them.
   */
  draw(
    labels: Label[],
    marker: { x: number; y: number } | null,
    overlay?: (ctx: CanvasRenderingContext2D) => [number, number, number, number][],
  ) {
    const { ctx } = this
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
    ctx.shadowBlur = 4

    const placed: [number, number, number, number][] = []
    if (marker) {
      ctx.strokeStyle = 'rgba(255, 214, 140, 0.95)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4
        ctx.beginPath()
        ctx.arc(marker.x, marker.y, 13, a - 0.45, a + 0.45)
        ctx.stroke()
      }
      placed.push([marker.x - 14, marker.y - 14, marker.x + 14, marker.y + 14])
    }
    if (overlay) {
      ctx.save()
      placed.push(...overlay(ctx))
      ctx.restore()
    }

    labels.sort((a, b) => a.priority - b.priority)
    for (const label of labels) {
      ctx.font = label.font
      ctx.letterSpacing = label.letterSpacing ?? '0px'
      const w = ctx.measureText(label.text).width
      const h = 14
      const align = label.align ?? 'left'
      const x = label.x + (label.dx ?? 0)
      const y = label.y + (label.dy ?? 0)
      const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
      const rect: [number, number, number, number] = [left - 3, y - h / 2 - 2, left + w + 3, y + h / 2 + 2]
      if (rect[2] < 0 || rect[0] > this.width || rect[3] < 0 || rect[1] > this.height) continue
      if (placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue
      placed.push(rect)
      ctx.textAlign = align
      ctx.fillStyle = label.color
      ctx.fillText(label.text, x, y)
    }
  }

  dispose() {
    this.canvas.remove()
  }
}
