import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Droplet, Dumbbell, FileStack, Hash, Plus } from 'lucide-react'
import type { StressTestProgress } from '@shared/comfy'
import type { CheckpointEntry, DatasetOutputs } from '@shared/ipc/contract'
import { isTypingTarget, wrapIndex } from '@shared/keyboard'
import { buildStressSetPreviews } from '@shared/stress-set-previews'
import {
  nextPreviewIndexAfterListChange,
  previewIndexForSetChange
} from '@shared/validation-set-previews'
import { datasetMediaUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { ComfyModelMultiSelectDialog } from './ComfyModelMultiSelectDialog'
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
  loraWeight: number
  styleIndex: 0 | 1
  models: string[]
  checkpointFileName: string | null
}

type Preview = { stem: string; relativePath: string; modelHint?: string }

function normalizeSets(list: SetSummary[]): SetSummary[] {
  return list.map((s) => ({
    ...s,
    styleIndex: s.styleIndex === 1 ? 1 : 0,
    models: Array.isArray(s.models) ? s.models : [],
    checkpointFileName: s.checkpointFileName ?? null
  }))
}

export function StressTestDetailsPanel(props: {
  datasetId: string
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const stressFocusRequest = useAppStore((s) => s.stressFocusRequest)
  const { ask, dialog } = useConfirm()

  const [sets, setSets] = useState<SetSummary[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState<StressTestProgress | null>(null)
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [previews, setPreviews] = useState<Preview[]>([])
  const [modelsDialogOpen, setModelsDialogOpen] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const imageIndexRef = useRef(0)
  /** Preferred image number across sets; start high so the first paint shows the latest. */
  const preferredImageIndexRef = useRef(Number.MAX_SAFE_INTEGER)
  const setImagesRef = useRef<ReturnType<typeof buildStressSetPreviews>>([])
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
      await window.loraTraining.comfy.listStressTestSets(props.datasetId)
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
          await window.loraTraining.comfy.listStressPreviews(props.datasetId, setIndex)
        ) as Preview[]
        setPreviews(list)
      } catch {
        setPreviews([])
      }
    },
    [props.datasetId]
  )

  const deleteStressImage = useCallback(
    async (relativePath: string): Promise<void> => {
      const setLabel = activeLabelRef.current
      if (!setLabel) return
      const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? ''
      const stem = base.replace(/\.(jpe?g|png|webp)$/i, '')
      if (!stem) return
      const ok = await ask({
        title: 'Delete preview image?',
        message: `Delete the ${setLabel} preview for model “${stem}”? You can regenerate it with Run.`,
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
    onDelete: deleteStressImage,
    deleteLabel: 'Delete',
    deleteTitle: 'Delete this stress-test preview image'
  })

  useEffect(() => {
    void loadSets().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    void loadCheckpoints()
  }, [loadSets, loadCheckpoints, setError])

  // Jump from the header "Stressing" nav button.
  useEffect(() => {
    if (!stressFocusRequest) return
    if (stressFocusRequest.datasetId !== props.datasetId) return
    preferredImageIndexRef.current = Number.MAX_SAFE_INTEGER
    setActiveIndex(stressFocusRequest.setIndex)
  }, [stressFocusRequest, props.datasetId])

  useEffect(() => {
    void loadPreviews(activeIndex)
  }, [active?.label, activeIndex, loadPreviews])

  useEffect(() => {
    void window.loraTraining.comfy.getStressTestProgress().then((r) => {
      try {
        setProgress(unwrap(r) as StressTestProgress)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type === 'stress-progress') {
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
        event.type === 'stress-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void loadPreviews(activeIndex)
      }
    })
  }, [props.datasetId, activeIndex, loadPreviews])

  const setImages = useMemo(
    () =>
      buildStressSetPreviews({
        diskPreviews: previews,
        models: active?.models ?? [],
        datasetId: props.datasetId,
        setIndex: activeIndex,
        progress
      }),
    [active?.models, activeIndex, previews, progress, props.datasetId]
  )

  // Keep index in sync when the list grows/shrinks or the active set changes.
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
      // Prefer the just-written live preview (same as following last when appended).
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
      await window.loraTraining.comfy.updateStressTestSet(props.datasetId, active.index, {
        prompt: patch.prompt,
        seed: patch.seed,
        loraWeight: patch.loraWeight,
        styleIndex: patch.styleIndex,
        models: patch.models,
        checkpointFileName: patch.checkpointFileName
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
          loraWeight: active.loraWeight,
          styleIndex: active.styleIndex,
          models: active.models,
          checkpointFileName: active.checkpointFileName
        })
      }
      const list = unwrap(
        await window.loraTraining.comfy.addStressTestSet(props.datasetId)
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex(list.length - 1)
      setStatus(`Added ${list[list.length - 1]?.label ?? 'stress set'}`)
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
        await window.loraTraining.comfy.removeStressTestSet(props.datasetId, active.index)
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
        await window.loraTraining.comfy.clearStressTestSetImages(props.datasetId, active.index)
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
      setError('Pick a LoRA checkpoint for this stress set before running.')
      return
    }
    if (active.models.length === 0) {
      setError('Select at least one Comfy model to stress-test.')
      return
    }
    try {
      await persist({
        prompt: active.prompt,
        seed: active.seed,
        loraWeight: active.loraWeight,
        styleIndex: active.styleIndex,
        models: active.models,
        checkpointFileName: active.checkpointFileName
      })
      const ready = await ensureComfyReachable({ settings, ask, setStatus, setError })
      if (!ready) return
      unwrap(await window.loraTraining.comfy.startStressTest(props.datasetId))
      setStatus(
        `Stress-test started · all ${sets.length} set${sets.length === 1 ? '' : 's'} (missing model previews)`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const modelsSummary =
    !active || active.models.length === 0
      ? 'No models selected'
      : active.models.length === 1
        ? active.models[0]
        : `${active.models.length} models selected`

  return (
    <div className="panel details-panel validation-details">
      {dialog}
      {revealMenuEl}
      <ComfyModelMultiSelectDialog
        open={modelsDialogOpen}
        selected={
          active && active.models.length > 0
            ? active.models
            : (settings?.lastStressModels ?? [])
        }
        onCancel={() => setModelsDialogOpen(false)}
        onPruned={(kept, removed) => {
          patchActive({ models: kept })
          void (async () => {
            try {
              await persist({ models: kept })
              useAppStore.setState((s) => ({
                settings: s.settings
                  ? { ...s.settings, lastStressModels: kept }
                  : s.settings
              }))
              setStatus(
                `Removed ${removed.length} missing model${removed.length === 1 ? '' : 's'} no longer in Comfy`
              )
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          })()
        }}
        onConfirm={(models) => {
          setModelsDialogOpen(false)
          patchActive({ models })
          void (async () => {
            try {
              await persist({ models })
              useAppStore.setState((s) => ({
                settings: s.settings
                  ? { ...s.settings, lastStressModels: models }
                  : s.settings
              }))
              setStatus(
                models.length === 0
                  ? 'Cleared default stress models'
                  : `Saved ${models.length} model${models.length === 1 ? '' : 's'} as default for new stress sets`
              )
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          })()
        }}
      />

      <div className="details-meta validation-details-form">
        <div className="validation-set-tabs" role="tablist" aria-label="Stress-test sets">
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
            title="Add stress set (prompt/seed from previous; models from last Select models… Apply)"
            aria-label="Add stress set"
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
                placeholder="Positive prompt for this stress set"
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
            <div className="toolbar validation-stress-models-row">
              <button
                type="button"
                disabled={activeIsRunningSet}
                title="Choose which ComfyUI models to run against this LoRA"
                onClick={() => setModelsDialogOpen(true)}
              >
                Select models…
              </button>
              <span className="hint mono" title={modelsSummary}>
                {modelsSummary}
              </span>
            </div>
            <div className="validation-fields-row">
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
              <label className="validation-field validation-field-weight" title="LoRA weight">
                <span className="validation-field-icon" aria-hidden="true">
                  <Dumbbell className="validation-field-svg" strokeWidth={2} />
                </span>
                <input
                  type="number"
                  className="validation-num"
                  step={0.05}
                  value={active.loraWeight}
                  aria-label="Weight"
                  disabled={activeIsRunningSet}
                  onChange={(e) => patchActive({ loraWeight: Number(e.target.value) })}
                  onBlur={() => void persist({ loraWeight: active.loraWeight })}
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
            </div>
          </div>
        ) : null}
      </div>

      <ValidationPreviewToolbar
        panelKind="stress"
        datasetId={props.datasetId}
        activeSetIndex={activeIndex}
        activeSetLabel={active?.label ?? null}
        canRun={Boolean(active)}
        canRemove={Boolean(active) && sets.length > 1}
        localProgress={progress}
        runningDetail={
          activeIsRunningSet && progress?.currentModel ? progress.currentModel : null
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
                aria-label="Stress-test previews in this set"
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
              {active?.checkpointFileName
                ? ` · LoRA ${active.checkpointFileName}`
                : ''}
            </p>
          </>
        ) : (
          <div className="empty validation-live-preview-empty">
            {activeIsRunningSet
              ? 'Waiting for first preview…'
              : active?.models.length
                ? 'No previews yet for this set — pick a LoRA and Run'
                : 'Select models and a LoRA checkpoint, then Run'}
          </div>
        )}
      </div>
    </div>
  )
}
