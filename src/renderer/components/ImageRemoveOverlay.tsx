import { useEffect, useRef, useState, type JSX } from 'react'
import { Eraser, Paintbrush, Square, X } from 'lucide-react'
import { runLamaInpaint, type LamaProgress } from '../lib/lamaInpaint'

type Tool = 'brush' | 'rect'

type Pt = { x: number; y: number }

const LAST_REMOVE_TOOL_KEY = 'loraTraining.lastImageRemoveTool'

function readLastRemoveTool(): Tool {
  try {
    const v = localStorage.getItem(LAST_REMOVE_TOOL_KEY)
    if (v === 'brush' || v === 'rect') return v
  } catch {
    /* ignore */
  }
  return 'brush'
}

function writeLastRemoveTool(tool: Tool): void {
  try {
    localStorage.setItem(LAST_REMOVE_TOOL_KEY, tool)
  } catch {
    /* ignore */
  }
}

export function ImageRemoveOverlay(props: {
  imageSrc: string
  busy: boolean
  onBusy: (busy: boolean) => void
  onApplied: (dataUrl: string) => void
  onCancel: () => void
  onStatus: (msg: string) => void
  onError: (msg: string) => void
}): JSX.Element {
  const { imageSrc, busy, onBusy, onApplied, onCancel, onStatus, onError } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<Pt | null>(null)
  const rectOrigin = useRef<Pt | null>(null)

  const [tool, setTool] = useState<Tool>(() => readLastRemoveTool())
  const [brush, setBrush] = useState(28)
  const [erase, setErase] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState('Paint or drag a box over what to remove, then Apply')
  /** Live marquee in canvas pixel coords (null when idle). */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  )

  function selectTool(next: Tool): void {
    setTool(next)
    writeLastRemoveTool(next)
  }

  useEffect(() => {
    const img = imgRef.current
    const canvas = maskRef.current
    if (!img || !canvas) return
    const sync = (): void => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return
      setImgSize({ w, h })
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    if (img.complete) sync()
    else img.addEventListener('load', sync)
    return () => img.removeEventListener('load', sync)
  }, [imageSrc])

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Pt {
    const canvas = maskRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height
    return { x, y }
  }

  function stroke(from: Pt | null, to: Pt): void {
    const canvas = maskRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brush * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width))
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = 'rgba(255, 64, 64, 0.85)'
    }
    ctx.beginPath()
    if (from) ctx.moveTo(from.x, from.y)
    else ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  function fillRectMask(x0: number, y0: number, x1: number, y1: number): void {
    const canvas = maskRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    const left = Math.max(0, Math.min(x0, x1))
    const top = Math.max(0, Math.min(y0, y1))
    const w = Math.min(canvas.width, Math.max(x0, x1)) - left
    const h = Math.min(canvas.height, Math.max(y0, y1)) - top
    if (w < 1 || h < 1) return
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(255, 64, 64, 0.85)'
    }
    ctx.fillRect(left, top, w, h)
  }

  function clearMask(): void {
    const canvas = maskRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setMarquee(null)
    setStatus('Mask cleared — paint or box again')
  }

  async function apply(): Promise<void> {
    const canvas = maskRef.current
    if (!canvas || busy) return
    onBusy(true)
    setStatus('Working…')
    try {
      const dataUrl = await runLamaInpaint({
        imageSrc,
        maskCanvas: canvas,
        onProgress: (p: LamaProgress) => {
          setStatus(p.message)
          onStatus(p.message)
        }
      })
      onApplied(dataUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(msg)
      onError(msg)
    } finally {
      onBusy(false)
    }
  }

  const marqueeStyle =
    marquee && imgSize
      ? {
          left: `${(Math.min(marquee.x0, marquee.x1) / imgSize.w) * 100}%`,
          top: `${(Math.min(marquee.y0, marquee.y1) / imgSize.h) * 100}%`,
          width: `${(Math.abs(marquee.x1 - marquee.x0) / imgSize.w) * 100}%`,
          height: `${(Math.abs(marquee.y1 - marquee.y0) / imgSize.h) * 100}%`
        }
      : undefined

  return (
    <div className="image-remove-overlay" role="dialog" aria-label="Remove from image">
      <div className="image-remove-toolbar">
        <span className="image-remove-title">Remove</span>
        <button
          type="button"
          className={`icon-btn${tool === 'brush' ? ' primary' : ''}`}
          title="Brush"
          aria-label="Brush"
          disabled={busy}
          onClick={() => selectTool('brush')}
        >
          <Paintbrush size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`icon-btn${tool === 'rect' ? ' primary' : ''}`}
          title="Rectangular marquee"
          aria-label="Rectangular marquee"
          disabled={busy}
          onClick={() => selectTool('rect')}
        >
          <Square size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        {tool === 'brush' ? (
          <label className="image-remove-brush">
            Size
            <input
              type="range"
              min={8}
              max={96}
              value={brush}
              disabled={busy}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
          </label>
        ) : null}
        <button
          type="button"
          className={`icon-btn${!erase ? ' primary' : ''}`}
          title="Add to mask"
          aria-label="Add to mask"
          disabled={busy}
          onClick={() => setErase(false)}
        >
          Add
        </button>
        <button
          type="button"
          className={`icon-btn${erase ? ' primary' : ''}`}
          title="Erase from mask"
          aria-label="Erase from mask"
          disabled={busy}
          onClick={() => setErase(true)}
        >
          <Eraser size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" disabled={busy} onClick={clearMask}>
          Clear
        </button>
        <span className="image-remove-status mono">{status}</span>
        <span className="toolbar-spacer" style={{ flex: 1 }} />
        <button type="button" className="primary" disabled={busy || !imgSize} onClick={() => void apply()}>
          Apply remove
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Cancel remove"
          aria-label="Cancel remove"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="image-remove-stage" ref={wrapRef}>
        <div className="image-remove-frame">
          <img ref={imgRef} src={imageSrc} alt="" draggable={false} className="image-remove-img" />
          <canvas
            ref={maskRef}
            className={`image-remove-mask${tool === 'rect' ? ' is-marquee' : ''}`}
            onPointerDown={(e) => {
              if (busy) return
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              const p = canvasPoint(e)
              if (tool === 'rect') {
                rectOrigin.current = p
                setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
                return
              }
              last.current = p
              stroke(null, p)
            }}
            onPointerMove={(e) => {
              if (!drawing.current || busy) return
              const p = canvasPoint(e)
              if (tool === 'rect' && rectOrigin.current) {
                setMarquee({
                  x0: rectOrigin.current.x,
                  y0: rectOrigin.current.y,
                  x1: p.x,
                  y1: p.y
                })
                return
              }
              stroke(last.current, p)
              last.current = p
            }}
            onPointerUp={(e) => {
              if (tool === 'rect' && rectOrigin.current && drawing.current) {
                const p = canvasPoint(e)
                fillRectMask(rectOrigin.current.x, rectOrigin.current.y, p.x, p.y)
              }
              drawing.current = false
              last.current = null
              rectOrigin.current = null
              setMarquee(null)
            }}
            onPointerCancel={() => {
              drawing.current = false
              last.current = null
              rectOrigin.current = null
              setMarquee(null)
            }}
          />
          {marqueeStyle ? (
            <div
              className={`image-remove-marquee${erase ? ' is-erase' : ''}`}
              style={marqueeStyle}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
