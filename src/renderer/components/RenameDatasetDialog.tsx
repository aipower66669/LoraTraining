import { useEffect, useState } from 'react'
import type { DatasetSummary } from '@shared/ipc/contract'
import { sanitizeDatasetFolderName } from '@shared/schemas/dataset'
import { ConfirmDialog } from './ConfirmDialog'
import { useAppStore, unwrap } from '../store'

export interface RenameDatasetDialogProps {
  target: DatasetSummary | null
  onClose: () => void
  /** Confirm the folder rename on disk when the sanitized name differs. */
  confirmFolderRename: (nextFolder: string) => Promise<boolean>
}

/** Rename dialog for a dataset row picked from the library explorer. */
export function RenameDatasetDialog(props: RenameDatasetDialogProps): React.JSX.Element {
  const { target, onClose, confirmFolderRename } = props
  const loadDataset = useAppStore((s) => s.loadDataset)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)

  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (target) setRenameValue(target.name)
  }, [target])

  async function confirmRenameDataset(): Promise<void> {
    if (!target) return
    const id = target.id
    const previousName = target.name
    const folderPath = target.folderPath
    const nextName = renameValue.trim()
    onClose()
    if (!nextName || nextName === previousName) return

    const nextFolder = sanitizeDatasetFolderName(nextName)
    const currentBase = folderPath.split(/[/\\]/).filter(Boolean).pop() ?? ''
    if (nextFolder !== currentBase) {
      const ok = await confirmFolderRename(nextFolder)
      if (!ok) return
    }
    try {
      unwrap(await window.loraTraining.datasets.update({ id, name: nextName }))
      await refreshAll()
      if (useAppStore.getState().selectedDatasetId === id) {
        await loadDataset(id)
      }
      setStatus('Dataset renamed')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ConfirmDialog
      open={target != null}
      title="Rename dataset"
      confirmLabel="Rename"
      compact
      enterConfirms
      onCancel={onClose}
      onConfirm={() => void confirmRenameDataset()}
    >
      {target ? (
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirmRenameDataset()
            }}
          />
          <span className="hint">
            Renaming also renames the folder on disk when the sanitized name differs.
          </span>
        </label>
      ) : null}
    </ConfirmDialog>
  )
}
