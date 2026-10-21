import { useEffect, useState } from 'react'
import type { JoyCaptionExistingMode } from '@shared/joycaption'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap, useAppStore } from '../store'

const JOYCAPTION_PREPEND_TRIGGER_KEY = 'lora-training:joycaption-prepend-trigger'

function readJoyCaptionPrependTrigger(): boolean {
  try {
    return localStorage.getItem(JOYCAPTION_PREPEND_TRIGGER_KEY) === '1'
  } catch {
    return false
  }
}

function writeJoyCaptionPrependTrigger(enabled: boolean): void {
  try {
    localStorage.setItem(JOYCAPTION_PREPEND_TRIGGER_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/**
 * Silent JoyCaption run: Only missing + Prepend trigger ON.
 * Used by Shift+click on the JoyCaption toolbar button (no dialog).
 */
export async function runJoyCaptionMissingWithPrepend(opts: {
  datasetId: string
  name: string
  captionGuidance: string
  onStatus?: (message: string) => void
}): Promise<void> {
  writeJoyCaptionPrependTrigger(true)
  const result = unwrap(
    await window.loraTraining.tools.runJoyCaption(
      opts.datasetId,
      'missing',
      opts.captionGuidance,
      true
    )
  ) as { runId: string; queued: boolean }
  const msg = result.queued
    ? `Queued captioning for ${opts.name}`
    : `JoyCaption started for ${opts.name}`
  opts.onStatus?.(msg)
  // Brief flash only — live caption progress replaces this when it arrives.
  window.setTimeout(() => {
    const { statusMessage, setStatus } = useAppStore.getState()
    if (statusMessage === msg) setStatus('Ready')
  }, 2000)
}

/** Enough fields to configure JoyCaption without a full DatasetDetail. */
export type JoyCaptionDialogTarget = {
  id: string
  name: string
  trigger: string
  captionGuidance: string
  stats: { images: number; captions: number }
}

export interface JoyCaptionDialogProps {
  open: boolean
  target: JoyCaptionDialogTarget | null
  onClose: () => void
  /** Persist captionGuidance if it changed, before kicking off the run. */
  onSaveGuidance: (datasetId: string, guidance: string) => Promise<void>
  onError: (message: string) => void
  onStatus?: (message: string) => void
}

/** Confirmation dialog for running / enqueueing JoyCaption against a dataset. */
export function JoyCaptionDialog(props: JoyCaptionDialogProps): React.JSX.Element {
  const { open, target, onClose, onSaveGuidance, onError, onStatus } = props

  const [joyCaptionMode, setJoyCaptionMode] = useState<JoyCaptionExistingMode>('missing')
  const [joyCaptionGuidance, setJoyCaptionGuidance] = useState('')
  const [joyCaptionPrependTrigger, setJoyCaptionPrependTrigger] = useState(
    readJoyCaptionPrependTrigger
  )

  useEffect(() => {
    if (!open) return
    setJoyCaptionMode('missing')
    setJoyCaptionGuidance(target?.captionGuidance ?? '')
    setJoyCaptionPrependTrigger(readJoyCaptionPrependTrigger())
     
  }, [open])

  async function confirmJoyCaption(): Promise<void> {
    if (!target) return
    const guidance = joyCaptionGuidance
    const prependTrigger = joyCaptionPrependTrigger
    writeJoyCaptionPrependTrigger(prependTrigger)
    onClose()
    try {
      if (guidance !== (target.captionGuidance ?? '')) {
        await onSaveGuidance(target.id, guidance)
      }
      const result = unwrap(
        await window.loraTraining.tools.runJoyCaption(
          target.id,
          joyCaptionMode,
          guidance,
          prependTrigger
        )
      ) as { runId: string; queued: boolean }
      if (result.queued) {
        onStatus?.(`Queued captioning for ${target.name}`)
      }
      // Status / progress come from caption-progress events.
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  const missing = target
    ? Math.max(0, target.stats.images - target.stats.captions)
    : 0

  return (
    <ConfirmDialog
      open={open}
      title={target ? `JoyCaption · ${target.name}` : 'Run JoyCaption'}
      confirmLabel={joyCaptionMode === 'overwrite' ? 'Overwrite & run' : 'Run'}
      danger={joyCaptionMode === 'overwrite'}
      enterConfirms
      onCancel={onClose}
      onConfirm={() => void confirmJoyCaption()}
    >
      {target ? (
        <div className="form-grid">
          <p className="hint" style={{ margin: 0 }}>
            {target.stats.images} image{target.stats.images === 1 ? '' : 's'} ·{' '}
            {target.stats.captions} captioned · {missing} missing
          </p>
          <label className="field">
            <span>Description (JoyCaption context)</span>
            <textarea
              rows={2}
              value={joyCaptionGuidance}
              placeholder="Short context for the captioner (subject, domain, what to avoid)…"
              onChange={(e) => setJoyCaptionGuidance(e.target.value)}
            />
          </label>
          <label className="field-row check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={joyCaptionPrependTrigger}
              disabled={!target.trigger.trim()}
              onChange={(e) => {
                const enabled = e.target.checked
                setJoyCaptionPrependTrigger(enabled)
                writeJoyCaptionPrependTrigger(enabled)
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
            <label className={`choice-option${joyCaptionMode === 'missing' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="joy-caption-mode"
                checked={joyCaptionMode === 'missing'}
                onChange={() => setJoyCaptionMode('missing')}
              />
              <span className="choice-option-body">
                <strong>Only missing</strong>
                <span className="hint">
                  Skip images that already have a .txt caption. Safe default.
                </span>
              </span>
            </label>
            <label
              className={`choice-option${joyCaptionMode === 'append' ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="joy-caption-mode"
                checked={joyCaptionMode === 'append'}
                onChange={() => setJoyCaptionMode('append')}
              />
              <span className="choice-option-body">
                <strong>Append to existing</strong>
                <span className="hint">
                  Generate for every image: create captions where missing, append new text after
                  existing .txt captions.
                </span>
              </span>
            </label>
            <label
              className={`choice-option${joyCaptionMode === 'overwrite' ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="joy-caption-mode"
                checked={joyCaptionMode === 'overwrite'}
                onChange={() => setJoyCaptionMode('overwrite')}
              />
              <span className="choice-option-body">
                <strong>Overwrite (redo)</strong>
                <span className="hint">
                  Regenerate captions for every image, replacing existing .txt files.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
