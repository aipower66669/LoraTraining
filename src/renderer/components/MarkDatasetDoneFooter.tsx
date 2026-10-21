import { useState } from 'react'
import type { DatasetDetail } from '@shared/ipc/contract'
import { unwrap, useAppStore } from '../store'

/** Bottom-centered Mark as Done control — only when Validated (or already Done). */
export function MarkDatasetDoneFooter(props: {
  datasetId: string
}): React.JSX.Element | null {
  const [markingDone, setMarkingDone] = useState(false)
  const setError = useAppStore((s) => s.setError)
  const setStatus = useAppStore((s) => s.setStatus)
  const detail = useAppStore((s) =>
    s.datasetDetail?.id === props.datasetId ? s.datasetDetail : null
  )
  const validated = Boolean(detail?.validated)
  const done = Boolean(detail?.done)

  if (!validated && !done) return null

  async function markDone(): Promise<void> {
    if (!validated || done || markingDone) return
    setMarkingDone(true)
    try {
      const updated = unwrap(
        await window.loraTraining.datasets.markDone(props.datasetId)
      ) as DatasetDetail
      const refreshAll = useAppStore.getState().refreshAll
      useAppStore.setState({
        datasetDetail: updated,
        datasets: useAppStore.getState().datasets.map((d) =>
          d.id === updated.id
            ? {
                ...d,
                done: updated.done,
                validated: updated.validated,
                trained: updated.trained,
                status: updated.status,
                updatedAt: updated.updatedAt
              }
            : d
        )
      })
      await refreshAll()
      setStatus('Marked as Done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMarkingDone(false)
    }
  }

  return (
    <div className="validation-done-footer">
      {done ? (
        <p className="hint validation-done-label" title="Marked Done — referenced in wildcards">
          Done
        </p>
      ) : (
        <button
          type="button"
          className="primary"
          title="Mark Done only after a wildcards-library file references this LoRA"
          onClick={() => void markDone()}
          disabled={markingDone}
        >
          {markingDone ? 'Checking…' : 'Mark as Done'}
        </button>
      )}
    </div>
  )
}
