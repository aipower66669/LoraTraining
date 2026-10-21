import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Droplet, FileStack, Hash, Plus } from 'lucide-react'
import type { WeightValidationProgress } from '@shared/comfy'
import type { CheckpointEntry, DatasetOutputs } from '@shared/ipc/contract'
import { isTypingTarget, wrapIndex } from '@shared/keyboard'
import {
  enumerateWeightSteps,
  formatWeightPreviewStem,
  formatWeightToken
} from '@shared/weight-sets'
import {
  nextPreviewIndexAfterListChange,
  previewIndexForSetChange
} from '@shared/validation-set-previews'
import { VALIDATION_MODEL_DEFAULT } from '@shared/validation-model'
import { datasetMediaUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { ComfyModelSelect } from './ComfyModelSelect'
import { ensureComfyReachable } from './ensureComfyReachable'
import { useRevealInExplorerMenu } from './RevealInExplorerMenu'
import { useConfirm } from './useConfirm'
import { PromptField } from './prompt/PromptField'
import { ValidationPreviewToolbar } from './ValidationPreviewToolbar'
import { cancelActivePreviewRun, useActivePreviewRun } from './useActivePreviewRun'

type SetSummary = {
  index: number
  label: string
  prompt: string
  seed: number
  styleIndex: 0 | 1
  validationModel: string
  checkpointFileName: string | null
  weightMin: number
  weightMax: number
  weightStep: number
}

type Preview = { stem: string; relativePath: string }

type WeightSetPreview = {
  relativePath: string
  stem: string
  bust: string
}

function normalizeSets(list: SetSummary[]): SetSummary[] {
  return list.map((s) => ({
    ...s,
    styleIndex: s.styleIndex === 1 ? 1 : 0,
    validationModel: s.validationModel?.trim() || VALIDATION_MODEL_DEFAULT,
    checkpointFileName: s.checkpointFileName ?? null
  }))
}

function buildWeightSetPreviews(opts: {
  diskPreviews: ReadonlyArray<Preview>
  checkpointFileName: string | null
  weightMin: number
  weightMax: number
  weightStep: number
  datasetId: string
  setIndex: number
  progress: WeightValidationProgress | null
}): WeightSetPreview[] {
  const byStemLower = new Map(
    opts.diskPreviews.map((p) => [p.stem.toLowerCase(), p] as const)
  )
  const out: WeightSetPreview[] = []
  const seen = new Set<string>()
  const checkpoint = opts.checkpointFileName?.trim() || ''
  const enumerated = enumerateWeightSteps(opts.weightMin, opts.weightMax, opts.weightStep)

  if (enumerated.ok && checkpoint) {
    for (const w of enumerated.weights) {
      const stem = formatWeightPreviewStem(checkpoint, w)
      const disk = byStemLower.get(stem.toLowerCase())
      if (!disk || seen.has(disk.relativePath)) continue
      seen.add(disk.relativePath)
      out.push({ relativePath: disk.relativePath, stem: disk.stem, bust: disk.stem })
    }
  }

  for (const p of opts.diskPreviews) {
    if (seen.has(p.relativePath)) continue
    seen.add(p.relativePath)
    out.push({ relativePath: p.relativePath, stem: p.stem, bust: p.stem })
  }

  const progress = opts.progress
  if (
    progress?.status === 'running' &&
    progress.datasetId === opts.datasetId &&
    progress.setIndex === opts.setIndex &&
    progress.lastPreviewRelativePath
  ) {
    const path = progress.lastPreviewRelativePath.replace(/\\/g, '/')
    const bust = `${progress.jobsCompleted}:${path}`
    const base = path.split('/').pop() ?? path
    const stem =
      (progress.lastPreviewFileName ??
        (progress.currentWeight != null && checkpoint
          ? formatWeightPreviewStem(checkpoint, progress.currentWeight)
          : null) ??
        base
      ).replace(/\.(jpe?g|png|webp|safetensors)$/i, '') || base
    const existing = out.findIndex((p) => p.relativePath.replace(/\\/g, '/') === path)
    if (existing >= 0) {
      out[existing] = { ...out[existing]!, bust }
    } else {
      out.push({ relativePath: path, stem, bust })
    }
  }

  return out
}

export function WeightValidationDetailsPanel(props: {
  datasetId: string
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const weightFocusRequest = useAppStore((s) => s.weightFocusRequest)
  const { ask, dialog } = useConfirm()

  const [sets, setSets] = useState<SetSummary[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState<WeightValidationProgress | null>(null)
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [previews, setPreviews] = useState<Preview[]>([])
  const [imageIndex, setImageIndex] = useState(0)
  const imageIndexRef = useRef(0)
  const preferredImageIndexRef = useRef(Number.MAX_SAFE_INTEGER)
  const setImagesRef = useRef<WeightSetPreview[]>([])
  const activeLabelRef = useRef<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)

  const active = sets[activeIndex] ?? null
  const activePreviewRun = useActivePreviewRun()
  const previewRunning = activePreviewRun != null
  const running = progress?.status === 'running'
  const activeIsRunningSet =
    running && progress?.datasetId === props.datasetId && progress?.setIndex === activeIndex

  const loadSets = useCallback(async (): Promise<void> => {
    const list = unwrap(
      await window.loraTraining.comfy.listWeightSets(props.datasetId)
    ) as SetSummary[]
    setSets(normalizeSets(list))
    setActiveIndex((i) => Math.min(i, Math.max(0, list.length - 1)))
  }, [props.datasetId])

  const loadCheckpoints = useCallback(async (): Promise<void> => {
    try {
      const outputs = unwrap(
        await window.loraTraining.datasets.listOutputs(props.datasetId)
      ) as DatasetOutputs
      setCheckpoints(outputs.checkpoints)
    } catch {
      setCheckpoints([])
    }
  }, [props.datasetId])

  const loadPreviews = useCallback(
    async (setIndex: number): Promise<void> => {
      try {
        const list = unwrap(
          await window.loraTraining.comfy.listWeightPreviews(props.datasetId, setIndex)
        ) as Preview[]
        setPreviews(list)
      } catch {
        setPreviews([])
      }
    },
    [props.datasetId]
  )

  const deleteWeightImage = useCallback(
    async (relativePath: string): Promise<void> => {
      const setLabel = activeLabelRef.current
      if (!setLabel) return
      const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? ''
      const stem = base.replace(/\.(jpe?g|png|webp)$/i, '')
      if (!stem) return
      const ok = await ask({
        title: 'Delete preview image?',
        message: `Delete the ${setLabel} preview for weight “${stem}”? You can regenerate it with Run.`,
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
      try {
        unwrap(
          await window.loraTraining.datasets.deleteValidationPreview(
            props.datasetId,
            setLabel,
            stem
          )
        )
        setStatus(`Deleted ${setLabel} preview for ${stem}`)
        await loadPreviews(activeIndex)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [ask, activeIndex, loadPreviews, props.datasetId, setError, setStatus]
  )

  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId, {
    onDelete: deleteWeightImage,
    deleteLabel: 'Delete',
    deleteTitle: 'Delete this weight-validation preview image'
  })

  useEffect(() => {
    void loadSets().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    void loadCheckpoints()
  }, [loadSets, loadCheckpoints, setError])

  useEffect(() => {
    if (!weightFocusRequest) return
    if (weightFocusRequest.datasetId !== props.datasetId) return
    preferredImageIndexRef.current = Number.MAX_SAFE_INTEGER
    setActiveIndex(weightFocusRequest.setIndex)
  }, [weightFocusRequest, props.datasetId])

  useEffect(() => {
    void loadPreviews(activeIndex)
  }, [active?.label, activeIndex, loadPreviews])

  useEffect(() => {
    void window.loraTraining.comfy.getWeightValidationProgress().then((r) => {
      try {
        setProgress(unwrap(r) as WeightValidationProgress)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type === 'weight-progress') {
        setProgress(event.payload)
        if (
          event.payload.datasetId === props.datasetId &&
          (event.payload.jobsCompleted > 0 ||
            event.payload.status === 'done' ||
            event.payload.status === 'cancelled' ||
            event.payload.status === 'error')
        ) {
          void loadPreviews(activeIndex)
        }
      }
      if (
        event.type === 'weight-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void loadPreviews(activeIndex)
      }
    })
  }, [props.datasetId, activeIndex, loadPreviews])

  const setImages = useMemo(
    () =>
      buildWeightSetPreviews({
        diskPreviews: previews,
        checkpointFileName: active?.checkpointFileName ?? null,
        weightMin: active?.weightMin ?? 0,
        weightMax: active?.weightMax ?? 0,
        weightStep: active?.weightStep ?? 0,
        datasetId: props.datasetId,
        setIndex: activeIndex,
        progress
      }),
    [
      active?.checkpointFileName,
      active?.weightMax,
      active?.weightMin,
      active?.weightStep,
      activeIndex,
      previews,
      progress,
      props.datasetId
    ]
  )

  useEffect(() => {
    const prev = setImagesRef.current
    const prevLabel = activeLabelRef.current
    const nextLabel = active?.label ?? null
    const setChanged = prevLabel !== nextLabel
    let nextIndex: number
    if (setChanged) {
      nextIndex = previewIndexForSetChange(preferredImageIndexRef.current, setImages.length)
    } else {
      nextIndex = nextPreviewIndexAfterListChange({
        prevLength: prev.length,
        prevIndex: imageIndexRef.current,
        nextLength: setImages.length
      })
      const livePath = progress?.lastPreviewRelativePath?.replace(/\\/g, '/')
      if (
        livePath &&
        progress?.datasetId === props.datasetId &&
        progress.setIndex === activeIndex &&
        (progress.status === 'running' || progress.jobsCompleted > 0)
      ) {
        const liveIdx = setImages.findIndex(
          (p) => p.relativePath.replace(/\\/g, '/') === livePath
        )
        if (liveIdx >= 0) nextIndex = liveIdx
      }
    }
    setImagesRef.current = setImages
    activeLabelRef.current = nextLabel
    imageIndexRef.current = nextIndex
    preferredImageIndexRef.current = nextIndex
    setImageIndex(nextIndex)
  }, [
    active?.label,
    activeIndex,
    progress?.datasetId,
    progress?.jobsCompleted,
    progress?.lastPreviewRelativePath,
    progress?.setIndex,
    progress?.status,
    props.datasetId,
    setImages
  ])

  const currentPreview = setImages[imageIndex] ?? setImages[setImages.length - 1] ?? null
  const previewSrc = currentPreview
    ? datasetMediaUrl(props.datasetId, currentPreview.relativePath, currentPreview.bust)
    : null

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    })
  }, [imageIndex, active?.label, setImages.length])

  const weightHint = useMemo(() => {
    if (!active) return null
    const result = enumerateWeightSteps(active.weightMin, active.weightMax, active.weightStep)
    if (!result.ok) return { error: result.error }
    const stems = result.weights.map(formatWeightToken).join(', ')
    return { text: `${result.weights.length} images: ${stems}` }
  }, [active?.weightMax, active?.weightMin, active?.weightStep])

  const selectImageIndex = useCallback((next: number) => {
    if (setImagesRef.current.length === 0) return
    const clamped = Math.min(Math.max(0, next), setImagesRef.current.length - 1)
    imageIndexRef.current = clamped
    preferredImageIndexRef.current = clamped
    setImageIndex(clamped)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (setImagesRef.current.length === 0) return
        e.preventDefault()
        const delta = e.key === 'ArrowRight' ? 1 : -1
        selectImageIndex(wrapIndex(imageIndexRef.current + delta, setImagesRef.current.length))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectImageIndex])

  async function persist(patch: Partial<SetSummary>): Promise<void> {
    if (!active) return
    const list = unwrap(
      await window.loraTraining.comfy.updateWeightSet(props.datasetId, active.index, {
        prompt: patch.prompt,
        seed: patch.seed,
        styleIndex: patch.styleIndex,
        validationModel: patch.validationModel,
        checkpointFileName: patch.checkpointFileName,
        weightMin: patch.weightMin,
        weightMax: patch.weightMax,
        weightStep: patch.weightStep
      })
    ) as SetSummary[]
    setSets(normalizeSets(list))
  }

  function patchActive(patch: Partial<SetSummary>): void {
    setSets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, ...patch } : s))
    )
  }

  async function addSet(): Promise<void> {
    try {
      if (active) {
        await persist({
          prompt: active.prompt,
          seed: active.seed,
          styleIndex: active.styleIndex,
          validationModel: active.validationModel,
          checkpointFileName: active.checkpointFileName,
          weightMin: active.weightMin,
          weightMax: active.weightMax,
          weightStep: active.weightStep
        })
      }
      const list = unwrap(
        await window.loraTraining.comfy.addWeightSet(props.datasetId)
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex(list.length - 1)
      setStatus(`Added ${list[list.length - 1]?.label ?? 'weight set'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeSet(): Promise<void> {
    if (!active || sets.length <= 1) return
    const ok = await ask({
      title: `Remove ${active.label}?`,
      message: `Delete ${active.label} and all of its preview images? Remaining sets will be renumbered.`,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    try {
      const list = unwrap(
        await window.loraTraining.comfy.removeWeightSet(props.datasetId, active.index)
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex((i) => Math.min(i, list.length - 1))
      setStatus(`Removed set · now ${list.length} set(s)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function clearImages(): Promise<void> {
    if (!active) return
    const ok = await ask({
      title: `Clear ${active.label} images?`,
      message: previewRunning
        ? `This will cancel the current preview run and delete all preview images in ${active.label}. Settings are kept.`
        : `Delete all preview images in ${active.label} so Run regenerates from scratch. Settings are kept.`,
      confirmLabel: 'Clear images',
      danger: true
    })
    if (!ok) return
    try {
      if (activePreviewRun) await cancelActivePreviewRun(activePreviewRun.kind)
      unwrap(
        await window.loraTraining.comfy.clearWeightSetImages(props.datasetId, active.index)
      )
      setStatus(`Cleared images for ${active.label}`)
      await loadPreviews(active.index)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function start(): Promise<void> {
    if (!active) return
    if (!active.checkpointFileName) {
      setError('Pick a LoRA checkpoint for this weight set before running.')
      return
    }
    const enumerated = enumerateWeightSteps(active.weightMin, active.weightMax, active.weightStep)
    if (!enumerated.ok) {
      setError(enumerated.error)
      return
    }
    try {
      await persist({
        prompt: active.prompt,
        seed: active.seed,
        styleIndex: active.styleIndex,
        validationModel: active.validationModel,
        checkpointFileName: active.checkpointFileName,
        weightMin: active.weightMin,
        weightMax: active.weightMax,
        weightStep: active.weightStep
      })
      const ready = await ensureComfyReachable({ settings, ask, setStatus, setError })
      if (!ready) return
      unwrap(await window.loraTraining.comfy.startWeightValidation(props.datasetId))
      setStatus(
        `Weight validation started · all ${sets.length} set${sets.length === 1 ? '' : 's'} (missing weight previews)`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="panel details-panel validation-details">
      {dialog}
      {revealMenuEl}

      <div className="details-meta validation-details-form">
        <div className="validation-set-tabs" role="tablist" aria-label="Weight-validation sets">
          {sets.map((s) => (
            <button
              key={s.index}
              type="button"
              role="tab"
              aria-selected={s.index === activeIndex}
              className={`validation-set-tab${s.index === activeIndex ? ' active' : ''}`}
              onClick={() => setActiveIndex(s.index)}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className="icon-btn"
            title="Add weight set (clones range from the previous set)"
            aria-label="Add weight set"
            onClick={() => void addSet()}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {active ? (
          <div className="form-grid validation-set-fields">
            <div className="validation-prompt-field">
              <PromptField
                rows={2}
                value={active.prompt}
                disabled={activeIsRunningSet}
                onChange={(prompt) => patchActive({ prompt })}
                onBlur={() => void persist({ prompt: active.prompt })}
                placeholder="Positive prompt for this weight set"
              />
            </div>
            <label
              className="validation-field validation-field-checkpoint"
              title="LoRA checkpoint under dataset output/"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <FileStack className="validation-field-svg" strokeWidth={2} />
              </span>
              <select
                value={active.checkpointFileName ?? ''}
                aria-label="LoRA checkpoint"
                disabled={activeIsRunningSet}
                onChange={(e) => {
                  const v = e.target.value || null
                  patchActive({ checkpointFileName: v })
                  void persist({ checkpointFileName: v })
                }}
              >
                <option value="">— pick a checkpoint —</option>
                {checkpoints.map((cp) => (
                  <option key={cp.relativePath} value={cp.fileName}>
                    {cp.fileName}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="validation-field validation-field-model validation-field-model-block"
              title="Model for this set — checkpoint / UNET (Default = Settings → ComfyUI)"
            >
              <span className="validation-field-icon" aria-hidden="true">
                <Box className="validation-field-svg" strokeWidth={2} />
              </span>
              <ComfyModelSelect
                compact
                includeDefault
                disabled={activeIsRunningSet}
                value={active.validationModel || VALIDATION_MODEL_DEFAULT}
                title="Model for this set — Default uses Settings → ComfyUI default validation model"
                onChange={(next) => {
                  patchActive({ validationModel: next })
                  void persist({ validationModel: next })
                }}
              />
            </label>
            <div
              className="validation-fields-row"
              title={weightHint?.text ?? weightHint?.error ?? undefined}
            >
              <label className="validation-field validation-field-seed" title="Seed — ≤0 = random">
                <span className="validation-field-icon" aria-hidden="true">
                  <Hash className="validation-field-svg" strokeWidth={2} />
                </span>
                <input
                  type="number"
                  className="validation-num"
                  value={active.seed}
                  aria-label="Seed"
                  disabled={activeIsRunningSet}
                  onChange={(e) => patchActive({ seed: Number(e.target.value) })}
                  onBlur={() => void persist({ seed: active.seed })}
                />
              </label>
              <label
                className="validation-field validation-field-style"
                title="Style — injected into LT · Style Index"
              >
                <span className="validation-field-icon" aria-hidden="true">
                  <Droplet className="validation-field-svg" strokeWidth={2} />
                </span>
                <select
                  className="validation-style"
                  value={active.styleIndex === 1 ? 1 : 0}
                  aria-label="Style"
                  disabled={activeIsRunningSet}
                  onChange={(e) => {
                    const styleIndex = Number(e.target.value) === 1 ? 1 : 0
                    patchActive({ styleIndex })
                    void persist({ styleIndex })
                  }}
                >
                  <option value={0}>Real</option>
                  <option value={1}>Anime</option>
                </select>
              </label>
              <label
                className="validation-field validation-field-weight"
                title={
                  weightHint?.text
                    ? `Weight min (inclusive) — ${weightHint.text}`
                    : 'Weight min (inclusive)'
                }
              >
                <span className="field-label-inline" aria-hidden="true">
                  Min
                </span>
                <input
                  type="number"
                  className="validation-num"
                  step={0.05}
                  value={active.weightMin}
                  aria-label="Weight min"
                  disabled={activeIsRunningSet}
                  onChange={(e) => patchActive({ weightMin: Number(e.target.value) })}
                  onBlur={() => void persist({ weightMin: active.weightMin })}
                />
              </label>
              <label
                className="validation-field validation-field-weight"
                title="Weight max (inclusive)"
              >
                <span className="field-label-inline" aria-hidden="true">
                  Max
                </span>
                <input
                  type="number"
                  className="validation-num"
                  step={0.05}
                  value={active.weightMax}
                  aria-label="Weight max"
                  disabled={activeIsRunningSet}
                  onChange={(e) => patchActive({ weightMax: Number(e.target.value) })}
                  onBlur={() => void persist({ weightMax: active.weightMax })}
                />
              </label>
              <label className="validation-field validation-field-weight" title="Weight step">
                <span className="field-label-inline" aria-hidden="true">
                  Step
                </span>
                <input
                  type="number"
                  className="validation-num"
                  step={0.05}
                  value={active.weightStep}
                  aria-label="Weight step"
                  disabled={activeIsRunningSet}
                  onChange={(e) => patchActive({ weightStep: Number(e.target.value) })}
                  onBlur={() => void persist({ weightStep: active.weightStep })}
                />
              </label>
            </div>
            {weightHint?.error ? (
              <p className="hint" style={{ margin: 0, color: 'var(--danger)' }}>
                {weightHint.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <ValidationPreviewToolbar
        panelKind="weight"
        datasetId={props.datasetId}
        activeSetIndex={activeIndex}
        activeSetLabel={active?.label ?? null}
        canRun={Boolean(active)}
        canRemove={Boolean(active) && sets.length > 1}
        localProgress={progress}
        runningDetail={
          activeIsRunningSet && progress?.currentWeight != null
            ? `Weight ${formatWeightToken(progress.currentWeight)}`
            : null
        }
        onRun={() => void start()}
        onClear={() => void clearImages()}
        onRemove={() => void removeSet()}
      />

      <div className="validation-live-preview">
        {previewSrc && currentPreview ? (
          <>
            <div
              className="validation-image-wrap"
              onContextMenu={(e) => openRevealMenu(e, currentPreview.relativePath)}
            >
              <img
                className="validation-image"
                src={previewSrc}
                alt={currentPreview.stem}
              />
            </div>
            {setImages.length > 0 ? (
              <div
                ref={stripRef}
                className="validation-preview-strip"
                role="listbox"
                aria-label="Weight-validation previews in this set"
              >
                {setImages.map((img, i) => {
                  const src = datasetMediaUrl(props.datasetId, img.relativePath, img.bust)
                  const selected = i === imageIndex
                  return (
                    <button
                      key={img.relativePath}
                      ref={selected ? activeThumbRef : undefined}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`validation-preview-thumb${selected ? ' active' : ''}`}
                      title={img.stem}
                      onClick={() => selectImageIndex(i)}
                      onContextMenu={(e) => {
                        selectImageIndex(i)
                        openRevealMenu(e, img.relativePath)
                      }}
                    >
                      <img src={src} alt="" draggable={false} />
                    </button>
                  )
                })}
              </div>
            ) : null}
            <p className="validation-live-preview-label hint" title={currentPreview.stem}>
              {currentPreview.stem}
              {setImages.length > 1 ? ` · ${imageIndex + 1}/${setImages.length}` : ''}
              {active?.checkpointFileName ? ` · LoRA ${active.checkpointFileName}` : ''}
            </p>
          </>
        ) : (
          <div className="empty validation-live-preview-empty">
            {activeIsRunningSet
              ? 'Waiting for first preview…'
              : active?.checkpointFileName
                ? 'No previews yet for this set — pick weights and Run'
                : 'Select a LoRA checkpoint and weight range, then Run'}
          </div>
        )}
      </div>
    </div>
  )
}
