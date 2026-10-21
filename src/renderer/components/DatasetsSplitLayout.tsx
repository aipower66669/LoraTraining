import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'lora-training:datasets-split'

export type DatasetsSplitState = {
  libraryPx: number
  middlePx: number
  detailsPx: number
}

const DEFAULT_SPLIT: DatasetsSplitState = {
  libraryPx: 340,
  middlePx: 420,
  detailsPx: 300
}

function loadSplit(): DatasetsSplitState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SPLIT
    const parsed = JSON.parse(raw) as Partial<DatasetsSplitState>
    return {
      libraryPx: clamp(parsed.libraryPx ?? DEFAULT_SPLIT.libraryPx, 180, 900),
      middlePx: clamp(parsed.middlePx ?? DEFAULT_SPLIT.middlePx, 200, 1000),
      detailsPx: clamp(parsed.detailsPx ?? DEFAULT_SPLIT.detailsPx, 220, 900)
    }
  } catch {
    return DEFAULT_SPLIT
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function DatasetsSplitLayout(props: {
  library: ReactNode
  middle: ReactNode
  details: ReactNode
}): React.JSX.Element {
  const [split, setSplit] = useState<DatasetsSplitState>(() => loadSplit())
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    which: 'library' | 'details'
    startX: number
    startLibrary: number
    startMiddle: number
    startDetails: number
  } | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(split))
  }, [split])

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root) return
    const dx = e.clientX - drag.startX
    const total = root.getBoundingClientRect().width
    const gutter = 6
    const minLib = 180
    const minMid = 200
    const minDet = 220
    const maxLib = Math.max(minLib, total - gutter * 2 - minMid - minDet)
    const maxDet = Math.max(minDet, total - gutter * 2 - minLib - minMid)

    if (drag.which === 'library') {
      const libraryPx = clamp(drag.startLibrary + dx, minLib, maxLib)
      setSplit((s) => {
        const used = libraryPx + s.detailsPx + gutter * 2
        let middlePx = s.middlePx
        if (total - used < minMid) {
          middlePx = Math.max(minMid, total - libraryPx - s.detailsPx - gutter * 2)
        }
        return { libraryPx, middlePx, detailsPx: s.detailsPx }
      })
    } else {
      // Dragging the middle↔details gutter: grow/shrink the details pane.
      const detailsPx = clamp(drag.startDetails - dx, minDet, maxDet)
      setSplit((s) => {
        const used = s.libraryPx + detailsPx + gutter * 2
        let middlePx = s.middlePx
        if (total - used < minMid) {
          middlePx = Math.max(minMid, total - s.libraryPx - detailsPx - gutter * 2)
        }
        return { libraryPx: s.libraryPx, middlePx, detailsPx }
      })
    }
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
    document.body.classList.remove('is-resizing')
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endDrag)
  }, [onPointerMove])

  function startDrag(which: 'library' | 'details', e: React.PointerEvent): void {
    e.preventDefault()
    dragRef.current = {
      which,
      startX: e.clientX,
      startLibrary: split.libraryPx,
      startMiddle: split.middlePx,
      startDetails: split.detailsPx
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
  }

  // Always three panes — never collapse to a full-width library (layout shift is jarring).
  return (
    <div className="datasets-split" ref={rootRef}>
      <div className="datasets-pane" style={{ width: split.libraryPx, flex: '0 0 auto' }}>
        {props.library}
      </div>
      <div
        className="datasets-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize library pane"
        onPointerDown={(e) => startDrag('library', e)}
      />
      <div className="datasets-pane" style={{ width: split.middlePx, flex: '1 1 auto', minWidth: 200 }}>
        {props.middle}
      </div>
      <div
        className="datasets-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details pane"
        onPointerDown={(e) => startDrag('details', e)}
      />
      <div
        className="datasets-pane datasets-pane-details"
        style={{ width: split.detailsPx, flex: '0 0 auto' }}
      >
        {props.details}
      </div>
    </div>
  )
}
