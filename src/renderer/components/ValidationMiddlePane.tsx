import { useCallback, useEffect, useState } from 'react'
import type { CheckpointEntry, DatasetOutputs } from '@shared/ipc/contract'
import {
  countSetPreviewProgress,
  formatSetPreviewProgress,
  type SetPreviewProgress
} from '@shared/validation-progress'
import { unwrap, useAppStore } from '../store'
import { MarkDatasetDoneFooter } from './MarkDatasetDoneFooter'

type SetTab = { index: number; label: string }

/** Lightweight Validate middle pane — set preview progress + Mark as Done. */
export function ValidationMiddlePane(props: {
  datasetId: string
}): React.JSX.Element {
  const [sets, setSets] = useState<SetTab[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const setError = useAppStore((s) => s.setError)

  const refreshProgress = useCallback(async (): Promise<void> => {
    if (!props.datasetId) return
    try {
      const [setList, outputs] = await Promise.all([
        window.loraTraining.comfy
          .listValidationSets(props.datasetId)
          .then((r) => unwrap(r) as SetTab[]),
        window.loraTraining.datasets
          .listOutputs(props.datasetId)
          .then((r) => unwrap(r) as DatasetOutputs)
      ])
      setSets(setList.map((s) => ({ index: s.index, label: s.label })))
      setCheckpoints(outputs.checkpoints)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [props.datasetId, setError])

  useEffect(() => {
    void refreshProgress()
  }, [refreshProgress])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (
        event.type === 'validation-progress' &&
        (event.payload.status === 'done' ||
          event.payload.status === 'cancelled' ||
          event.payload.status === 'error' ||
          (event.payload.status === 'running' && event.payload.jobsCompleted > 0))
      ) {
        void refreshProgress()
      }
      if (
        event.type === 'validation-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void refreshProgress()
      }
    })
  }, [props.datasetId, refreshProgress])

  const rows: SetPreviewProgress[] = sets.map((s) =>
    countSetPreviewProgress(checkpoints, s.label)
  )
  const totalCheckpoints = checkpoints.length

  return (
    <div className="middle-panel-body validation-middle validation-status-pane">
      <div className="validation-middle-main">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Validation
        </h2>

        <div className="form-grid" style={{ maxWidth: 480 }}>
          <div>
            <div className="section-title">Progress</div>
            {totalCheckpoints === 0 ? (
              <p className="hint">No checkpoints in output yet.</p>
            ) : rows.length === 0 ? (
              <p className="hint">Loading sets…</p>
            ) : (
              <div className="validation-progress-list">
                {rows.map((row) => (
                  <div key={row.setLabel} className="validation-progress-row">
                    <div className="validation-progress-label">
                      <span>{row.setLabel}</span>
                      <span className="mono">{formatSetPreviewProgress(row)}</span>
                    </div>
                    <div
                      className="validation-progress-bar"
                      role="progressbar"
                      aria-valuenow={row.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.setLabel} ${row.percent}%`}
                    >
                      <div
                        className="validation-progress-bar-fill"
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="hint" style={{ marginBottom: 0 }}>
                  {totalCheckpoints} checkpoint{totalCheckpoints === 1 ? '' : 's'} total
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <MarkDatasetDoneFooter datasetId={props.datasetId} />
    </div>
  )
}
