import { useEffect, useState } from 'react'
import type { DatasetSummary } from '@shared/ipc/contract'
import { suggestDuplicateDatasetName } from '@shared/schemas/dataset'
import { ConfirmDialog } from './ConfirmDialog'
import { useAppStore, unwrap } from '../store'

export interface DuplicateDatasetDialogProps {
  target: DatasetSummary | null
  onClose: () => void
}

/** Duplicate dialog for a dataset row picked from the library explorer. */
export function DuplicateDatasetDialog(props: DuplicateDatasetDialogProps): React.JSX.Element {
  const { target, onClose } = props
  const loadDataset = useAppStore((s) => s.loadDataset)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)

  const [nameValue, setNameValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (target) setNameValue(suggestDuplicateDatasetName(target.name))
  }, [target])

  async function confirmDuplicateDataset(): Promise<void> {
    if (!target || busy) return
    const nextName = nameValue.trim()
    if (!nextName) return
    setBusy(true)
    try {
      const created = unwrap(
        await window.loraTraining.datasets.duplicate({
          sourceDatasetId: target.id,
          name: nextName
        })
      ) as { id: string; name: string }
      onClose()
      await refreshAll()
      await loadDataset(created.id)
      setStatus(`Duplicated as ${created.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={target != null}
      title="Duplicate dataset"
      confirmLabel={busy ? 'Duplicating…' : 'Duplicate'}
      confirmDisabled={busy || !nameValue.trim()}
      compact
      enterConfirms
      onCancel={onClose}
      onConfirm={() => void confirmDuplicateDataset()}
    >
      {target ? (
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            disabled={busy}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirmDuplicateDataset()
            }}
          />
          <span className="hint">
            Copies images and captions into a new folder. Training output and validation
            previews are not copied.
          </span>
        </label>
      ) : null}
    </ConfirmDialog>
  )
}
