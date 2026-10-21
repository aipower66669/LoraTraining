import { useMemo } from 'react'
import { ImageOff, Play, Square, X } from 'lucide-react'
import type { ValidationProgress } from '@shared/comfy'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'
import { unwrap, useAppStore } from '../store'
import {
  cancelActivePreviewRun,
  previewRunKindLabel,
  useActivePreviewRun,
  type PreviewRunKind
} from './useActivePreviewRun'

/**
 * Shared status + Run/Stop/Clear/Remove bar for Validation Steps, Weight, and Stress.
 * While the overnight continuum is on any tool (or between handoffs), every panel
 * shows that live status — not Idle / Run.
 */
export function ValidationPreviewToolbar(props: {
  panelKind: PreviewRunKind
  datasetId: string
  activeSetIndex: number
  activeSetLabel: string | null
  canRun: boolean
  canRemove: boolean
  /** This panel's own progress — used for Comfy sampler UI when this set is generating. */
  localProgress: ValidationProgress | null
  /** Extra status detail when this set is generating (e.g. current weight / model). */
  runningDetail?: string | null
  onRun: () => void
  onClear: () => void
  onRemove: () => void
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const continuumActive = useAppStore((s) => s.previewContinuumActive)
  const activeRun = useActivePreviewRun()
  const previewBusy = activeRun != null || continuumActive

  const localIsThisSet =
    props.localProgress?.status === 'running' &&
    props.localProgress.datasetId === props.datasetId &&
    props.localProgress.setIndex === props.activeSetIndex

  const comfyLiveLine = useMemo(() => {
    if (!localIsThisSet || !props.localProgress) return null
    return (
      formatComfyProgressLine({
        nodeTitle: props.localProgress.comfyNodeTitle,
        step: props.localProgress.comfyStep,
        max: props.localProgress.comfyMax,
        detail: props.localProgress.comfyDetail
      }) || null
    )
  }, [localIsThisSet, props.localProgress])

  const comfyPct = useMemo(() => {
    if (!localIsThisSet || !props.localProgress) return null
    return comfyStepPercent(props.localProgress.comfyStep, props.localProgress.comfyMax)
  }, [localIsThisSet, props.localProgress])

  const statusLine = (() => {
    if (localIsThisSet) {
      if (props.runningDetail) {
        return `${props.runningDetail}${comfyLiveLine ? ` · ${comfyLiveLine}` : ''}`
      }
      return comfyLiveLine ?? 'Waiting for ComfyUI…'
    }
    if (activeRun) {
      const label = activeRun.progress.setLabel
      const kindLabel = previewRunKindLabel(activeRun.kind)
      return (
        activeRun.progress.lastMessage ??
        (label ? `${kindLabel} · ${label}` : `Running ${kindLabel}…`)
      )
    }
    if (continuumActive) {
      return 'Continuing to next preview job…'
    }
    return 'Idle'
  })()

  async function stop(): Promise<void> {
    try {
      if (activeRun) {
        await cancelActivePreviewRun(activeRun.kind)
      } else if (continuumActive) {
        unwrap(await window.loraTraining.comfy.stopPreviewContinuum())
      }
      setStatus('Ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const error =
    (activeRun ? activeRun.progress.error : null) ?? props.localProgress?.error

  return (
    <>
      <div className="validation-preview-toolbar">
        <div className="validation-preview-progress" aria-live="polite">
          {localIsThisSet ? (
            <>
              <p className="validation-comfy-live-line mono">{statusLine}</p>
              {comfyPct != null ? (
                <div
                  className="validation-progress-bar"
                  role="progressbar"
                  aria-valuenow={comfyPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="ComfyUI sampler progress"
                >
                  <div
                    className="validation-progress-bar-fill"
                    style={{ width: `${comfyPct}%` }}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <p className="validation-comfy-live-line mono">{statusLine}</p>
          )}
        </div>
        <div className="toolbar validation-run-actions">
          {previewBusy ? (
            <button
              type="button"
              className="icon-btn danger validation-run-btn"
              title={
                activeRun
                  ? `Stop ${previewRunKindLabel(activeRun.kind)}`
                  : 'Stop preview continuum'
              }
              aria-label="Stop preview run"
              onClick={() => void stop()}
            >
              <Square
                className="validation-run-icon"
                size={16}
                strokeWidth={2}
                fill="currentColor"
                aria-hidden="true"
              />
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn primary validation-run-btn"
              disabled={!props.canRun}
              title="Run all sets here, then continue across trained datasets (Validation Steps → Weight → Stress)"
              aria-label="Run all sets"
              onClick={() => props.onRun()}
            >
              <Play
                className="validation-run-icon"
                size={16}
                strokeWidth={2}
                fill="currentColor"
                aria-hidden="true"
              />
            </button>
          )}
          <button
            type="button"
            className="icon-btn validation-run-btn"
            disabled={!props.activeSetLabel}
            title={
              previewBusy
                ? `Clear images in ${props.activeSetLabel ?? 'this set'} (cancels the current preview run)`
                : `Clear images in ${props.activeSetLabel ?? 'this set'}`
            }
            aria-label="Clear images"
            onClick={() => props.onClear()}
          >
            <ImageOff className="validation-run-icon" size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn danger validation-run-btn"
            disabled={!props.canRemove || localIsThisSet}
            title={
              !props.canRemove
                ? 'At least one set is required'
                : localIsThisSet
                  ? 'Cannot remove the set that is generating'
                  : `Remove ${props.activeSetLabel ?? 'set'}`
            }
            aria-label="Remove set"
            onClick={() => props.onRemove()}
          >
            <X className="validation-run-icon" size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
    </>
  )
}
