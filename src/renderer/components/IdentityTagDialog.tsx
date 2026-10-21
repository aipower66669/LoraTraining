import { useEffect, useState } from 'react'
import type { ApplyIdentityTagsResult } from '@shared/ipc/contract'
import type { IdentityTagMode } from '@shared/identity-tag'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap } from '../store'

export type IdentityTagDialogTarget = {
  id: string
  name: string
  stats: { images: number; captions: number }
}

export interface IdentityTagDialogProps {
  open: boolean
  target: IdentityTagDialogTarget | null
  onClose: () => void
  onError: (message: string) => void
  onStatus?: (message: string) => void
  onCaptionsChanged?: () => void
}

/** Assign / redo / remove unique female identity tags in dataset captions. */
export function IdentityTagDialog(props: IdentityTagDialogProps): React.JSX.Element {
  const { open, target, onClose, onError, onStatus, onCaptionsChanged } = props

  const [mode, setMode] = useState<IdentityTagMode>('missing')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('missing')
    setBusy(false)
  }, [open])

  async function confirm(): Promise<void> {
    if (!target || busy) return
    setBusy(true)
    try {
      const result = unwrap(
        await window.loraTraining.captions.applyIdentityTags({
          datasetId: target.id,
          mode
        })
      ) as ApplyIdentityTagsResult
      onClose()
      onCaptionsChanged?.()
      if (mode === 'remove') {
        onStatus?.(
          `Identity tags removed · ${result.removed} updated${
            result.skipped ? ` · ${result.skipped} already clear` : ''
          }`
        )
      } else if (mode === 'redo') {
        onStatus?.(`Identity tags redone · ${result.tagged} tagged`)
      } else {
        onStatus?.(
          `Identity tags · ${result.tagged} added${
            result.skipped ? ` · ${result.skipped} already tagged` : ''
          }`
        )
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const danger = mode === 'redo' || mode === 'remove'
  const confirmLabel = mode === 'remove' ? 'Remove' : mode === 'redo' ? 'Redo' : 'OK'

  return (
    <ConfirmDialog
      open={open}
      title={target ? `Add identity tag · ${target.name}` : 'Add identity tag'}
      confirmLabel={confirmLabel}
      danger={danger}
      confirmDisabled={!target || busy}
      enterConfirms
      onCancel={onClose}
      onConfirm={() => void confirm()}
    >
      {target ? (
        <div className="form-grid">
          <p className="hint" style={{ margin: 0 }}>
            {target.stats.images} image{target.stats.images === 1 ? '' : 's'} · Unique female name
            per image as{' '}
            <code className="mono">.photo of a girl named Name.</code> Other caption text is never
            rewritten.
          </p>
          <fieldset className="choice-list">
            <legend className="sr-only">Identity tag mode</legend>
            <label className={`choice-option${mode === 'missing' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="identity-tag-mode"
                checked={mode === 'missing'}
                disabled={busy}
                onChange={() => setMode('missing')}
              />
              <span className="choice-option-body">
                <strong>Only missing</strong>
                <span className="hint">
                  Tag images that do not already have an identity marker. Safe default.
                </span>
              </span>
            </label>
            <label className={`choice-option${mode === 'redo' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="identity-tag-mode"
                checked={mode === 'redo'}
                disabled={busy}
                onChange={() => setMode('redo')}
              />
              <span className="choice-option-body">
                <strong>Redo</strong>
                <span className="hint">
                  Replace every identity tag with a fresh unique name (rest of caption kept).
                </span>
              </span>
            </label>
            <label className={`choice-option${mode === 'remove' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="identity-tag-mode"
                checked={mode === 'remove'}
                disabled={busy}
                onChange={() => setMode('remove')}
              />
              <span className="choice-option-body">
                <strong>Remove</strong>
                <span className="hint">
                  Strip identity markers only; frees names in identity-names-used.txt.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
