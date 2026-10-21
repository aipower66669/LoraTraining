import { useCallback, useEffect, useState } from 'react'
import { Box, Droplet, Droplets, Hash, ListOrdered, Maximize2, Play, Square, Undo2 } from 'lucide-react'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'
import type { UpscaleProgress } from '@shared/comfy'
import { VALIDATION_MODEL_DEFAULT } from '@shared/validation-model'
import { unwrap, useAppStore } from '../store'
import { ComfyModelSelect } from './ComfyModelSelect'
import { ensureComfyReachable } from './ensureComfyReachable'
import { useConfirm } from './useConfirm'
import { PromptField } from './prompt/PromptField'

type UpscaleConfigState = {
  prompt: string
  seed: number
  model: string
  denoise: number
  styleIndex: 0 | 1
  maxSize: number
}

function normalizeConfig(c: Partial<UpscaleConfigState>): UpscaleConfigState {
  const model = (c.model ?? '').trim()
  return {
    prompt: c.prompt ?? '',
    seed: c.seed ?? 1,
    model: !model || model === VALIDATION_MODEL_DEFAULT ? VALIDATION_MODEL_DEFAULT : model,
    denoise: c.denoise ?? 0.5,
    styleIndex: c.styleIndex === 1 ? 1 : 0,
    maxSize: c.maxSize ?? 1600
  }
}

/**
 * Explicit visual clone of ValidationDetailsPanel: same CSS classes so fonts,
 * sizes, spacing, and icons match exactly. No set-tabs row — settings are the
 * library last-used Upscale values (carried to the next image). An empty
 * prompt is filled from the image caption.
 */
