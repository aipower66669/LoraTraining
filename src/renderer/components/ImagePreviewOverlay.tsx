import { useEffect, useRef } from 'react'
import { cycleIndex } from '../util/listKeyboard'
import { datasetMediaUrl } from '../media-url'

export function ImagePreviewOverlay(props: {
  datasetId: string
  fileName: string
  /** Ordered basenames in the dataset grid (cycle order). */
  fileNames: string[]
  onClose: () => void
  /** Move preview + selection to another image. */
  onNavigate: (fileName: string) => void
  /** Del = recycle; Shift+Del = permanent. Viewer stays open on the next image. */
  onDelete: (permanent: boolean) => void
}): React.JSX.Element {
  const src = datasetMediaUrl(props.datasetId, props.fileName, Date.now())
  const propsRef = useRef(props)
  propsRef.current = props
  const lastWheelAt = useRef(0)

  useEffect(() => {
    const step = (delta: number): void => {
      const p = propsRef.current
      if (p.fileNames.length <= 1) return
      const idx = p.fileNames.indexOf(p.fileName)
      const nextIdx = cycleIndex(p.fileNames.length, idx, delta)
      const next = p.fileNames[nextIdx]
      if (next && next !== p.fileName) p.onNavigate(next)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        propsRef.current.onClose()
        return
      }
      if (e.key === 'Delete') {
        e.preventDefault()
        e.stopPropagation()
        propsRef.current.onDelete(e.shiftKey)
        return
      }
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown'
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      step(e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
    }

    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      // Cooldown so trackpad flicks don't skip half the dataset.
      if (now - lastWheelAt.current < 80) return
      lastWheelAt.current = now
      step(e.deltaY > 0 ? 1 : -1)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={props.fileName}
      onClick={props.onClose}
    >
      <img
        className="image-preview-img"
        src={src}
        alt={props.fileName}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
