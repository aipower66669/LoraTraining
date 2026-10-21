import { useEffect, useRef } from 'react'
import type { CaptionRunProgress } from '@shared/caption-progress'
import { JobBreadcrumb } from './JobBreadcrumb'
import { useAppStore } from '../store'

function modeLabel(mode: string): string {
  if (mode === 'overwrite') return 'overwrite'
  if (mode === 'append') return 'append'
  return 'missing only'
}

/**
 * Popover listing remaining caption work: active job’s pending images,
 * then later dataset jobs still waiting in the serial queue.
 */
export function CaptionQueuePopover(props: {
  open: boolean
  progress: CaptionRunProgress
  onClose: () => void
  /** Anchor element (progress bar) — popover positions above the status bar. */
  anchorRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const { open, progress, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  const datasets = useAppStore((s) => s.datasets)
  const categories = useAppStore((s) => s.categories)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (panelRef.current?.contains(t)) return
      if (props.anchorRef.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose, props.anchorRef])

  useEffect(() => {
    if (!open) return
    if (progress.status !== 'running') onClose()
  }, [open, progress.status, onClose])

  if (!open) return null

  const activeDs = datasets.find((d) => d.id === progress.datasetId)
  const activeCategoryName =
    activeDs != null
      ? (categories.find((c) => c.id === activeDs.categoryId)?.name ?? null)
      : null
  const activeName = activeDs?.name ?? progress.datasetId
  const remaining = progress.remainingFileNames ?? []
  const pending = progress.pendingJobSummaries ?? []
  const current = progress.currentFileName
  const crumbTitle = activeCategoryName
    ? `${activeCategoryName} \\ ${activeName}`
    : activeName

  return (
    <div
      ref={panelRef}
      className="caption-queue-popover"
      role="dialog"
      aria-label="Caption queue"
    >
      <div className="caption-queue-header">
        <strong>Caption queue</strong>
        <span className="hint">
          {progress.completed}/{progress.total}
          {(progress.pendingJobs ?? 0) > 0 ? ` · ${progress.pendingJobs} job(s) waiting` : ''}
        </span>
      </div>

      <div className="caption-queue-section">
        <div className="caption-queue-section-title" title={crumbTitle}>
          Now ·{' '}
          <JobBreadcrumb
            className="caption-queue-crumb"
            categoryName={activeCategoryName}
            datasetName={activeName}
          />
          <span className="hint"> ({remaining.length} left)</span>
        </div>
        {remaining.length === 0 ? (
          <p className="hint caption-queue-empty">No remaining images in this job</p>
        ) : (
          <ul className="caption-queue-list">
            {remaining.map((fileName) => {
              const isCurrent = current != null && fileName === current
              const rowTitle = `${crumbTitle} \\ ${fileName}`
              return (
                <li
                  key={fileName}
                  className={isCurrent ? 'caption-queue-item current' : 'caption-queue-item'}
                  title={rowTitle}
                >
                  {isCurrent ? <span className="caption-queue-badge">now</span> : null}
                  <JobBreadcrumb
                    className="caption-queue-crumb"
                    categoryName={activeCategoryName}
                    datasetName={activeName}
                  />
                  <span className="caption-queue-sep" aria-hidden="true">
                    {' \\ '}
                  </span>
                  <span className="caption-queue-name mono">{fileName}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {pending.length > 0 ? (
        <div className="caption-queue-section">
          <div className="caption-queue-section-title">Waiting jobs</div>
          <ul className="caption-queue-jobs">
            {pending.map((job) => {
              const ds = datasets.find((d) => d.id === job.datasetId)
              const name = ds?.name ?? job.datasetId
              const catName = ds
                ? (categories.find((c) => c.id === ds.categoryId)?.name ?? null)
                : null
              return (
                <li key={job.runId} className="caption-queue-job">
                  <JobBreadcrumb
                    className="caption-queue-crumb"
                    categoryName={catName}
                    datasetName={name}
                  />
                  <span className="hint">
                    {job.plannedTotal} image{job.plannedTotal === 1 ? '' : 's'} ·{' '}
                    {modeLabel(job.mode)}
                    {job.prependTrigger ? ' · prepend' : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
