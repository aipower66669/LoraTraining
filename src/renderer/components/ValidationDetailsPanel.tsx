import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Dices, Droplet, Dumbbell, Hash, Plus } from 'lucide-react'
import { type ValidationProgress } from '@shared/comfy'
import type { CheckpointEntry, DatasetOutputs } from '@shared/ipc/contract'
import { isTypingTarget, wrapIndex } from '@shared/keyboard'
import {
  buildValidationSetPreviews,
  nextPreviewIndexAfterListChange,
  previewIndexForPreferredStep
} from '@shared/validation-set-previews'
import { checkpointStepFromName } from '@shared/checkpoints'
import { VALIDATION_MODEL_DEFAULT } from '@shared/validation-model'
import { jobBreadcrumbLabel } from '@shared/dataset-jobs'
import { datasetMediaUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { ComfyModelSelect } from './ComfyModelSelect'
import { ConfirmDialog } from './ConfirmDialog'
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
  validationModel: string
}

type CloneMode = 'overwrite' | 'add'

function normalizeSets(list: SetSummary[]): SetSummary[] {
  return list.map((s) => ({
    ...s,
    styleIndex: s.styleIndex === 1 ? 1 : 0,
    validationModel: s.validationModel?.trim() || VALIDATION_MODEL_DEFAULT
  }))
}

