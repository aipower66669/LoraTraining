import { useCallback, useEffect, useState } from 'react'
import { modelHasPreviewStem, modelPreviewStemMap } from '@shared/stress-sets'
import {
  formatSetPreviewProgress,
  type SetPreviewProgress
} from '@shared/validation-progress'
import { unwrap, useAppStore } from '../store'
import { MarkDatasetDoneFooter } from './MarkDatasetDoneFooter'
import { StressCompareOverview } from './StressCompareOverview'

type SetTab = {
  index: number
  label: string
  models: string[]
}

type Preview = { stem: string; relativePath: string }

/** Middle pane: stress-set progress bars (same look as LoRA Validation). */
export function StressTestMiddlePane(props: {
  datasetId: string
}): React.JSX.Element {
  const [sets, setSets] = useState<SetTab[]>([])
  const [previewsBySet, setPreviewsBySet] = useState<Record<number, Preview[]>>({})
  const [compareOpen, setCompareOpen] = useState(false)
  const setError = useAppStore((s) => s.setError)

  const refreshProgress = useCallback(async (): Promise<void> => {
    if (!props.datasetId) return
    try {
      const setList = unwrap(
        await window.loraTraining.comfy.listStressTestSets(props.datasetId)
      ) as SetTab[]
      setSets(setList.map((s) => ({ index: s.index, label: s.label, models: s.models ?? [] })))
      const entries = await Promise.all(
        setList.map(async (s) => {
          const previews = unwrap(
            await window.loraTraining.comfy.listStressPreviews(props.datasetId, s.index)
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
        event.type === 'stress-progress' &&
        (event.payload.status === 'done' ||
          event.payload.status === 'cancelled' ||
          event.payload.status === 'error' ||
          (event.payload.status === 'running' && event.payload.jobsCompleted > 0))
      ) {
        void refreshProgress()
      }
      if (
        event.type === 'stress-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void refreshProgress()
      }
    })
  }, [props.datasetId, refreshProgress])

  const rows: SetPreviewProgress[] = sets.map((s) => {
    const previewStems = new Set(
      (previewsBySet[s.index] ?? []).map((p) => p.stem.toLowerCase())
    )
    const stemByModel = modelPreviewStemMap(s.models)
    const total = s.models.length
    const done =
      total === 0
        ? 0
        : s.models.filter((m) => {
            const stem = stemByModel.get(m)
            return stem != null && modelHasPreviewStem(m, stem, previewStems)
          }).length
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    return { setLabel: s.label, done, total, percent }
  })
  const totalModels = sets.reduce((n, s) => n + s.models.length, 0)
  const hasAnyPreview = Object.values(previewsBySet).some((list) => list.length > 0)

  return (
    <div className="middle-panel-body validation-middle validation-status-pane stress-middle-pane">
      <div className="stress-middle-pane-body">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Model Stress-Testing
        </h2>

        <div className="form-grid" style={{ maxWidth: 480 }}>
          <div>
            <div className="section-title">Progress</div>
            {sets.length === 0 ? (
              <p className="hint">Loading sets…</p>
            ) : totalModels === 0 ? (
              <p className="hint">No models selected yet.</p>
            ) : (
              <div className="validation-progress-list">
                {rows.map((row) => (
                  <div key={row.setLabel} className="validation-progress-row">
                    <div className="validation-progress-label">
                      <span>{row.setLabel}</span>
                      <span className="mono">
                        {row.total === 0 ? 'No models' : formatSetPreviewProgress(row)}
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
                  {totalModels} model{totalModels === 1 ? '' : 's'} selected
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="stress-middle-pane-footer stress-middle-pane-footer-stack">
        <button
          type="button"
          className="primary"
          disabled={!hasAnyPreview}
          title={
            hasAnyPreview
              ? 'Open full-screen grid: models × stress sets'
              : 'Produce at least one stress preview to compare'
          }
          onClick={() => setCompareOpen(true)}
        >
          Compare models
        </button>
        <MarkDatasetDoneFooter datasetId={props.datasetId} />
      </div>

      {compareOpen ? (
        <StressCompareOverview
          datasetId={props.datasetId}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
    </div>
  )
}
