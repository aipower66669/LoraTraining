import type { JobProgress } from '@shared/ipc/contract'
import { useEffect, useRef } from 'react'
import { formatProgressAction } from '@shared/progress-action'
import type { ProcessLogLine } from '../store/types'
import { progressPercent, TrainingMetrics } from './TrainingMetrics'

const STICK_BOTTOM_PX = 48

function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_BOTTOM_PX
}

export function ProgressPanel(props: {
  progress: JobProgress | null
  logs: ProcessLogLine[]
  onClearLogs?: () => void
}): React.JSX.Element {
  const p = props.progress
  const percent = progressPercent(p)
  const phase = formatProgressAction(p)
  const logRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = logRef.current
    if (!el || !stickToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [props.logs])

  return (
    <div className="progress-panel">
      <div className="progress-panel-top">
        <h2 className="section-title progress-phase-title" title={phase || undefined}>
          {phase || '\u00a0'}
        </h2>
        <div className="progress-bar" aria-label="Training progress">
          <span style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <TrainingMetrics progress={p} />
        </div>
      </div>
      <div className="progress-panel-log">
        <div className="progress-panel-log-header">
          <h3 className="section-title progress-panel-log-title">Live log</h3>
          {props.onClearLogs ? (
            <button
              type="button"
              className="progress-panel-clear-btn"
              onClick={() => props.onClearLogs?.()}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div
          ref={logRef}
          className="log-view log-view-fill"
          onScroll={(e) => {
            stickToBottom.current = isPinnedToBottom(e.currentTarget)
          }}
        >
          {props.logs.length === 0 ? (
            <div className="log-line log-line-stdout">No log lines yet.</div>
          ) : (
            props.logs.map((entry, i) => (
              <div
                key={i}
                className={`log-line log-line-${entry.stream === 'stderr' ? 'stderr' : 'stdout'}`}
              >
                {entry.line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
