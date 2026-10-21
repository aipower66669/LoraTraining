import { useCallback, useEffect, useState } from 'react'
import { Copy, Hash, ListOrdered, Play, Square } from 'lucide-react'
import type { DiversifyMode } from '@shared/diversify-config'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'
import type { DiversifyProgress } from '@shared/comfy'
import { imageStem } from '@shared/schemas/dataset'
import { isDiversifySiblingStem } from '@shared/diversify-filename'
import { unwrap, useAppStore } from '../store'
import { writeLastDiversifyMode } from '../store/actions'
import { ensureComfyReachable } from './ensureComfyReachable'
import { useConfirm } from './useConfirm'

type DiversifyConfigState = {
  prompt: string
  seed: number
  count: number
}

function normalizeConfig(c: Partial<DiversifyConfigState>): DiversifyConfigState {
  const count = Math.max(1, Math.min(64, Math.floor(c.count ?? 1)))
  return {
    prompt: c.prompt ?? '',
    seed: c.seed ?? 0,
    count
  }
}

export function DiversifyDetailsPanel(props: {
  datasetId: string
  mode: DiversifyMode
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const setDatasetsMiddleTab = useAppStore((s) => s.setDatasetsMiddleTab)
  const rawSource = useAppStore((s) => s.diversifySource)
  const source = rawSource && rawSource.datasetId === props.datasetId ? rawSource : null
  const { ask, dialog } = useConfirm()
  const label = props.mode === 'context' ? 'Context' : 'Expression'

  const [config, setConfig] = useState<DiversifyConfigState>(normalizeConfig({}))
  const [configLoading, setConfigLoading] = useState(false)
  const [progress, setProgress] = useState<DiversifyProgress | null>(null)

  useEffect(() => {
    writeLastDiversifyMode(props.mode)
  }, [props.mode])

  const loadConfig = useCallback(async (): Promise<void> => {
    if (!source) {
      setConfig(normalizeConfig({}))
      setConfigLoading(false)
      return
    }
    const datasetId = source.datasetId
    const fileName = source.fileName
    setConfigLoading(true)
    setConfig(normalizeConfig({}))
    try {
      const raw = unwrap(
        await window.loraTraining.diversify.getConfig(props.mode, datasetId, fileName)
      ) as DiversifyConfigState
      const cur = useAppStore.getState().diversifySource
      if (!cur || cur.datasetId !== datasetId || cur.fileName !== fileName) return
      setConfig(normalizeConfig(raw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConfigLoading(false)
    }
  }, [source, setError, props.mode])

  const batchActive =
    progress?.status === 'running' &&
    progress.datasetId === props.datasetId &&
    progress.mode === props.mode &&
    (progress.batchTotal ?? 0) > 1

  useEffect(() => {
    if (batchActive) return
    void loadConfig()
  }, [loadConfig, batchActive])

  useEffect(() => {
    void window.loraTraining.diversify.getProgress().then((r) => {
      try {
        setProgress(unwrap(r) as DiversifyProgress)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type === 'diversify-progress') {
        setProgress(event.payload)
        if (event.payload.status === 'done') {
          setStatus(event.payload.lastMessage ?? `${label} complete`)
        }
      }
    })
  }, [setStatus, label])

  function patch(next: Partial<DiversifyConfigState>): void {
    setConfig((prev) => ({ ...prev, ...next }))
  }

  async function persist(next: Partial<DiversifyConfigState>): Promise<void> {
    if (!source) return
    try {
      const raw = unwrap(
        await window.loraTraining.diversify.updateConfig(
          props.mode,
          source.datasetId,
          source.fileName,
          next
        )
      ) as DiversifyConfigState
      setConfig(normalizeConfig(raw))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const running =
    progress?.status === 'running' &&
    progress.datasetId === props.datasetId &&
    progress.mode === props.mode &&
    (progress.fileName === source?.fileName || (progress.batchTotal ?? 0) > 1)
  const progressForThis =
    progress?.datasetId === props.datasetId &&
    progress?.mode === props.mode &&
    (progress?.fileName === source?.fileName || running)
      ? progress
      : null

  const comfyLiveLine =
    running && progressForThis
      ? formatComfyProgressLine({
          nodeTitle: progressForThis.comfyNodeTitle,
          step: progressForThis.comfyStep,
          max: progressForThis.comfyMax,
          detail: progressForThis.comfyDetail
        }) || null
      : null
  const comfyPct =
    running && progressForThis
      ? comfyStepPercent(progressForThis.comfyStep, progressForThis.comfyMax)
      : null

  const rootImages =
    datasetDetail?.images.filter((i) => !isDiversifySiblingStem(imageStem(i.fileName))) ?? []
  const runAllCount = rootImages.length

  async function start(): Promise<void> {
    if (!source) {
      setError(`Select an image and open Diversify · ${label} first.`)
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
      unwrap(await window.loraTraining.diversify.start(props.mode, source.datasetId, source.fileName))
      setStatus(
        props.mode === 'expression'
          ? `${label} started · ${config.count} image${config.count === 1 ? '' : 's'}…`
          : `${label} started · ${config.count} image${config.count === 1 ? '' : 's'} (seed ${
              config.seed <= 0 ? 'random' : config.seed
            })…`
      )
      if (props.mode === 'expression') {
        setDatasetsMiddleTab('images')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function startAll(): Promise<void> {
    if (!source) {
      setError(`Select an image and open Diversify · ${label} first.`)
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
        await window.loraTraining.diversify.startAll(props.mode, source.datasetId, source.fileName)
      ) as { started: true; queued: number }
      setStatus(
        `${label} all started · ${result.queued} job${result.queued === 1 ? '' : 's'} (roots × count)…`
      )
      if (props.mode === 'expression') {
        setDatasetsMiddleTab('images')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function stop(): Promise<void> {
    unwrap(await window.loraTraining.diversify.cancel())
    setStatus('Ready')
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
          {props.mode === 'context' ? (
            <>
              <label>
                Prompt
                <textarea
                  rows={2}
                  value={config.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  onBlur={() => void persist({ prompt: config.prompt })}
                  placeholder="Positive prompt"
                />
              </label>
              <div className="validation-fields-row">
                <label
                  className="validation-field validation-field-seed"
                  title="Seed — ≤0 = random base"
                >
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
                  className="validation-field validation-field-seed"
                  title="Count — new siblings per source image"
                >
                  <span className="validation-field-icon" aria-hidden="true">
                    <Copy className="validation-field-svg" strokeWidth={2} />
                  </span>
                  <input
                    type="number"
                    className="validation-num"
                    min={1}
                    max={64}
                    value={config.count}
                    aria-label="Count"
                    onChange={(e) => patch({ count: Number(e.target.value) })}
                    onBlur={() => void persist({ count: config.count })}
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="validation-fields-row">
              <label
                className="validation-field validation-field-seed"
                title="Count — new siblings per source image (each run gets a fresh random LT · Seed)"
              >
                <span className="validation-field-icon" aria-hidden="true">
                  <Copy className="validation-field-svg" strokeWidth={2} />
                </span>
                <input
                  type="number"
                  className="validation-num"
                  min={1}
                  max={64}
                  value={config.count}
                  aria-label="Count"
                  onChange={(e) => patch({ count: Number(e.target.value) })}
                  onBlur={() => void persist({ count: config.count })}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="validation-preview-toolbar">
        <div className="validation-preview-progress" aria-live="polite">
          {running ? (
            <>
              <p className="validation-comfy-live-line mono">
                {comfyLiveLine ?? 'Waiting for ComfyUI…'}
                {(progressForThis?.batchTotal ?? 0) > 1
                  ? ` · ${progressForThis?.batchIndex ?? 0}/${progressForThis?.batchTotal}`
                  : ''}
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
              {progressForThis?.lastMessage ?? 'Idle'}
            </p>
          )}
        </div>
        <div className="toolbar validation-run-actions">
          {running ? (
            <button
              type="button"
              className="icon-btn danger validation-run-btn"
              title={`Stop ${label}`}
              aria-label={`Stop ${label}`}
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
                title={!source ? `Open Diversify · ${label} on an image first` : `Run ${label}`}
                aria-label={`Run ${label}`}
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
                    ? `Open Diversify · ${label} on an image first`
                    : `Run all — ${runAllCount} root image${runAllCount === 1 ? '' : 's'} × count ${config.count}`
                }
                aria-label="Run all roots"
                onClick={() => void startAll()}
              >
                <ListOrdered className="validation-run-icon" size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {progressForThis?.error && <div className="error-banner">{progressForThis.error}</div>}
    </div>
  )
}
