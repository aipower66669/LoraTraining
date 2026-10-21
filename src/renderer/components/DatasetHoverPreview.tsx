import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DatasetSummary } from '@shared/ipc/contract'
import { datasetThumbUrl } from '../media-url'

const HOVER_DELAY_MS = 1000
/** Thumb edge length (px); card is slightly taller with the name. */
const PREVIEW_SIZE = 240
const CURSOR_OFFSET = 16

export type DatasetHoverPreviewState = {
  datasetId: string
  name: string
  coverFileName: string | null
  updatedAt: string
  x: number
  y: number
}

function clampNearCursor(clientX: number, clientY: number): { x: number; y: number } {
  const cardH = PREVIEW_SIZE + 36
  let x = clientX + CURSOR_OFFSET
  let y = clientY + CURSOR_OFFSET
  if (x + PREVIEW_SIZE > window.innerWidth - 8) {
    x = Math.max(8, clientX - PREVIEW_SIZE - CURSOR_OFFSET)
  }
  if (y + cardH > window.innerHeight - 8) {
    y = Math.max(8, clientY - cardH - CURSOR_OFFSET)
  }
  return { x, y }
}

/**
 * Debounced (~1s) hover preview of a dataset cover — replaces long `title` tooltips
 * on Jobs / Queue rows. Appears near the mouse cursor.
 */
export function useDatasetHoverPreview(delayMs = HOVER_DELAY_MS): {
  preview: DatasetHoverPreviewState | null
  bind: (dataset: Pick<DatasetSummary, 'id' | 'name' | 'coverFileName' | 'updatedAt'> | null | undefined) => {
    onMouseEnter: (e: React.MouseEvent) => void
    onMouseMove: (e: React.MouseEvent) => void
    onMouseLeave: () => void
  }
  clear: () => void
} {
  const [preview, setPreview] = useState<DatasetHoverPreviewState | null>(null)
  const timerRef = useRef<number | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const pendingRef = useRef<Pick<
    DatasetSummary,
    'id' | 'name' | 'coverFileName' | 'updatedAt'
  > | null>(null)

  const clear = (): void => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = null
    setPreview(null)
  }

  useEffect(() => {
    const onScroll = (): void => clear()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('mousedown', clear)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousedown', clear)
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  function showPending(): void {
    const ds = pendingRef.current
    if (!ds) return
    const { x, y } = clampNearCursor(pointerRef.current.x, pointerRef.current.y)
    setPreview({
      datasetId: ds.id,
      name: ds.name,
      coverFileName: ds.coverFileName,
      updatedAt: ds.updatedAt,
      x,
      y
    })
  }

  function bind(dataset: Pick<DatasetSummary, 'id' | 'name' | 'coverFileName' | 'updatedAt'> | null | undefined) {
    return {
      onMouseEnter: (e: React.MouseEvent) => {
        if (timerRef.current != null) window.clearTimeout(timerRef.current)
        pointerRef.current = { x: e.clientX, y: e.clientY }
        if (!dataset) {
          pendingRef.current = null
          setPreview(null)
          return
        }
        pendingRef.current = dataset
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          showPending()
        }, delayMs)
      },
      onMouseMove: (e: React.MouseEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
        // Keep the card glued to the cursor once visible.
        setPreview((prev) => {
          if (!prev) return prev
          const { x, y } = clampNearCursor(e.clientX, e.clientY)
          if (prev.x === x && prev.y === y) return prev
          return { ...prev, x, y }
        })
      },
      onMouseLeave: () => {
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        pendingRef.current = null
        setPreview(null)
      }
    }
  }

  return { preview, bind, clear }
}

/** Floating dataset cover card (portal). */
export function DatasetHoverPreviewCard(props: {
  preview: DatasetHoverPreviewState | null
}): React.JSX.Element | null {
  if (!props.preview || typeof document === 'undefined') return null
  const { preview } = props
  const cover = preview.coverFileName
    ? datasetThumbUrl(preview.datasetId, preview.coverFileName, preview.updatedAt)
    : null

  return createPortal(
    <div
      className="dataset-hover-preview"
      style={{ left: preview.x, top: preview.y, width: PREVIEW_SIZE }}
      role="tooltip"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="dataset-hover-preview-thumb">
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <div className="dataset-hover-preview-empty">No cover</div>
        )}
      </div>
      <div className="dataset-hover-preview-name">{preview.name}</div>
    </div>,
    document.body
  )
}
