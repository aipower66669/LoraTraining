import { useCallback, useEffect, useState } from 'react'
import {
  enumerateWeightSteps,
  formatWeightPreviewStem
} from '@shared/weight-sets'
import {
  formatSetPreviewProgress,
  type SetPreviewProgress
} from '@shared/validation-progress'
import { unwrap, useAppStore } from '../store'
import { MarkDatasetDoneFooter } from './MarkDatasetDoneFooter'

type SetTab = {
  index: number
  label: string
  checkpointFileName: string | null
  weightMin: number
  weightMax: number
  weightStep: number
}

type Preview = { stem: string; relativePath: string }

/** Middle pane: weight-set progress bars (same look as LoRA Validation). */
export function WeightValidationMiddlePane(props: {
  datasetId: string
}): React.JSX.Element {
  const [sets, setSets] = useState<SetTab[]>([])
  const [previewsBySet, setPreviewsBySet] = useState<Record<number, Preview[]>>({})
  const setError = useAppStore((s) => s.setError)

  const refreshProgress = useCallback(async (): Promise<void> => {
    if (!props.datasetId) return
    try {
      const setList = unwrap(
        await window.loraTraining.comfy.listWeightSets(props.datasetId)
      ) as SetTab[]
      setSets(
        setList.map((s) => ({
          index: s.index,
          label: s.label,
          checkpointFileName: s.checkpointFileName ?? null,
          weightMin: s.weightMin,
          weightMax: s.weightMax,
          weightStep: s.weightStep
        }))
      )
      const entries = await Promise.all(
        setList.map(async (s) => {
          const previews = unwrap(
            await window.loraTraining.comfy.listWeightPreviews(props.datasetId, s.index)
          ) as Preview[]
          return [s.index, previews] as const
        })
      )
      setPreviewsBySet(Object.fromEntries(entries))
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
        event.type === 'weight-progress' &&
        (event.payload.status === 'done' ||
          event.payload.status === 'cancelled' ||
          event.payload.status === 'error' ||
          (event.payload.status === 'running' && event.payload.jobsCompleted > 0))
      ) {
        void refreshProgress()
      }
      if (
        event.type === 'weight-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void refreshProgress()
      }
    })
  }, [props.datasetId, refreshProgress])

  const rows: SetPreviewProgress[] = sets.map((s) => {
    const enumerated = enumerateWeightSteps(s.weightMin, s.weightMax, s.weightStep)
    const checkpoint = s.checkpointFileName?.trim() || ''
    const total = enumerated.ok && checkpoint ? enumerated.weights.length : 0
    const previewStems = new Set(
      (previewsBySet[s.index] ?? []).map((p) => p.stem.toLowerCase())
    )
    const done =
      enumerated.ok && total > 0 && checkpoint
        ? enumerated.weights.filter((w) =>
            previewStems.has(formatWeightPreviewStem(checkpoint, w).toLowerCase())
          ).length
        : 0
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    return { setLabel: s.label, done, total, percent }
  })
  const totalWeights = rows.reduce((n, r) => n + r.total, 0)

  return (
    <div className="middle-panel-body validation-middle validation-status-pane">
      <div className="validation-middle-main">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Validation Weight
        </h2>

        <div className="form-grid" style={{ maxWidth: 480 }}>
          <div>
            <div className="section-title">Progress</div>
            {sets.length === 0 ? (
              <p className="hint">Loading sets…</p>
            ) : totalWeights === 0 ? (
              <p className="hint">Fix weight min / max / step to see progress.</p>
            ) : (
              <div className="validation-progress-list">
                {rows.map((row) => (
                  <div key={row.setLabel} className="validation-progress-row">
                    <div className="validation-progress-label">
                      <span>{row.setLabel}</span>
                      <span className="mono">
                        {row.total === 0 ? 'Invalid range' : formatSetPreviewProgress(row)}
                      </span>
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
                  {totalWeights} weight preview{totalWeights === 1 ? '' : 's'} planned
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