export function ValidationDetailsPanel(props: {
  datasetId: string
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const datasets = useAppStore((s) => s.datasets)
  const categories = useAppStore((s) => s.categories)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const settings = useAppStore((s) => s.settings)
  const validationFocusRequest = useAppStore((s) => s.validationFocusRequest)
  const { ask, dialog } = useConfirm()

  const [sets, setSets] = useState<SetSummary[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState<ValidationProgress | null>(null)
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneSourceId, setCloneSourceId] = useState('')
  const [cloneMode, setCloneMode] = useState<CloneMode>('add')
  const [cloneBusy, setCloneBusy] = useState(false)
  const [promptDiceBusy, setPromptDiceBusy] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const imageIndexRef = useRef(0)
  /** Preferred checkpoint step across sets (∞ = latest). Kept when snapping to nearest. */
  const preferredStepRef = useRef<number>(Number.POSITIVE_INFINITY)
  const setImagesRef = useRef<ReturnType<typeof buildValidationSetPreviews>>([])
  const activeLabelRef = useRef<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)

  const validatedSources = useMemo(() => {
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))
    return datasets
      .filter((d) => d.id !== props.datasetId && d.validated)
      .map((d) => ({
        ...d,
        breadcrumb: jobBreadcrumbLabel(categoryNameById.get(d.categoryId), d.name)
      }))
      .sort((a, b) =>
        a.breadcrumb.localeCompare(b.breadcrumb, undefined, { sensitivity: 'base' })
      )
  }, [datasets, categories, props.datasetId])
  const active = sets[activeIndex] ?? null
  const activePreviewRun = useActivePreviewRun()
  const previewRunning = activePreviewRun != null
  const running = progress?.status === 'running'
  const activeIsRunningSet =
    running && progress?.datasetId === props.datasetId && progress?.setIndex === activeIndex

  const setImages = useMemo(() => {
    if (!active) return []
    return buildValidationSetPreviews({
      checkpoints,
      setLabel: active.label,
      datasetId: props.datasetId,
      setIndex: activeIndex,
      progress
    })
  }, [active, activeIndex, checkpoints, progress, props.datasetId])

  // Keep index in sync when the list grows/shrinks or the active set changes.
  useEffect(() => {
    const prev = setImagesRef.current
    const prevLabel = activeLabelRef.current
    const nextLabel = active?.label ?? null
    const setChanged = prevLabel !== nextLabel
    let nextIndex: number
    if (setChanged) {
      // Match by training step (nearest if this set skipped a checkpoint).
      nextIndex = previewIndexForPreferredStep(preferredStepRef.current, setImages)
    } else {
      nextIndex = nextPreviewIndexAfterListChange({
        prevLength: prev.length,
        prevIndex: imageIndexRef.current,
        nextLength: setImages.length
      })
      const stepped = setImages[nextIndex]?.step
      if (stepped != null) preferredStepRef.current = stepped
    }
    setImagesRef.current = setImages
    activeLabelRef.current = nextLabel
    imageIndexRef.current = nextIndex
    setImageIndex(nextIndex)
  }, [active?.label, setImages])

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
    setImageIndex(clamped)
    const stepped = setImagesRef.current[clamped]?.step
    if (stepped != null) {
      preferredStepRef.current = stepped
    } else {
      const name = setImagesRef.current[clamped]?.fileName
      const parsed = name ? checkpointStepFromName(name) : null
      if (parsed != null) preferredStepRef.current = parsed
    }
  }, [])

  const selectSetIndex = useCallback((next: number) => {
    if (sets.length === 0) return
    setActiveIndex(wrapIndex(next, sets.length))
  }, [sets.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (cloneOpen || isTypingTarget(e.target)) return
      if (document.querySelector('.modal-backdrop')) return
      if (setImagesRef.current.length === 0 && sets.length <= 1) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (setImagesRef.current.length === 0) return
        e.preventDefault()
        const delta = e.key === 'ArrowLeft' ? -1 : 1
        selectImageIndex(
          wrapIndex(imageIndexRef.current + delta, setImagesRef.current.length)
        )
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (sets.length <= 1) return
        e.preventDefault()
        const delta = e.key === 'ArrowUp' ? -1 : 1
        selectSetIndex(activeIndex + delta)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, cloneOpen, selectImageIndex, selectSetIndex, sets.length])

  const loadSets = useCallback(async (): Promise<void> => {
    if (!props.datasetId) return
    const datasetId = props.datasetId
    setSets([])
    const list = unwrap(
      await window.loraTraining.comfy.listValidationSets(datasetId)
    ) as SetSummary[]
    setSets(normalizeSets(list))
    setActiveIndex((i) => Math.min(i, Math.max(0, list.length - 1)))
  }, [props.datasetId])

  const loadCheckpoints = useCallback(async (): Promise<void> => {
    if (!props.datasetId) return
    try {
      const outputs = unwrap(
        await window.loraTraining.datasets.listOutputs(props.datasetId)
      ) as DatasetOutputs
      setCheckpoints(outputs.checkpoints)
    } catch {
      setCheckpoints([])
    }
  }, [props.datasetId])

  const deleteValidationImage = useCallback(
    async (relativePath: string): Promise<void> => {
      const setLabel = activeLabelRef.current
      if (!setLabel) return
      const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? ''
      const stem = base.replace(/\.(jpe?g|png|webp)$/i, '')
      if (!stem) return
      const preview =
        setImagesRef.current.find((p) => p.relativePath === relativePath) ?? null
      const label = preview?.fileName ?? stem
      const ok = await ask({
        title: 'Delete preview image?',
        message: `Delete the ${setLabel} preview for ${label}? You can regenerate it with Run.`,
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
        await loadCheckpoints()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [ask, loadCheckpoints, props.datasetId, setError, setStatus]
  )

  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId, {
    onDelete: deleteValidationImage,
    deleteLabel: 'Delete',
    deleteTitle: 'Delete this validation preview image'
  })

  useEffect(() => {
    void loadSets().catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    )
    void loadCheckpoints()
  }, [loadSets, loadCheckpoints, setError])

  // Jump from the header "Validating" nav button.
  useEffect(() => {
    if (!validationFocusRequest) return
    if (validationFocusRequest.datasetId !== props.datasetId) return
    preferredStepRef.current = Number.POSITIVE_INFINITY
    setActiveIndex(validationFocusRequest.setIndex)
  }, [validationFocusRequest, props.datasetId])

  useEffect(() => {
    void window.loraTraining.comfy.getValidationProgress().then((r) => {
      try {
        setProgress(unwrap(r) as ValidationProgress)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type === 'validation-progress') {
        setProgress(event.payload)
        if (
          event.payload.status === 'done' ||
          event.payload.status === 'cancelled' ||
          event.payload.status === 'error' ||
          (event.payload.status === 'running' && event.payload.jobsCompleted > 0)
        ) {
          void loadCheckpoints()
        }
        if (event.payload.status === 'done') {
          setStatus(event.payload.lastMessage ?? 'Validation complete')
          // Validated flag is already synced + patched via dataset-folder-changed.
          // Do not refreshAll — that re-walks every dataset's output folder.
          const id = useAppStore.getState().selectedDatasetId
          if (id) void useAppStore.getState().loadDataset(id)
        }
      }
      if (
        event.type === 'validation-previews-changed' &&
        event.payload.datasetId === props.datasetId
      ) {
        void loadCheckpoints()
      }
    })
  }, [setStatus, loadCheckpoints, props.datasetId])

  async function persist(patch: Partial<SetSummary>): Promise<void> {
    if (!active) return
    try {
      const list = unwrap(
        await window.loraTraining.comfy.updateValidationSet(props.datasetId, active.index, {
          prompt: patch.prompt,
          seed: patch.seed,
          loraWeight: patch.loraWeight,
          styleIndex: patch.styleIndex,
          validationModel: patch.validationModel
        })
      ) as SetSummary[]
      setSets(normalizeSets(list))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function patchActive(patch: Partial<SetSummary>): void {
    setSets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, ...patch } : s))
    )
  }

  async function fillPromptFromRandomCaption(): Promise<void> {
    if (!active || promptDiceBusy) return
    const detail =
      datasetDetail?.id === props.datasetId
        ? datasetDetail
        : null
    const captioned =
      detail?.images.filter((img) => img.captionExists).map((img) => img.fileName) ?? []
    if (captioned.length === 0) {
      setError('No captioned images in this dataset — caption some images first.')
      return
    }
    const fileName = captioned[Math.floor(Math.random() * captioned.length)]!
    setPromptDiceBusy(true)
    try {
      const { text } = unwrap(
        await window.loraTraining.captions.get(props.datasetId, fileName)
      ) as { text: string | null }
      const prompt = (text ?? '').trim()
      if (!prompt) {
        setError(`Caption for “${fileName}” is empty — pick again or edit the caption.`)
        return
      }
      patchActive({ prompt })
      await persist({ prompt })
      setStatus(`Prompt filled from “${fileName}”`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPromptDiceBusy(false)
    }
  }

  async function addSet(): Promise<void> {
    try {
      // Persist active set first so the clone sees the latest style/prompt/seed.
      if (active) {
        await persist({
          prompt: active.prompt,
          seed: active.seed,
          loraWeight: active.loraWeight,
          styleIndex: active.styleIndex === 1 ? 1 : 0,
          validationModel: active.validationModel
        })
      }
      const list = unwrap(
        await window.loraTraining.comfy.addValidationSet(props.datasetId)
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex(list.length - 1)
      setStatus(`Added ${list[list.length - 1]?.label ?? 'set'}`)
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
        await window.loraTraining.comfy.removeValidationSet(props.datasetId, active.index)
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex((i) => Math.min(i, list.length - 1))
      setStatus(`Removed set · now ${list.length} set(s)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function openCloneDialog(): void {
    setCloneMode('add')
    setCloneSourceId(validatedSources[0]?.id ?? '')
    setCloneOpen(true)
  }

  async function confirmClone(): Promise<void> {
    if (!cloneSourceId || cloneBusy) return
    const source = validatedSources.find((d) => d.id === cloneSourceId)
    if (!source) {
      setError('Pick a validated dataset to clone from.')
      return
    }
    setCloneBusy(true)
    try {
      const list = unwrap(
        await window.loraTraining.comfy.cloneValidationSets({
          targetDatasetId: props.datasetId,
          sourceDatasetId: cloneSourceId,
          mode: cloneMode
        })
      ) as SetSummary[]
      setSets(normalizeSets(list))
      setActiveIndex(cloneMode === 'add' ? Math.max(0, list.length - 1) : 0)
      setCloneOpen(false)
      setStatus(
        cloneMode === 'overwrite'
          ? `Cloned ${list.length} set${list.length === 1 ? '' : 's'} from ${source.name}`
          : `Added sets from ${source.name} · now ${list.length} set(s)`
      )
      void loadCheckpoints()
      void useAppStore.getState().refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCloneBusy(false)
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
        await window.loraTraining.comfy.clearValidationSetImages(props.datasetId, active.index)
      )
      setStatus(`Cleared images for ${active.label}`)
      void loadCheckpoints()
      void useAppStore.getState().refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function start(): Promise<void> {
    if (!active) return
    try {
      // Persist current tab fields before run so all sets read fresh settings.
      await persist({
        prompt: active.prompt,
        seed: active.seed,
        loraWeight: active.loraWeight,
        styleIndex: active.styleIndex === 1 ? 1 : 0
      })
      const ready = await ensureComfyReachable({
        settings,
        ask,
        setStatus,
        setError
      })
      if (!ready) return
      unwrap(await window.loraTraining.comfy.startValidation(props.datasetId))
      setStatus(
        `Validation started · all ${sets.length} set${sets.length === 1 ? '' : 's'} (missing previews)`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="panel details-panel validation-details">
      {dialog}
      {revealMenuEl}
      <ConfirmDialog
        open={cloneOpen}
        title="Clone validation sets"
        confirmLabel={
          validatedSources.length === 0
            ? 'OK'
            : cloneMode === 'overwrite'
              ? 'Overwrite'
              : 'Add sets'
        }
        danger={validatedSources.length > 0 && cloneMode === 'overwrite'}
        compact
        dismissDisabled={cloneBusy}
        hideCancel={validatedSources.length === 0}
        onCancel={() => {
          if (!cloneBusy) setCloneOpen(false)
        }}
        onConfirm={() => {
          if (validatedSources.length === 0) {
            setCloneOpen(false)
            return
          }
          void confirmClone()
        }}
      >
        {validatedSources.length === 0 ? (
          <p className="hint">No other validated datasets available to clone from.</p>
        ) : (
          <div className="form-grid form-rows">
            <label>
              Source dataset
              <select
                value={cloneSourceId}
                disabled={cloneBusy}
                onChange={(e) => setCloneSourceId(e.target.value)}
              >
                {validatedSources.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.breadcrumb}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="choice-list">
              <legend className="sr-only">Clone mode</legend>
              <label className={`choice-option${cloneMode === 'add' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="clone-validation-mode"
                  checked={cloneMode === 'add'}
                  disabled={cloneBusy}
                  onChange={() => setCloneMode('add')}
                />
                <span className="choice-option-body">
                  <strong>Add to current</strong>
                  <span className="hint">Append cloned sets after the ones you already have.</span>
                </span>
              </label>
              <label className={`choice-option${cloneMode === 'overwrite' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="clone-validation-mode"
                  checked={cloneMode === 'overwrite'}
                  disabled={cloneBusy}
                  onChange={() => setCloneMode('overwrite')}
                />
                <span className="choice-option-body">
                  <strong>Overwrite</strong>
                  <span className="hint">
                    Replace all sets here. Existing set previews are cleared.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        )}
      </ConfirmDialog>
      <div className="details-meta validation-details-form">
        <div className="validation-set-tabs-row">
          <div className="validation-set-tabs" role="tablist" aria-label="Validation sets">
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
              className="validation-set-tab validation-set-add"
              onClick={() => void addSet()}
              title="Add set"
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="validation-set-tabs-actions">
            <button
              type="button"
              className="icon-btn validation-prompt-dice"
              disabled={promptDiceBusy || !active}
              title="Fill prompt from a randomly picked caption in this dataset"
              aria-label="Fill prompt from a random dataset caption"
              onClick={() => void fillPromptFromRandomCaption()}
            >
              <Dices size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="validation-set-clone"
              onClick={openCloneDialog}
              title="Clone validation sets from another validated dataset"
            >
              Clone…
            </button>
          </div>
        </div>

        {active ? (
          <div className="form-grid validation-set-fields">
            <div className="validation-prompt-field">
              <PromptField
                rows={2}
                value={active.prompt}
                onChange={(prompt) => patchActive({ prompt })}
                onBlur={() => void persist({ prompt: active.prompt })}
                placeholder="Positive prompt for this set"
              />
            </div>
            <div className="validation-fields-row">
              <label
                className="validation-field validation-field-model"
                title="Model for this set — checkpoint / UNET (Default = Settings → ComfyUI)"
              >
                <span className="validation-field-icon" aria-hidden="true">
                  <Box className="validation-field-svg" strokeWidth={2} />
                </span>
                <ComfyModelSelect
                  compact
                  includeDefault
                  value={active.validationModel || VALIDATION_MODEL_DEFAULT}
                  title="Model for this set — Default uses Settings → ComfyUI default validation model"
                  onChange={(next) => {
                    patchActive({ validationModel: next })
                    void persist({ validationModel: next })
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
                  value={active.seed}
                  aria-label="Seed"
                  onChange={(e) => patchActive({ seed: Number(e.target.value) })}
                  onBlur={() => void persist({ seed: active.seed })}
                />
              </label>
              <label
                className="validation-field validation-field-weight"
                title="LoRA weight"
              >
                <span className="validation-field-icon" aria-hidden="true">
                  <Dumbbell className="validation-field-svg" strokeWidth={2} />
                </span>
                <input
                  type="number"
                  className="validation-num"
                  step={0.05}
                  value={active.loraWeight}
                  aria-label="Weight"
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
        ) : (
          <div className="empty">No validation sets</div>
        )}
      </div>

      <ValidationPreviewToolbar
        panelKind="validation"
        datasetId={props.datasetId}
        activeSetIndex={activeIndex}
        activeSetLabel={active?.label ?? null}
        canRun={Boolean(active)}
        canRemove={Boolean(active) && sets.length > 1}
        localProgress={progress}
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
                alt={currentPreview.fileName}
              />
            </div>
            {setImages.length > 0 ? (
              <div
                ref={stripRef}
                className="validation-preview-strip"
                role="listbox"
                aria-label="Validation images in this set"
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
                      title={img.fileName}
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
            <p className="validation-live-preview-label hint" title={currentPreview.fileName}>
              {currentPreview.fileName}
              {setImages.length > 1 ? ` · ${imageIndex + 1}/${setImages.length}` : ''}
            </p>
          </>
        ) : (
          <div className="empty validation-live-preview-empty">
            {activeIsRunningSet ? 'Waiting for first preview…' : 'No preview yet for this set'}
          </div>
        )}
      </div>
    </div>
  )
}

