import { useCallback, useEffect, useRef, useState } from 'react'
import { datasetMediaUrl, datasetThumbUrl } from '../media-url'
import { cycleIndex } from '../util/listKeyboard'
import { unwrap, useAppStore } from '../store'

type Column = { setIndex: number; label: string; activityAt: string }
type Cell = { setIndex: number; relativePath: string | null }
type Row = { model: string; collapsed: boolean; cells: Cell[] }
type Grid = { columns: Column[]; rows: Row[] }
/** Zoom position in the compare grid (row = model, col = stress set). */
type PreviewPos = { row: number; col: number }

const MODEL_MIME = 'application/x-lora-stress-compare-model'
const SET_MIME = 'application/x-lora-stress-compare-set'

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

function shortModelLabel(model: string): string {
  const base = model.replace(/\\/g, '/').split('/').pop() ?? model
  return base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '') || base
}

function cellPath(grid: Grid, row: number, col: number): string | null {
  return grid.rows[row]?.cells[col]?.relativePath ?? null
}

/**
 * Step along one axis, wrapping, until a cell with an image is found
 * (or back to start with none).
 */
function stepPreview(
  grid: Grid,
  pos: PreviewPos,
  axis: 'row' | 'col',
  delta: number
): PreviewPos | null {
  const len = axis === 'row' ? grid.rows.length : grid.columns.length
  if (len <= 0) return null
  let next = pos
  for (let i = 0; i < len; i++) {
    next =
      axis === 'row'
        ? { row: cycleIndex(len, next.row, delta), col: pos.col }
        : { row: pos.row, col: cycleIndex(len, next.col, delta) }
    if (cellPath(grid, next.row, next.col)) return next
  }
  return null
}

