import { useEffect, useState } from 'react'
import type { JoyCaptionExistingMode } from '@shared/joycaption'
import type { BulkTransformResult } from '@shared/ipc/contract'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap } from '../store'

const SET_CAPTION_PREPEND_TRIGGER_KEY = 'lora-training:set-caption-prepend-trigger'

function readPrependTrigger(): boolean {
  try {
    return localStorage.getItem(SET_CAPTION_PREPEND_TRIGGER_KEY) === '1'
  } catch {
    return false
  }
}

function writePrependTrigger(enabled: boolean): void {
  try {
    localStorage.setItem(SET_CAPTION_PREPEND_TRIGGER_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export type SetCaptionDialogTarget = {
  id: string
  name: string
  trigger: string
  /** Dataset description / JoyCaption context — prefills the Caption field. */
  captionGuidance: string
  stats: { images: number; captions: number }
}

export interface SetCaptionDialogProps {
  open: boolean
  target: SetCaptionDialogTarget | null
  onClose: () => void
  onError: (message: string) => void
  onStatus?: (message: string) => void
  onCaptionsChanged?: () => void
}

/** Manually set / append / overwrite caption text for every image in a dataset. */
export function SetCaptionDialog(props: SetCaptionDialogProps): React.JSX.Element {
  const { open, target, onClose, onError, onStatus, onCaptionsChanged } = props

  const [mode, setMode] = useState<JoyCaptionExistingMode>('missing')
  const [caption, setCaption] = useState('')
  const [prependTrigger, setPrependTrigger] = useState(readPrependTrigger)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('missing')
    setCaption(target?.captionGuidance ?? '')
    setPrependTrigger(readPrependTrigger())
    setBusy(false)
    // Prefill from the target present when the dialog opens.
     
  }, [open])

  const canSubmit =
    Boolean(target) &&
    !busy &&
    (caption.trim().length > 0 || (prependTrigger && Boolean(target?.trigger.trim())))

  async function confirm(): Promise<void> {
    if (!target || !canSubmit) return
    writePrependTrigger(prependTrigger)
    setBusy(true)
    try {
      const result = unwrap(
        await window.loraTraining.captions.bulkTransform({
          datasetId: target.id,
          createMissing: true,
          op: {
            op: 'setText',
            value: caption,
            mode,
            prependTrigger,
            trigger: target.trigger.trim() || undefined
          }
        })
      ) as BulkTransformResult
      onClose()
      onCaptionsChanged?.()
      onStatus?.(
        `Set captions · ${result.changed} updated${
          result.skipped ? ` · ${result.skipped} skipped` : ''
        }`
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const missing = target
    ? Math.max(0, target.stats.images - target.stats.captions)
    : 0

  return (
    <ConfirmDialog
      open={open}
      title={target ? `Set caption · ${target.name}` : 'Set caption'}
      confirmLabel={mode === 'overwrite' ? 'Overwrite' : 'OK'}
      danger={mode === 'overwrite'}
      confirmDisabled={!canSubmit}
      enterConfirms
      onCancel={onClose}
      onConfirm={() => void confirm()}
    >
      {target ? (
        <div className="form-grid">
          <p className="hint" style={{ margin: 0 }}>
            {target.stats.images} image{target.stats.images === 1 ? '' : 's'} ·{' '}
            {target.stats.captions} captioned · {missing} missing
          </p>
          <label className="field">
            <span>Caption</span>
            <textarea
              rows={3}
              value={caption}
              placeholder="Text to write into caption files…"
              onChange={(e) => setCaption(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field-row check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={prependTrigger}
              disabled={!target.trigger.trim() || busy}
              onChange={(e) => {
                const enabled = e.target.checked
                setPrependTrigger(enabled)
                writePrependTrigger(enabled)
              }}
            />
            <span>
              Prepend trigger
              {target.trigger.trim() ? (
                <span className="hint"> ({target.trigger.trim()})</span>
              ) : (
                <span className="hint"> (set a trigger first)</span>
              )}
            </span>
          </label>
          <fieldset className="choice-list">
            <legend className="sr-only">Existing captions</legend>
            <label className={`choice-option${mode === 'missing' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="set-caption-mode"
                checked={mode === 'missing'}
                disabled={busy}
                onChange={() => setMode('missing')}
              />
              <span className="choice-option-body">
                <strong>Only missing</strong>
                <span className="hint">
                  Write the caption only where no .txt file exists yet. Safe default.
                </span>
              </span>
            </label>
            <label className={`choice-option${mode === 'append' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="set-caption-mode"
                checked={mode === 'append'}
                disabled={busy}
                onChange={() => setMode('append')}
              />
              <span className="choice-option-body">
                <strong>Append to existing</strong>
                <span className="hint">
                  Create captions where missing; append this text after existing .txt captions.
                </span>
              </span>
            </label>
            <label className={`choice-option${mode === 'overwrite' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="set-caption-mode"
                checked={mode === 'overwrite'}
                disabled={busy}
                onChange={() => setMode('overwrite')}
              />
              <span className="choice-option-body">
                <strong>Overwrite (redo)</strong>
                <span className="hint">
                  Replace every caption with this text (creates missing files).
                </span>
              </span>
            </label>
          </fieldset>
          {!canSubmit && !busy ? (
            <p className="hint" style={{ margin: 0 }}>
              Enter a caption{target.trigger.trim() ? ', or enable Prepend trigger alone' : ''}.
            </p>
          ) : null}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