export function UpscaleDetailsPanel(props: { datasetId: string }): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const rawSource = useAppStore((s) => s.upscaleSource)
  // Guard against a stale source from a previously viewed dataset lingering after switching datasets.
  const source = rawSource && rawSource.datasetId === props.datasetId ? rawSource : null
  const { ask, dialog } = useConfirm()

  const [config, setConfig] = useState<UpscaleConfigState>(normalizeConfig({}))
  const [configLoading, setConfigLoading] = useState(false)
  const [progress, setProgress] = useState<UpscaleProgress | null>(null)

  const loadConfig = useCallback(async (): Promise<void> => {
    if (!source) {
      setConfig(normalizeConfig({}))
      setConfigLoading(false)
      return
    }
    const datasetId = source.datasetId
    const fileName = source.fileName
    setConfigLoading(true)
    // Clear immediately so the previous image's prompt/seed don't linger.
    setConfig(normalizeConfig({}))
    try {
      const raw = unwrap(
        await window.loraTraining.upscale.getImageConfig(datasetId, fileName)
      ) as UpscaleConfigState
      const cur = useAppStore.getState().upscaleSource
      if (!cur || cur.datasetId !== datasetId || cur.fileName !== fileName) return
      setConfig(normalizeConfig(raw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConfigLoading(false)
    }
  }, [source, setError])

  const batchActive =
    progress?.status === 'running' &&
    progress.datasetId === props.datasetId &&
    (progress.batchTotal ?? 0) > 1

  useEffect(() => {
    // Keep frozen settings visible while Run all advances through images.
    if (batchActive) return
    void loadConfig()
  }, [loadConfig, batchActive])

  useEffect(() => {
    void window.loraTraining.upscale.getProgress().then((r) => {
      try {
        setProgress(unwrap(r) as UpscaleProgress)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type === 'upscale-progress') {
        setProgress(event.payload)
        if (event.payload.status === 'done') {
          setStatus(event.payload.lastMessage ?? 'Upscale complete')
        }
      }
    })
  }, [setStatus])

  function patch(next: Partial<UpscaleConfigState>): void {
    setConfig((prev) => ({ ...prev, ...next }))
  }

  async function persist(next: Partial<UpscaleConfigState>): Promise<void> {
    if (!source) return
    try {
      const raw = unwrap(
        await window.loraTraining.upscale.updateImageConfig(source.datasetId, source.fileName, next)
      ) as UpscaleConfigState
      setConfig(normalizeConfig(raw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const running =
    progress?.status === 'running' &&
    progress.datasetId === props.datasetId &&
    (progress.fileName === source?.fileName || (progress.batchTotal ?? 0) > 1)
  const progressForThisImage =
    progress?.datasetId === source?.datasetId && progress?.fileName === source?.fileName ? progress : null

  const comfyLiveLine =
    running && progressForThisImage
      ? formatComfyProgressLine({
          nodeTitle: progressForThisImage.comfyNodeTitle,
          step: progressForThisImage.comfyStep,
          max: progressForThisImage.comfyMax,
          detail: progressForThisImage.comfyDetail
        }) || null
      : null
  const comfyPct =
    running && progressForThisImage
      ? comfyStepPercent(progressForThisImage.comfyStep, progressForThisImage.comfyMax)
      : null

  const img = source ? (datasetDetail?.images.find((i) => i.fileName === source.fileName) ?? null) : null
  const hasOriginal = progressForThisImage?.hasOriginal ?? img?.hasOriginal ?? false
  const pendingOthers =
    datasetDetail?.images.filter((i) => i.fileName !== source?.fileName && !i.hasOriginal).length ?? 0
  const runAllCount = source ? 1 + pendingOthers : 0

  async function start(): Promise<void> {
    if (!source) {
      setError('Select an image and open Upscale first.')
      return
    }
    try {
      await persist(config)
      const ready = await ensureComfyReachable({
        settings,
        ask,
        setStatus,
        setError
      })
      if (!ready) return
      unwrap(await window.loraTraining.upscale.start(source.datasetId, source.fileName))
      setStatus(`Upscale started (seed ${config.seed <= 0 ? 'random' : config.seed})…`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function startAll(): Promise<void> {
    if (!source) {
      setError('Select an image and open Upscale first.')
      return
    }
    try {
      await persist(config)
      const ready = await ensureComfyReachable({
        settings,
        ask,
        setStatus,
        setError
      })
      if (!ready) return
      const result = unwrap(
        await window.loraTraining.upscale.startAll(source.datasetId, source.fileName)
      ) as { started: true; queued: number }
      setStatus(
        `Upscale all started · ${result.queued} image${result.queued === 1 ? '' : 's'} (same settings)…`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function stop(): Promise<void> {
    unwrap(await window.loraTraining.upscale.cancel())
    setStatus('Ready')
  }

  async function revert(): Promise<void> {
    if (!source) return
    try {
      unwrap(await window.loraTraining.upscale.revert(source.datasetId, source.fileName))
      setStatus('Reverted to original')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="panel details-panel validation-details">
      {dialog}
      <div className="details-meta validation-details-form">
        <div
          className="form-grid validation-set-fields"
          aria-busy={configLoading}
          style={configLoading ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
        >
          <div className="validation-prompt-field">
            <span>Prompt</span>
            <PromptField
              rows={2}
              value={config.prompt}
              onChange={(prompt) => patch({ prompt })}
              onBlur={() => void persist({ prompt: config.prompt })}
              placeholder="Positive prompt"
            />
          </div>
          <div className="validation-fields-row">
            <label
              className="validation-field validation-field-model"
              title="Model for this run — checkpoint / UNET"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <Box className="validation-field-svg" strokeWidth={2} />
              </span>
              <ComfyModelSelect
                compact
                includeDefault
                value={config.model || VALIDATION_MODEL_DEFAULT}
                title="Model for this run — Default uses Settings → ComfyUI default validation model"
                onChange={(next) => {
                  patch({ model: next })
                  void persist({ model: next })
                }}
              />
            </label>
            <label className="validation-field validation-field-seed" title="Seed — ≤0 = random">
              <span className="validation-field-icon" aria-hidden="true">
                <Hash className="validation-field-svg" strokeWidth={2} />
              </span>
              <input
                type="number"
                className="validation-num"
                value={config.seed}
                aria-label="Seed"
                onChange={(e) => patch({ seed: Number(e.target.value) })}
                onBlur={() => void persist({ seed: config.seed })}
              />
            </label>
            <label
              className="validation-field validation-field-weight"
              title="Denoise — KSampler denoise strength (0..1)"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <Droplets className="validation-field-svg" strokeWidth={2} />
              </span>
              <input
                type="number"
                className="validation-num"
                step={0.01}
                min={0}
                max={1}
                value={config.denoise}
                aria-label="Denoise"
                onChange={(e) => patch({ denoise: Number(e.target.value) })}
                onBlur={() => void persist({ denoise: config.denoise })}
              />
            </label>
            <label
              className="validation-field validation-field-style"
              title="Type — injected into LT · Style Index"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <Droplet className="validation-field-svg" strokeWidth={2} />
              </span>
              <select
                className="validation-style"
                value={config.styleIndex}
                aria-label="Type"
                onChange={(e) => {
                  const styleIndex = Number(e.target.value) === 1 ? 1 : 0
                  patch({ styleIndex })
                  void persist({ styleIndex })
                }}
              >
                <option value={0}>Real</option>
                <option value={1}>Anime</option>
              </select>
            </label>
            <label
              className="validation-field validation-field-seed"
              title="Max Size — largest output dimension"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <Maximize2 className="validation-field-svg" strokeWidth={2} />
              </span>
              <input
                type="number"
                className="validation-num"
                step={64}
                min={64}
                max={8192}
                value={config.maxSize}
                aria-label="Max Size"
                onChange={(e) => patch({ maxSize: Number(e.target.value) })}
                onBlur={() => void persist({ maxSize: config.maxSize })}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="validation-preview-toolbar">
        <div className="validation-preview-progress" aria-live="polite">
          {running ? (
            <>
              <p className="validation-comfy-live-line mono">
                {comfyLiveLine ?? 'Waiting for ComfyUI…'}
              </p>
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
            <p className="validation-comfy-live-line mono">
              {progressForThisImage?.lastMessage ?? 'Idle'}
            </p>
          )}
        </div>
        <div className="toolbar validation-run-actions">
          {hasOriginal && !running ? (
            <button
              type="button"
              className="icon-btn upscale-revert-btn"
              title="Revert to original — discard all tip edits (keeps pristine file body)"
              aria-label="Revert to original"
              onClick={() => void revert()}
            >
              <Undo2 className="validation-run-icon" size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              className="icon-btn danger validation-run-btn"
              title="Stop upscale"
              aria-label="Stop upscale"
              onClick={() => void stop()}
            >
              <Square className="validation-run-icon" size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="icon-btn primary validation-run-btn"
                disabled={!source}
                title={
                  !source
                    ? 'Open Upscale on an image first'
                    : hasOriginal
                      ? 'Try again'
                      : 'Run upscale'
                }
                aria-label={hasOriginal ? 'Try again' : 'Run upscale'}
                onClick={() => void start()}
              >
                <Play className="validation-run-icon" size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn validation-run-btn"
                disabled={!source || runAllCount < 1}
                title={
                  !source
                    ? 'Open Upscale on an image first'
                    : `Run all — this image plus ${pendingOthers} not yet upscaled (${runAllCount} total), same settings`
                }
                aria-label="Run all remaining"
                onClick={() => void startAll()}
              >
                <ListOrdered className="validation-run-icon" size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {progressForThisImage?.error && (
        <div className="error-banner">{progressForThisImage.error}</div>
      )}
    </div>
  )
}