/** Full-screen models × stress-sets comparison grid. */
export function StressCompareOverview(props: {
  datasetId: string
  onClose: () => void
}): React.JSX.Element {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<PreviewPos | null>(null)
  const [dragModel, setDragModel] = useState<string | null>(null)
  const [dragSet, setDragSet] = useState<number | null>(null)
  const [dropModel, setDropModel] = useState<string | null>(null)
  const [dropSet, setDropSet] = useState<number | null>(null)
  const setError = useAppStore((s) => s.setError)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridRef = useRef(grid)
  const previewRef = useRef(preview)
  gridRef.current = grid
  previewRef.current = preview
  const lastWheelAt = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = unwrap(
        await window.loraTraining.comfy.getStressCompareGrid(props.datasetId)
      ) as Grid
      setGrid(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [props.datasetId, setError])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (
        event.type === 'stress-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void load()
      }
      if (
        event.type === 'stress-progress' &&
        event.payload.datasetId === props.datasetId &&
        (event.payload.status === 'done' ||
          event.payload.status === 'cancelled' ||
          event.payload.status === 'error' ||
          (event.payload.status === 'running' && event.payload.jobsCompleted > 0))
      ) {
        void load()
      }
    })
  }, [props.datasetId, load])

  useEffect(() => {
    const step = (axis: 'row' | 'col', delta: number): void => {
      const g = gridRef.current
      const pos = previewRef.current
      if (!g || !pos) return
      const next = stepPreview(g, pos, axis, delta)
      if (next) setPreview(next)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (previewRef.current) {
          setPreview(null)
          return
        }
        props.onClose()
        return
      }
      if (!previewRef.current) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        step('row', e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        step('col', e.key === 'ArrowRight' ? 1 : -1)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        setPreview(null)
      }
    }

    const onWheel = (e: WheelEvent): void => {
      if (!previewRef.current || e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      if (now - lastWheelAt.current < 80) return
      lastWheelAt.current = now
      // Vertical wheel → models (rows), matching up/down keys.
      step('row', e.deltaY > 0 ? 1 : -1)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [props])

  const persistLayout = useCallback(
    (patch: {
      modelOrder?: string[]
      setOrder?: number[]
      collapsedModels?: string[]
    }): void => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
      persistTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const next = unwrap(
              await window.loraTraining.comfy.updateStressCompareLayout(
                props.datasetId,
                patch
              )
            ) as Grid
            setGrid(next)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        })()
      }, 200)
    },
    [props.datasetId, setError]
  )

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [])

  const toggleCollapsed = (model: string): void => {
    if (!grid) return
    const nextRows = grid.rows.map((r) =>
      r.model === model ? { ...r, collapsed: !r.collapsed } : r
    )
    setGrid({ ...grid, rows: nextRows })
    persistLayout({
      collapsedModels: nextRows.filter((r) => r.collapsed).map((r) => r.model)
    })
  }

  const setAllCollapsed = (collapsed: boolean): void => {
    if (!grid) return
    const nextRows = grid.rows.map((r) => ({ ...r, collapsed }))
    setGrid({ ...grid, rows: nextRows })
    persistLayout({
      collapsedModels: collapsed ? nextRows.map((r) => r.model) : []
    })
  }

  const reorderModels = (fromModel: string, toModel: string): void => {
    if (!grid || fromModel === toModel) return
    const from = grid.rows.findIndex((r) => r.model === fromModel)
    const to = grid.rows.findIndex((r) => r.model === toModel)
    if (from < 0 || to < 0) return
    const nextRows = moveItem(grid.rows, from, to)
    setGrid({ ...grid, rows: nextRows })
    persistLayout({ modelOrder: nextRows.map((r) => r.model) })
  }

  const reorderSets = (fromIndex: number, toIndex: number): void => {
    if (!grid || fromIndex === toIndex) return
    const from = grid.columns.findIndex((c) => c.setIndex === fromIndex)
    const to = grid.columns.findIndex((c) => c.setIndex === toIndex)
    if (from < 0 || to < 0) return
    const nextCols = moveItem(grid.columns, from, to)
    const nextRows = grid.rows.map((row) => ({
      ...row,
      cells: moveItem(row.cells, from, to)
    }))
    setGrid({ columns: nextCols, rows: nextRows })
    persistLayout({ setOrder: nextCols.map((c) => c.setIndex) })
  }

  const previewPath =
    preview && grid ? cellPath(grid, preview.row, preview.col) : null
  const previewLabel =
    preview && grid && previewPath
      ? `${shortModelLabel(grid.rows[preview.row]!.model)} · ${grid.columns[preview.col]!.label}`
      : 'Preview'

  return (
    <div
      className="stress-compare-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Compare models"
    >
      <div className="stress-compare-panel">
        <header className="stress-compare-header">
          <h2 className="section-title" style={{ margin: 0 }}>
            Compare models
          </h2>
          <div className="stress-compare-header-actions">
            <button type="button" onClick={() => setAllCollapsed(true)} disabled={!grid?.rows.length}>
              Collapse all
            </button>
            <button type="button" onClick={() => setAllCollapsed(false)} disabled={!grid?.rows.length}>
              Expand all
            </button>
            <button type="button" className="primary" onClick={props.onClose}>
              Close
            </button>
          </div>
        </header>

        {loading && !grid ? (
          <p className="hint stress-compare-empty">Loading…</p>
        ) : !grid || grid.rows.length === 0 ? (
          <p className="hint stress-compare-empty">
            No stress-test images yet. Run a stress set to produce model previews.
          </p>
        ) : (
          <div className="stress-compare-scroll">
            <table className="stress-compare-table">
              <thead>
                <tr>
                  <th className="stress-compare-corner" scope="col">
                    Model
                  </th>
                  {grid.columns.map((col) => (
                    <th
                      key={col.setIndex}
                      scope="col"
                      className={
                        dropSet === col.setIndex
                          ? 'stress-compare-col-head drop-target'
                          : 'stress-compare-col-head'
                      }
                      draggable
                      onDragStart={(e) => {
                        setDragSet(col.setIndex)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData(SET_MIME, String(col.setIndex))
                        e.dataTransfer.setData('text/plain', col.label)
                      }}
                      onDragEnd={() => {
                        setDragSet(null)
                        setDropSet(null)
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(SET_MIME) && dragSet == null) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDropSet(col.setIndex)
                      }}
                      onDragLeave={() => {
                        if (dropSet === col.setIndex) setDropSet(null)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const raw =
                          e.dataTransfer.getData(SET_MIME) ||
                          (dragSet != null ? String(dragSet) : '')
                        const from = Number.parseInt(raw, 10)
                        setDropSet(null)
                        setDragSet(null)
                        if (Number.isFinite(from)) reorderSets(from, col.setIndex)
                      }}
                      title={`Drag to reorder · ${col.label}`}
                    >
                      <span className="stress-compare-col-label">{col.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row, rowIdx) => (
                  <tr
                    key={row.model}
                    className={row.collapsed ? 'stress-compare-row collapsed' : 'stress-compare-row'}
                  >
                    <th
                      scope="row"
                      className={
                        dropModel === row.model
                          ? 'stress-compare-row-head drop-target'
                          : 'stress-compare-row-head'
                      }
                      title={row.model}
                      draggable
                      onDragStart={(e) => {
                        setDragModel(row.model)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData(MODEL_MIME, row.model)
                        e.dataTransfer.setData('text/plain', row.model)
                      }}
                      onDragEnd={() => {
                        setDragModel(null)
                        setDropModel(null)
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(MODEL_MIME) && dragModel == null) {
                          return
                        }
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDropModel(row.model)
                      }}
                      onDragLeave={() => {
                        if (dropModel === row.model) setDropModel(null)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const from =
                          e.dataTransfer.getData(MODEL_MIME) || dragModel || ''
                        setDropModel(null)
                        setDragModel(null)
                        if (from) reorderModels(from, row.model)
                      }}
                    >
                      <div className="stress-compare-row-head-inner">
                        <button
                          type="button"
                          className="stress-compare-toggle"
                          aria-expanded={!row.collapsed}
                          title={row.collapsed ? 'Expand row' : 'Collapse row'}
                          onClick={() => toggleCollapsed(row.model)}
                        >
                          {row.collapsed ? '▸' : '▾'}
                        </button>
                        <span className="stress-compare-model-name">{shortModelLabel(row.model)}</span>
                      </div>
                    </th>
                    {row.collapsed
                      ? grid.columns.map((col) => (
                          <td key={col.setIndex} className="stress-compare-cell empty" />
                        ))
                      : row.cells.map((cell, colIdx) => (
                          <td key={cell.setIndex} className="stress-compare-cell">
                            {cell.relativePath ? (
                              <button
                                type="button"
                                className="stress-compare-thumb-btn"
                                onClick={() => setPreview({ row: rowIdx, col: colIdx })}
                                title={shortModelLabel(row.model)}
                              >
                                <img
                                  src={datasetThumbUrl(
                                    props.datasetId,
                                    cell.relativePath,
                                    cell.relativePath
                                  )}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  draggable={false}
                                />
                              </button>
                            ) : (
                              <span className="stress-compare-missing">—</span>
                            )}
                          </td>
                        ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewPath && preview && grid ? (
        <div
          className="image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={previewLabel}
          onClick={() => setPreview(null)}
        >
          <img
            className="image-preview-img"
            src={datasetMediaUrl(
              props.datasetId,
              previewPath,
              `${preview.row}:${preview.col}:${previewPath}`
            )}
            alt={previewLabel}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
