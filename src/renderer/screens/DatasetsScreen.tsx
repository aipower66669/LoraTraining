import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Droplet,
  FlaskConical,
  FolderOutput,
  ImageUpscale,
  Images,
  Pencil,
  ShieldCheck,
  SmilePlus,
  WandSparkles
} from 'lucide-react'
import type {
  CheckpointEntry,
  DatasetDetail,
  DatasetSummary,
  JobDetail,
  QueueSnapshot
} from '@shared/ipc/contract'
import { DEFAULT_CATEGORY_ID } from '@shared/schemas/category'
import { imagesFullyCaptioned, missingCaptionCountFromImages, sanitizeDatasetFolderName } from '@shared/schemas/dataset'
import { openJobForDataset } from '@shared/dataset-jobs'
import { isTypingTarget } from '@shared/keyboard'
import { JobBreadcrumb } from '../components/JobBreadcrumb'
import { DatasetExplorer } from '../components/DatasetExplorer'
import { DatasetOutputPanel } from '../components/DatasetOutputPanel'
import { MarkDatasetDoneFooter } from '../components/MarkDatasetDoneFooter'
import { OutputValidationDetails } from '../components/OutputValidationDetails'
import { ValidationWorkflowPane } from '../components/ValidationWorkflowPane'
import { ValidationMiddlePane } from '../components/ValidationMiddlePane'
import { ValidationDetailsPanel } from '../components/ValidationDetailsPanel'
import { WeightValidationMiddlePane } from '../components/WeightValidationMiddlePane'
import { WeightValidationDetailsPanel } from '../components/WeightValidationDetailsPanel'
import { StressTestMiddlePane } from '../components/StressTestMiddlePane'
import { StressTestDetailsPanel } from '../components/StressTestDetailsPanel'
import { UpscaleWorkflowPane } from '../components/UpscaleWorkflowPane'
import { UpscaleMiddlePane } from '../components/UpscaleMiddlePane'
import { UpscaleDetailsPanel } from '../components/UpscaleDetailsPanel'
import { DiversifyWorkflowPane } from '../components/DiversifyWorkflowPane'
import { DiversifyMiddlePane } from '../components/DiversifyMiddlePane'
import { DiversifyDetailsPanel } from '../components/DiversifyDetailsPanel'
import { writeLastDiversifyMode } from '../store/actions'
import { CategoryManager } from '../components/CategoryManager'
import { DatasetsSplitLayout } from '../components/DatasetsSplitLayout'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useConfirm } from '../components/useConfirm'
import { AddDatasetDialog } from '../components/AddDatasetDialog'
import { CreateDatasetFromImageDialog } from '../components/CreateDatasetFromImageDialog'
import { RenameDatasetDialog } from '../components/RenameDatasetDialog'
import { DuplicateDatasetDialog } from '../components/DuplicateDatasetDialog'
import { JoyCaptionDialog, runJoyCaptionMissingWithPrepend, type JoyCaptionDialogTarget } from '../components/JoyCaptionDialog'
import { SetCaptionDialog, type SetCaptionDialogTarget } from '../components/SetCaptionDialog'
import {
  IdentityTagDialog,
  type IdentityTagDialogTarget
} from '../components/IdentityTagDialog'
import { BulkToolsDialog } from '../components/BulkToolsDialog'
import type { BulkOpId } from '../components/bulkActions'
import {
  countCaptionsMissingTrigger,
  fixMissingTriggers
} from '../components/createJobTriggerGate'
import { DatasetDetailsForm, type DatasetMetaPatch } from '../components/DatasetDetailsForm'
import { DatasetImagesPane } from '../components/DatasetImagesPane'
import { ImageScraperPane } from '../components/ImageScraperPane'
import { unwrap, useAppStore, type DatasetsMiddleTab } from '../store'
import { DEFAULT_COMFY_CONNECTION } from '@shared/comfy'
import { toolConfigFlags } from '@shared/tool-config'
import { isDatasetMiddleTabAvailable } from '../util/dataset-middle-tabs'

const MIDDLE_TAB_DEFS: Array<{
  id: DatasetsMiddleTab
  label: string
  title: string
  Icon: LucideIcon
  group: 'browse' | 'preview' | 'tool'
}> = [
  {
    id: 'images',
    label: 'Images',
    title: 'Browse dataset images, edit captions, and run bulk tools',
    Icon: Images,
    group: 'browse'
  },
  {
    id: 'output',
    label: 'Output',
    title: 'Training checkpoints, rated samples, and output files',
    Icon: FolderOutput,
    group: 'browse'
  },
  {
    id: 'validate',
    label: 'Validation Steps',
    title: 'Validation Steps — one model per set, generate every keep-in-Comfy LoRA checkpoint',
    Icon: ShieldCheck,
    group: 'preview'
  },
  {
    id: 'weight',
    label: 'Validation Weight',
    title: 'Validation Weight — one checkpoint + model, sweep LoRA strength min…max by step',
    Icon: Droplet,
    group: 'preview'
  },
  {
    id: 'stress',
    label: 'Model Stress-Testing',
    title: 'Model Stress-Testing — one LoRA per set, generate against many models',
    Icon: FlaskConical,
    group: 'preview'
  },
  {
    id: 'upscale',
    label: 'Upscale',
    title: 'Upscale or re-detail images with the Upscale ComfyUI workflow',
    Icon: ImageUpscale,
    group: 'tool'
  },
  {
    id: 'context',
    label: 'Context',
    title: 'Diversify into new scenes and contexts (ComfyUI)',
    Icon: WandSparkles,
    group: 'tool'
  },
  {
    id: 'expression',
    label: 'Expression',
    title: 'Diversify facial expressions with randomized seeds',
    Icon: SmilePlus,
    group: 'tool'
  }
]

const MIDDLE_BROWSE_TABS = MIDDLE_TAB_DEFS.filter((t) => t.group === 'browse')
const MIDDLE_PREVIEW_TABS = MIDDLE_TAB_DEFS.filter((t) => t.group === 'preview')
const MIDDLE_TOOL_TABS = MIDDLE_TAB_DEFS.filter((t) => t.group === 'tool')

function MiddleTabButtons(props: {
  tabs: typeof MIDDLE_TAB_DEFS
  middleTab: DatasetsMiddleTab
  onSelect: (id: DatasetsMiddleTab) => void
}): React.JSX.Element {
  return (
    <>
      {props.tabs.map(({ id, label, title, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={props.middleTab === id}
          aria-label={label}
          title={title}
          className={`icon-btn${props.middleTab === id ? ' primary' : ''}`}
          onClick={() => props.onSelect(id)}
        >
          <Icon size={17} strokeWidth={2} aria-hidden="true" />
        </button>
      ))}
    </>
  )
}

export function DatasetsScreen(): React.JSX.Element {
  const categories = useAppStore((s) => s.categories)
  const datasets = useAppStore((s) => s.datasets)
  const jobs = useAppStore((s) => s.jobs)
  const libraryLoading = useAppStore((s) => s.libraryLoading)
  const libraryLoadProgress = useAppStore((s) => s.libraryLoadProgress)
  const detail = useAppStore((s) => s.datasetDetail)
  const selectedId = useAppStore((s) => s.selectedDatasetId)
  const selectedImage = useAppStore((s) => s.selectedImage)
  const selectedImages = useAppStore((s) => s.selectedImages)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const loadJob = useAppStore((s) => s.loadJob)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const setError = useAppStore((s) => s.setError)
  const setStatus = useAppStore((s) => s.setStatus)
  const setScreen = useAppStore((s) => s.setScreen)
  const setSelectedImage = (fileName: string): void => {
    useAppStore.setState({ selectedImage: fileName, selectedImages: [fileName] })
  }
  const { ask, dialog } = useConfirm()

  const [catOpen, setCatOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [createFromImageFile, setCreateFromImageFile] = useState<string | null>(null)

  const middleTab = useAppStore((s) => s.datasetsMiddleTab)
  const setMiddleTab = useAppStore((s) => s.setDatasetsMiddleTab)
  const imageScraperOpen = useAppStore((s) => s.imageScraperOpen)
  const setImageScraperOpen = useAppStore((s) => s.setImageScraperOpen)
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<CheckpointEntry | null>(null)
  const [outputsRefreshKey, setOutputsRefreshKey] = useState(0)
  const [ratingPatch, setRatingPatch] = useState<{
    stem: string
    averageRating: number | null
    ratingCount: number
  } | null>(null)
  const [captionReloadKey, setCaptionReloadKey] = useState(0)
  const captionReloadNonce = useAppStore((s) => s.captionReloadNonce)
  const captionProgress = useAppStore((s) => s.captionProgress)
  const settings = useAppStore((s) => s.settings)
  const queue = useAppStore((s) => s.queue)
  const toolFlags = useMemo(() => toolConfigFlags(settings), [settings])

  useEffect(() => {
    if (!isDatasetMiddleTabAvailable(middleTab, toolFlags)) {
      setMiddleTab('images')
    }
  }, [middleTab, setMiddleTab, toolFlags])

  const visiblePreviewTabs = useMemo(
    () => (toolFlags.comfy ? MIDDLE_PREVIEW_TABS : []),
    [toolFlags.comfy]
  )
  const visibleToolTabs = useMemo(
    () => (toolFlags.comfy ? MIDDLE_TOOL_TABS : []),
    [toolFlags.comfy]
  )

  useEffect(() => {
    setCaptionReloadKey((k) => k + 1)
  }, [captionReloadNonce])

  const processingFileName =
    captionProgress?.status === 'running' && captionProgress.datasetId === selectedId
      ? captionProgress.currentFileName
      : null

  const [bulkOpen, setBulkOpen] = useState(false)
  const [joyCaptionTarget, setJoyCaptionTarget] = useState<JoyCaptionDialogTarget | null>(null)
  const [setCaptionTarget, setSetCaptionTarget] = useState<SetCaptionDialogTarget | null>(null)
  const [identityTagTarget, setIdentityTagTarget] = useState<IdentityTagDialogTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<DatasetSummary | null>(null)
  const [duplicateTarget, setDuplicateTarget] = useState<DatasetSummary | null>(null)
  const [libraryRefreshing, setLibraryRefreshing] = useState(false)
  const [bulkOp, setBulkOp] = useState<BulkOpId>('prefix')
  /** Create Job: captions missing the dataset trigger. */
  const [triggerGap, setTriggerGap] = useState<{
    datasetId: string
    trigger: string
    missing: number
    enqueueAndStay: boolean
  } | null>(null)
  const [triggerGapBusy, setTriggerGapBusy] = useState(false)
  /** Steps / Save every that Create Job (and Shift+enqueue) will use. */
  const [createDefaults, setCreateDefaults] = useState<{
    steps: number
    saveEvery: number
  } | null>(null)
  /** Sub-view within Validation Steps / Weight / Stress: run or edit shared workflow. */
  const [validateView, setValidateView] = useState<'run' | 'workflow'>('run')
  const [weightView, setWeightView] = useState<'run' | 'workflow'>('run')
  const [stressView, setStressView] = useState<'run' | 'workflow'>('run')
  const validationFocusRequest = useAppStore((s) => s.validationFocusRequest)
  const weightFocusRequest = useAppStore((s) => s.weightFocusRequest)
  /** Sub-view within Upscale: run/compare, or edit the tool's own ComfyUI workflow. */
  const [upscaleView, setUpscaleView] = useState<'run' | 'workflow'>('run')
  const upscaleOpenRequest = useAppStore((s) => s.upscaleOpenRequest)
  /** Sub-view within Context / Expression Diversify tabs. */
  const [diversifyView, setDiversifyView] = useState<'run' | 'workflow'>('run')

  useEffect(() => {
    if (!toolFlags.joyCaption) setJoyCaptionTarget(null)
  }, [toolFlags.joyCaption])

  useEffect(() => {
    if (!toolFlags.aiToolkit) setTriggerGap(null)
  }, [toolFlags.aiToolkit])
  const diversifyOpenRequest = useAppStore((s) => s.diversifyOpenRequest)

  useEffect(() => {
    setSelectedCheckpoint(null)
  }, [selectedId])

  // "Jump to active validation" should always land on the Run view, not a stale Edit Workflow tab.
  useEffect(() => {
    if (validationFocusRequest) setValidateView('run')
  }, [validationFocusRequest])

  useEffect(() => {
    if (weightFocusRequest) setWeightView('run')
  }, [weightFocusRequest])

  // "Upscale" should always land on the Run view, not a stale Edit Workflow tab.
  useEffect(() => {
    if (upscaleOpenRequest) setUpscaleView('run')
  }, [upscaleOpenRequest])

  // Diversify open request should land on Run, not a stale Edit Workflow tab.
  useEffect(() => {
    if (diversifyOpenRequest) setDiversifyView('run')
  }, [diversifyOpenRequest])

  const categoryOptions = useMemo(
    () =>
      categories.length > 0
        ? categories
        : [
            {
              id: DEFAULT_CATEGORY_ID,
              name: 'General',
              sortOrder: 0,
              folderPath: '',
              createdAt: '',
              updatedAt: ''
            }
          ],
    [categories]
  )

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === detail?.categoryId) ?? null,
    [categories, detail?.categoryId]
  )
  const categoryIsFolderBacked = Boolean(selectedCategory?.folderPath?.trim())
  // Keep the 3-pane shell stable: only swap content when detail matches selection.
  const detailReady = Boolean(detail && selectedId && detail.id === selectedId)
  /** Keep previous detail painted while the next dataset loads — avoids tab/content remount flash. */
  const switchingDataset = Boolean(selectedId && detail && detail.id !== selectedId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'e' && e.key !== 'E') return
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (document.querySelector('.modal-backdrop')) return
      const state = useAppStore.getState()
      if (state.imageEditor || state.imageScraperOpen) return
      if (!state.selectedImage || !state.datasetDetail) return
      if (state.selectedDatasetId && state.datasetDetail.id !== state.selectedDatasetId) return
      e.preventDefault()
      state.openImageEditor(state.datasetDetail.id, state.selectedImage)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const showDatasetPanes = Boolean(selectedId && detail)
  const existingOpenJob = detail ? openJobForDataset(jobs, detail.id) : null
  const fullyCaptioned = detail ? imagesFullyCaptioned(detail.images) : false
  const missingCaptions = detail ? missingCaptionCountFromImages(detail.images) : 0
  const createJobBlockedReason =
    detail && !detail.ready
      ? 'Mark Ready when you have checked captions and images — then you can create a job'
      : detail && !fullyCaptioned
        ? detail.images.length === 0
          ? 'Add images before creating a job'
          : `${missingCaptions} image${missingCaptions === 1 ? '' : 's'} missing captions — caption every image first`
        : undefined
  const canCreateJob = Boolean(
    toolFlags.aiToolkit && detail && !existingOpenJob && detail.ready && fullyCaptioned
  )
  const jobActionEnabled = Boolean(existingOpenJob) || canCreateJob
  const jobActionLabel = existingOpenJob
    ? existingOpenJob.status === 'draft'
      ? 'Edit Job'
      : 'Open Job'
    : 'Create Job'
  const jobActionTitle = existingOpenJob
    ? existingOpenJob.status === 'draft'
      ? 'Edit the draft job for this dataset'
      : `Open the ${existingOpenJob.status} job for this dataset`
    : createJobBlockedReason
      ? createJobBlockedReason
      : canCreateJob && createDefaults
        ? `Create Job with settings Steps: ${createDefaults.steps} and Save every ${createDefaults.saveEvery} steps`
        : canCreateJob
          ? 'Create Job'
          : undefined

  useEffect(() => {
    if (!canCreateJob) {
      setCreateDefaults(null)
      return
    }
    let cancelled = false
    void window.loraTraining.jobs
      .getCreateDefaults()
      .then((r) => {
        if (cancelled) return
        try {
          setCreateDefaults(unwrap(r) as { steps: number; saveEvery: number })
        } catch {
          setCreateDefaults(null)
        }
      })
      .catch(() => {
        if (!cancelled) setCreateDefaults(null)
      })
    return () => {
      cancelled = true
    }
  }, [canCreateJob, queue?.jobIds.join(','), settings?.defaultTrainingConfig])

  const selectedCategoryName = useMemo(() => {
    const catId =
      (detailReady && detail?.categoryId) ||
      datasets.find((d) => d.id === selectedId)?.categoryId ||
      detail?.categoryId
    if (!catId) return null
    return categories.find((c) => c.id === catId)?.name ?? null
  }, [categories, datasets, detail, detailReady, selectedId])

  const selectedDatasetName = useMemo(() => {
    if (detailReady && detail) return detail.name
    return datasets.find((d) => d.id === selectedId)?.name ?? detail?.name ?? null
  }, [datasets, detail, detailReady, selectedId])

  async function removeDataset(target?: DatasetSummary): Promise<void> {
    const id = target?.id ?? selectedId
    const name = target?.name ?? detail?.name
    if (!id || !name) return
    const ok = await ask({
      title: 'Remove dataset?',
      message: `Remove “${name}” from the library? Image files on disk are not deleted.`,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    unwrap(await window.loraTraining.datasets.remove(id))
    if (useAppStore.getState().selectedDatasetId === id) {
      useAppStore.setState({
        selectedDatasetId: null,
        datasetDetail: null,
        selectedImage: null,
        selectedImages: []
      })
    }
    await refreshAll()
  }

  async function deleteDatasetForever(target: DatasetSummary): Promise<void> {
    const ok = await ask({
      title: 'Delete dataset?',
      message: `Permanently delete “${target.name}” and its folder on disk?\n\nThis removes all images, captions, and training output in:\n${target.folderPath}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true
    })
    if (!ok) return
    try {
      const result = unwrap(
        await window.loraTraining.datasets.deleteForever(target.id)
      ) as { deleted: true; folderDeleted: boolean }
      if (useAppStore.getState().selectedDatasetId === target.id) {
        useAppStore.setState({
          selectedDatasetId: null,
          datasetDetail: null,
          selectedImage: null,
          selectedImages: []
        })
      }
      await refreshAll()
      setStatus(
        result.folderDeleted
          ? `Deleted dataset “${target.name}”`
          : `Removed “${target.name}” from the library (folder was already gone)`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Shared by the rename dialog and the inline Name field: confirm a folder rename on disk. */
  async function confirmFolderRename(nextFolder: string): Promise<boolean> {
    return ask({
      title: 'Rename dataset folder?',
      message: `This renames the folder on disk to “${nextFolder}”. Linked training jobs are updated. Continue?`,
      confirmLabel: 'Rename',
      danger: false
    })
  }

  async function saveMeta(patch: DatasetMetaPatch): Promise<void> {
    if (!selectedId || !detail) return
    if (patch.name !== undefined) {
      const nextName = patch.name.trim()
      if (!nextName || nextName === detail.name) {
        if (patch.name !== detail.name) {
          useAppStore.setState({ datasetDetail: { ...detail, name: detail.name } })
        }
        return
      }
      const nextFolder = sanitizeDatasetFolderName(nextName)
      const currentBase = detail.folderPath.split(/[/\\]/).filter(Boolean).pop() ?? ''
      if (nextFolder !== currentBase) {
        const ok = await confirmFolderRename(nextFolder)
        if (!ok) {
          useAppStore.setState({ datasetDetail: { ...detail, name: detail.name } })
          return
        }
      }
    }
    try {
      const updated = unwrap(
        await window.loraTraining.datasets.update({ id: selectedId, ...patch })
      ) as DatasetDetail
      // Merge returned detail but keep any newer in-progress store edits on other fields.
      const current = useAppStore.getState().datasetDetail
      useAppStore.setState({
        datasetDetail:
          current && current.id === selectedId
            ? {
                ...updated,
                // Prefer live store values for fields not in this patch (user may still be typing).
                name: patch.name !== undefined ? updated.name : current.name,
                trigger: patch.trigger !== undefined ? updated.trigger : current.trigger,
                captionGuidance:
                  patch.captionGuidance !== undefined
                    ? updated.captionGuidance
                    : current.captionGuidance,
                categoryId:
                  patch.categoryId !== undefined ? updated.categoryId : current.categoryId,
                ready: patch.ready !== undefined ? updated.ready : current.ready
              }
            : updated,
        selectedDatasetId: selectedId
      })
      const touchesList =
        patch.name !== undefined ||
        patch.categoryId !== undefined ||
        patch.ready !== undefined
      if (touchesList) {
        await refreshAll()
      } else {
        // Keep the sidebar row in sync for trigger/notes-style edits without a full list.
        const datasets = useAppStore.getState().datasets
        useAppStore.setState({
          datasets: datasets.map((d) =>
            d.id === selectedId
              ? {
                  ...d,
                  name: updated.name,
                  trigger: updated.trigger,
                  categoryId: updated.categoryId,
                  ready: updated.ready,
                  validated: updated.validated,
                  done: updated.done,
                  updatedAt: updated.updatedAt,
                  status: updated.status,
                  coverFileName: updated.coverFileName
                }
              : d
          )
        })
      }
      if (patch.name !== undefined) setStatus('Dataset renamed')
    } catch (err) {
      useAppStore.setState({ datasetDetail: { ...detail, name: detail.name } })
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function openBulkTool(op: BulkOpId): void {
    setBulkOp(op)
    setBulkOpen(true)
  }

  async function finishCreateJob(
    datasetId: string,
    name: string,
    opts?: { enqueueAndStay?: boolean }
  ): Promise<void> {
    if (!toolConfigFlags(useAppStore.getState().settings).aiToolkit) return
    const created = unwrap(
      await window.loraTraining.jobs.create({
        name,
        datasetId
      })
    ) as JobDetail

    if (opts?.enqueueAndStay) {
      const queueSnap = unwrap(await window.loraTraining.queue.enqueue(created.id)) as QueueSnapshot
      const queued: JobDetail = { ...created, status: 'queued' }
      useAppStore.setState((s) => ({
        jobs: [queued, ...s.jobs.filter((j) => j.id !== created.id)],
        queue: queueSnap,
        error: null
      }))
      setStatus(`Created and enqueued “${name}”`)
      void useAppStore.getState().refreshJobs()
      return
    }

    useAppStore.setState((s) => ({
      jobs: [created, ...s.jobs.filter((j) => j.id !== created.id)],
      selectedJobId: created.id,
      jobDetail: created,
      screen: 'jobs',
      error: null
    }))
    setStatus(`Created job “${name}”`)
    void useAppStore.getState().refreshJobs()
  }

  async function createJobForDataset(enqueueAndStay = false): Promise<void> {
    if (!toolConfigFlags(useAppStore.getState().settings).aiToolkit) return
    if (!detail) return
    const existing = openJobForDataset(jobs, detail.id)
    if (existing) return
    if (!detail.ready) {
      setError('Mark the dataset Ready before creating a job.')
      return
    }
    if (!imagesFullyCaptioned(detail.images)) {
      const missing = missingCaptionCountFromImages(detail.images)
      setError(
        missing > 0
          ? `Cannot create a job: ${missing} image${missing === 1 ? '' : 's'} still missing captions`
          : 'Cannot create a job: dataset has no images'
      )
      return
    }
    try {
      const trigger = detail.trigger.trim()
      if (trigger) {
        setStatus('Checking captions for trigger…')
        const missing = await countCaptionsMissingTrigger(detail.id, trigger)
        if (missing > 0) {
          setTriggerGap({ datasetId: detail.id, trigger, missing, enqueueAndStay })
          setStatus('')
          return
        }
      }
      await finishCreateJob(detail.id, detail.name, { enqueueAndStay })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createJobAfterTriggerChoice(choice: 'fix' | 'create'): Promise<void> {
    if (!toolConfigFlags(useAppStore.getState().settings).aiToolkit) return
    if (!triggerGap) return
    const { datasetId, trigger, enqueueAndStay } = triggerGap
    const name =
      detail?.id === datasetId
        ? detail.name
        : (datasets.find((d) => d.id === datasetId)?.name ?? 'job')
    setTriggerGapBusy(true)
    try {
      if (choice === 'fix') {
        setStatus('Prepending missing triggers…')
        const result = await fixMissingTriggers(datasetId, trigger)
        setStatus(`Prepended trigger to ${result.changed} caption${result.changed === 1 ? '' : 's'}`)
        if (detail?.id === datasetId) {
          await loadDataset(datasetId, { preserveCaptionFlags: true })
        }
      }
      setTriggerGap(null)
      await finishCreateJob(datasetId, name, { enqueueAndStay })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTriggerGapBusy(false)
    }
  }

  async function openExistingJobForDataset(): Promise<void> {
    if (!toolConfigFlags(useAppStore.getState().settings).aiToolkit) return
    if (!detail) return
    const existing = openJobForDataset(jobs, detail.id)
    if (!existing) return
    await loadJob(existing.id)
    setScreen('jobs')
    setStatus(
      existing.status === 'draft'
        ? `Editing job for “${detail.name}”`
        : `Opened existing job for “${detail.name}”`
    )
  }

  return (
    <div className="screen datasets-screen">
      {dialog}
      <ConfirmDialog
        open={Boolean(triggerGap)}
        title="Missing trigger in captions"
        confirmLabel="Create"
        leftActionLabel="Fix missing"
        leftActionTitle={`Prepend “${triggerGap?.trigger ?? 'trigger'}, ” only to captions that lack the dataset trigger, then create the job (same as Ensure Trigger).`}
        dismissDisabled={triggerGapBusy}
        autoFocusConfirm
        enterConfirms
        onLeftAction={() => {
          if (triggerGapBusy) return
          void createJobAfterTriggerChoice('fix')
        }}
        onConfirm={() => {
          if (triggerGapBusy) return
          void createJobAfterTriggerChoice('create')
        }}
        onCancel={() => {
          if (triggerGapBusy) return
          setTriggerGap(null)
        }}
      >
        <p>
          {triggerGap
            ? `${triggerGap.missing} caption${triggerGap.missing === 1 ? '' : 's'} do not contain the trigger “${triggerGap.trigger}”. All captions should include it, but you can still create the job without fixing.`
            : null}
        </p>
      </ConfirmDialog>
      <div className="toolbar">
        <button type="button" onClick={() => setCatOpen(true)}>
          Categories…
        </button>
        <button type="button" className="primary" onClick={() => setAddOpen(true)}>
          Add dataset
        </button>
        <button
          type="button"
          className="danger"
          disabled={!selectedId || categoryIsFolderBacked}
          onClick={() => void removeDataset()}
          title={
            categoryIsFolderBacked
              ? 'Membership is managed by the category folder — remove or move the subfolder on disk'
              : 'Remove from library (files on disk are kept)'
          }
        >
          Remove
        </button>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          Group by category · {datasets.length} dataset{datasets.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="datasets-layout">
        <DatasetsSplitLayout
          library={
            <div className="panel explorer-panel">
              <DatasetExplorer
                categories={categories}
                datasets={datasets}
                jobs={jobs}
                showQueueStatus={toolFlags.aiToolkit}
                selectedId={selectedId}
                refreshing={libraryRefreshing || libraryLoading}
                libraryLoading={libraryLoading}
                libraryLoadProgress={libraryLoadProgress}
                onSelect={(id) => void loadDataset(id)}
                onRename={setRenameTarget}
                onDuplicate={setDuplicateTarget}
                onRemove={(ds) => void removeDataset(ds)}
                onDeleteForever={(ds) => void deleteDatasetForever(ds)}
                onReveal={(ds) => void window.loraTraining.datasets.openFolder(ds.id)}
                onCaptionQueue={
                  toolFlags.joyCaption
                    ? (ds) => {
                        void (async () => {
                          try {
                            // Prefer live detail if this dataset is already open.
                            const open = useAppStore.getState().datasetDetail
                            if (open && open.id === ds.id) {
                              setJoyCaptionTarget({
                                id: open.id,
                                name: open.name,
                                trigger: open.trigger,
                                captionGuidance: open.captionGuidance,
                                stats: open.stats
                              })
                              return
                            }
                            const loaded = unwrap(
                              await window.loraTraining.datasets.get(ds.id)
                            ) as DatasetDetail
                            setJoyCaptionTarget({
                              id: loaded.id,
                              name: loaded.name,
                              trigger: loaded.trigger,
                              captionGuidance: loaded.captionGuidance,
                              stats: loaded.stats
                            })
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err))
                          }
                        })()
                      }
                    : undefined
                }
                onRefresh={async () => {
                  if (libraryRefreshing) return
                  setLibraryRefreshing(true)
                  setStatus('Refreshing library…')
                  try {
                    await refreshAll()
                    const id = useAppStore.getState().selectedDatasetId
                    if (id) await loadDataset(id)
                    setStatus('Library refreshed')
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setLibraryRefreshing(false)
                  }
                }}
              />
            </div>
          }
          middle={
            showDatasetPanes && detail ? (
              <div
                className={`panel middle-panel${switchingDataset ? ' is-switching' : ''}`}
                aria-busy={switchingDataset || undefined}
              >
                <div className="toolbar middle-tabs">
                  <div className="middle-tabs-nav" role="tablist" aria-label="Dataset tools">
                    <MiddleTabButtons
                      tabs={MIDDLE_BROWSE_TABS}
                      middleTab={middleTab}
                      onSelect={(id) => {
                        if (id === 'output') {
                          setOutputsRefreshKey((k) => k + 1)
                        }
                        setMiddleTab(id)
                      }}
                    />
                    {visiblePreviewTabs.length > 0 ? (
                      <>
                        <span className="middle-tabs-sep" aria-hidden="true">
                          {'   |   '}
                        </span>
                        <MiddleTabButtons
                          tabs={visiblePreviewTabs}
                          middleTab={middleTab}
                          onSelect={setMiddleTab}
                        />
                      </>
                    ) : null}
                    {visibleToolTabs.length > 0 ? (
                      <>
                        <span className="middle-tabs-sep" aria-hidden="true">
                          {'   |   '}
                        </span>
                        <MiddleTabButtons
                          tabs={visibleToolTabs}
                          middleTab={middleTab}
                          onSelect={(id) => {
                            if (id === 'context' || id === 'expression') {
                              writeLastDiversifyMode(id)
                            }
                            setMiddleTab(id)
                          }}
                        />
                      </>
                    ) : null}
                    <span className="middle-tabs-sep" aria-hidden="true">
                      {'   |   '}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      title={
                        selectedImage
                          ? `Edit image (E) — ${selectedImage}`
                          : 'Select an image first to edit'
                      }
                      aria-label="Edit image"
                      disabled={!selectedImage || switchingDataset}
                      onClick={() => {
                        if (!selectedImage || !detail) return
                        useAppStore.getState().openImageEditor(detail.id, selectedImage)
                      }}
                    >
                      <Pencil size={17} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="middle-tabs-title">
                    <JobBreadcrumb
                      className="middle-tabs-breadcrumb"
                      categoryName={selectedCategoryName}
                      datasetName={selectedDatasetName ?? detail.name}
                    />
                  </div>
                  {toolFlags.aiToolkit ? (
                    <button
                      type="button"
                      className={jobActionEnabled ? 'primary' : ''}
                      disabled={!jobActionEnabled || switchingDataset}
                      title={jobActionTitle}
                      onClick={(e) => {
                        if (existingOpenJob) void openExistingJobForDataset()
                        else void createJobForDataset(e.shiftKey)
                      }}
                    >
                      {jobActionLabel}
                    </button>
                  ) : null}
                </div>

                {middleTab === 'images' ? (
                  <DatasetImagesPane
                    detail={detail}
                    selectedImage={selectedImage}
                    processingFileName={processingFileName}
                    onSelectImage={setSelectedImage}
                    onRescan={() => {
                      void (async () => {
                        unwrap(await window.loraTraining.datasets.rescan(detail.id))
                        await loadDataset(detail.id)
                        await refreshAll()
                        setStatus('Rescan complete')
                      })()
                    }}
                    onOpenFolder={() => void window.loraTraining.datasets.openFolder(detail.id)}
                    onOpenBulkTool={openBulkTool}
                    showJoyCaption={toolFlags.joyCaption}
                    onOpenJoyCaption={
                      toolFlags.joyCaption
                        ? (opts) => {
                            if (!detail) return
                            if (opts?.shiftKey) {
                              void (async () => {
                                try {
                                  await runJoyCaptionMissingWithPrepend({
                                    datasetId: detail.id,
                                    name: detail.name,
                                    captionGuidance: detail.captionGuidance ?? '',
                                    onStatus: setStatus
                                  })
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : String(err))
                                }
                              })()
                              return
                            }
                            setJoyCaptionTarget({
                              id: detail.id,
                              name: detail.name,
                              trigger: detail.trigger,
                              captionGuidance: detail.captionGuidance,
                              stats: detail.stats
                            })
                          }
                        : undefined
                    }
                    onOpenSetCaption={() => {
                      if (!detail) return
                      setSetCaptionTarget({
                        id: detail.id,
                        name: detail.name,
                        trigger: detail.trigger,
                        captionGuidance: detail.captionGuidance,
                        stats: detail.stats
                      })
                    }}
                    onOpenIdentityTag={() => {
                      if (!detail) return
                      setIdentityTagTarget({
                        id: detail.id,
                        name: detail.name,
                        stats: detail.stats
                      })
                    }}
                    onCreateDatasetFromImage={(fileName) => setCreateFromImageFile(fileName)}
                  />
                ) : middleTab === 'output' ? (
                  <>
                    <div className="toolbar">
                      <button
                        type="button"
                        onClick={() => {
                          setOutputsRefreshKey((k) => k + 1)
                          void refreshAll()
                          setStatus('Output refreshed')
                        }}
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.loraTraining.datasets.openFolder(detail.id)}
                      >
                        Open folder
                      </button>
                      <button
                        type="button"
                        className="danger"
                        title="Delete output/ (checkpoints, caches, validation images) and staged ComfyUI LoRAs"
                        onClick={() => {
                          void (async () => {
                            const ok = await ask({
                              title: 'Clear output / reset training?',
                              message: `Delete the entire output folder for “${detail.name}” (checkpoints, training caches, validation images, ratings) and remove this dataset’s staged LoRAs from ComfyUI?\n\nTraining images, captions, and validation set settings are kept.`,
                              confirmLabel: 'Clear output',
                              danger: true
                            })
                            if (!ok) return
                            try {
                              const result = unwrap(
                                await window.loraTraining.datasets.clearOutput(detail.id)
                              ) as {
                                cleared: true
                                checkpointsRemoved: number
                                deletedFromComfy: number
                              }
                              setSelectedCheckpoint(null)
                              setOutputsRefreshKey((k) => k + 1)
                              setRatingPatch(null)
                              await loadDataset(detail.id)
                              await refreshAll()
                              setStatus(
                                `Cleared output · ${result.checkpointsRemoved} checkpoint${
                                  result.checkpointsRemoved === 1 ? '' : 's'
                                }, ${result.deletedFromComfy} removed from ComfyUI`
                              )
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err))
                            }
                          })()
                        }}
                      >
                        Clear output
                      </button>
                    </div>
                    <div className="middle-panel-body output-middle-pane">
                      <div className="output-middle-main">
                        <DatasetOutputPanel
                          datasetId={detail.id}
                          selectedPath={selectedCheckpoint?.relativePath ?? null}
                          refreshKey={outputsRefreshKey}
                          showPending={toolFlags.aiToolkit}
                          ratingPatch={ratingPatch}
                          onSelect={setSelectedCheckpoint}
                        />
                      </div>
                      <MarkDatasetDoneFooter datasetId={detail.id} />
                    </div>
                  </>
                ) : middleTab === 'validate' ? (
                  <>
                    <div className="toolbar validate-subtabs">
                      <button
                        type="button"
                        className={validateView === 'run' ? 'primary' : ''}
                        onClick={() => setValidateView('run')}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        className={validateView === 'workflow' ? 'primary' : ''}
                        onClick={() => setValidateView('workflow')}
                      >
                        Edit Workflow
                      </button>
                    </div>
                    {validateView === 'workflow' ? (
                      <div className="middle-panel-body validation-middle">
                        <ValidationWorkflowPane
                          connection={settings?.comfy ?? DEFAULT_COMFY_CONNECTION}
                        />
                      </div>
                    ) : (
                      <ValidationMiddlePane datasetId={detail.id} />
                    )}
                  </>
                ) : middleTab === 'weight' ? (
                  <>
                    <div className="toolbar validate-subtabs">
                      <button
                        type="button"
                        className={weightView === 'run' ? 'primary' : ''}
                        onClick={() => setWeightView('run')}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        className={weightView === 'workflow' ? 'primary' : ''}
                        onClick={() => setWeightView('workflow')}
                        title="Same Validation ComfyUI workflow — shared with Validation Steps"
                      >
                        Edit Workflow
                      </button>
                    </div>
                    {weightView === 'workflow' ? (
                      <div className="middle-panel-body validation-middle">
                        <ValidationWorkflowPane
                          connection={settings?.comfy ?? DEFAULT_COMFY_CONNECTION}
                        />
                      </div>
                    ) : (
                      <WeightValidationMiddlePane datasetId={detail.id} />
                    )}
                  </>
                ) : middleTab === 'stress' ? (
                  <>
                    <div className="toolbar validate-subtabs">
                      <button
                        type="button"
                        className={stressView === 'run' ? 'primary' : ''}
                        onClick={() => setStressView('run')}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        className={stressView === 'workflow' ? 'primary' : ''}
                        onClick={() => setStressView('workflow')}
                        title="Same Validation ComfyUI workflow — shared with Validation Steps"
                      >
                        Edit Workflow
                      </button>
                    </div>
                    {stressView === 'workflow' ? (
                      <div className="middle-panel-body validation-middle">
                        <ValidationWorkflowPane
                          connection={settings?.comfy ?? DEFAULT_COMFY_CONNECTION}
                        />
                      </div>
                    ) : (
                      <StressTestMiddlePane datasetId={detail.id} />
                    )}
                  </>
                ) : middleTab === 'upscale' ? (
                  <>
                    <div className="toolbar validate-subtabs">
                      <button
                        type="button"
                        className={upscaleView === 'run' ? 'primary' : ''}
                        onClick={() => setUpscaleView('run')}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        className={upscaleView === 'workflow' ? 'primary' : ''}
                        onClick={() => setUpscaleView('workflow')}
                      >
                        Edit Workflow
                      </button>
                    </div>
                    {upscaleView === 'workflow' ? (
                      <div className="middle-panel-body validation-middle">
                        <UpscaleWorkflowPane
                          connection={settings?.comfy ?? DEFAULT_COMFY_CONNECTION}
                        />
                      </div>
                    ) : (
                      <UpscaleMiddlePane datasetId={detail.id} />
                    )}
                  </>
                ) : middleTab === 'context' || middleTab === 'expression' ? (
                  <>
                    <div className="toolbar validate-subtabs">
                      <button
                        type="button"
                        className={diversifyView === 'run' ? 'primary' : ''}
                        onClick={() => setDiversifyView('run')}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        className={diversifyView === 'workflow' ? 'primary' : ''}
                        onClick={() => setDiversifyView('workflow')}
                      >
                        Edit Workflow
                      </button>
                    </div>
                    {diversifyView === 'workflow' ? (
                      <div className="middle-panel-body validation-middle">
                        <DiversifyWorkflowPane
                          mode={middleTab}
                          connection={settings?.comfy ?? DEFAULT_COMFY_CONNECTION}
                        />
                      </div>
                    ) : (
                      <DiversifyMiddlePane datasetId={detail.id} mode={middleTab} />
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="panel middle-panel">
                <div className="middle-panel-body">
                  <p className="hint" style={{ margin: '1rem' }}>
                    {selectedId ? 'Loading dataset…' : 'Select a dataset to browse images.'}
                  </p>
                </div>
              </div>
            )
          }
          details={
            imageScraperOpen ? (
              <ImageScraperPane
                datasetId={selectedId}
                datasetName={selectedDatasetName}
                onClose={() => setImageScraperOpen(false)}
              />
            ) : showDatasetPanes && detail ? (
              middleTab === 'validate' ? (
                <ValidationDetailsPanel datasetId={detail.id} />
              ) : middleTab === 'weight' ? (
                <WeightValidationDetailsPanel datasetId={detail.id} />
              ) : middleTab === 'stress' ? (
                <StressTestDetailsPanel datasetId={detail.id} />
              ) : middleTab === 'upscale' ? (
                <UpscaleDetailsPanel datasetId={detail.id} />
              ) : middleTab === 'context' || middleTab === 'expression' ? (
                <DiversifyDetailsPanel datasetId={detail.id} mode={middleTab} />
              ) : middleTab === 'output' && toolFlags.comfy ? (
                <OutputValidationDetails
                  datasetId={detail.id}
                  checkpoint={selectedCheckpoint}
                  onRatingsChanged={(patch) => {
                    setRatingPatch(patch)
                    setSelectedCheckpoint((cp) => {
                      if (!cp) return cp
                      const stem = cp.fileName.replace(/\.safetensors$/i, '')
                      if (stem !== patch.stem) return cp
                      return {
                        ...cp,
                        averageRating: patch.averageRating,
                        ratingCount: patch.ratingCount
                      }
                    })
                  }}
                  onPreviewDeleted={({ stem, setLabel }) => {
                    setOutputsRefreshKey((k) => k + 1)
                    setSelectedCheckpoint((cp) => {
                      if (!cp) return cp
                      const cpStem = cp.fileName.replace(/\.safetensors$/i, '')
                      if (cpStem !== stem) return cp
                      const validationImages = cp.validationImages.filter(
                        (img) => img.setLabel !== setLabel
                      )
                      return {
                        ...cp,
                        validationImages,
                        validationImageRelativePath: validationImages[0]?.relativePath ?? null
                      }
                    })
                  }}
                />
              ) : (
                <DatasetDetailsForm
                  detail={detail}
                  categoryOptions={categoryOptions}
                  selectedImage={selectedImage}
                  selectedImages={selectedImages}
                  captionReloadKey={captionReloadKey}
                  showCaptionGuidance={toolFlags.joyCaption}
                  onSaveMeta={saveMeta}
                  onStatus={setStatus}
                  onError={setError}
                />
              )
            ) : (
              <div className="panel details-panel">
                <p className="hint" style={{ margin: '1rem' }}>
                  {selectedId ? 'Loading…' : 'Dataset details appear here.'}
                </p>
              </div>
            )
          }
        />
      </div>

      <CategoryManager
        open={catOpen}
        categories={categories}
        onClose={() => setCatOpen(false)}
        onChanged={refreshAll}
      />

      <AddDatasetDialog
        open={addOpen}
        categories={categories}
        onClose={() => setAddOpen(false)}
        onCreated={(created, _categoryId, datasetName) => {
          useAppStore.setState((s) => ({
            datasets: [created, ...s.datasets.filter((d) => d.id !== created.id)],
            selectedDatasetId: created.id,
            datasetDetail: created,
            selectedImage: created.images[0]?.fileName ?? null,
            selectedImages: created.images[0]?.fileName ? [created.images[0].fileName] : [],
            error: null
          }))
          setStatus(`Added dataset ${datasetName}`)
          void refreshAll()
        }}
        onError={setError}
      />

      {detail && createFromImageFile ? (
        <CreateDatasetFromImageDialog
          open
          sourceDatasetId={detail.id}
          fileName={createFromImageFile}
          categories={categories}
          onClose={() => setCreateFromImageFile(null)}
          onCreated={(created, datasetName) => {
            useAppStore.setState((s) => ({
              datasets: [created, ...s.datasets.filter((d) => d.id !== created.id)],
              selectedDatasetId: created.id,
              datasetDetail: created,
              selectedImage: created.images[0]?.fileName ?? null,
              selectedImages: created.images[0]?.fileName ? [created.images[0].fileName] : [],
              datasetsMiddleTab: 'images',
              error: null
            }))
            setStatus(`Created dataset ${datasetName} from image`)
            void refreshAll()
          }}
          onError={setError}
        />
      ) : null}

      <RenameDatasetDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        confirmFolderRename={confirmFolderRename}
      />

      <DuplicateDatasetDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
      />

      {toolFlags.joyCaption ? (
        <JoyCaptionDialog
          open={joyCaptionTarget != null}
          target={joyCaptionTarget}
          onClose={() => setJoyCaptionTarget(null)}
          onSaveGuidance={async (datasetId, captionGuidance) => {
            try {
              const updated = unwrap(
                await window.loraTraining.datasets.update({ id: datasetId, captionGuidance })
              ) as DatasetDetail
              const current = useAppStore.getState().datasetDetail
              if (current && current.id === datasetId) {
                useAppStore.setState({
                  datasetDetail: { ...current, captionGuidance: updated.captionGuidance }
                })
              }
              useAppStore.setState({
                datasets: useAppStore.getState().datasets.map((d) =>
                  d.id === datasetId ? { ...d, updatedAt: updated.updatedAt } : d
                )
              })
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
              throw err
            }
          }}
          onError={setError}
          onStatus={setStatus}
        />
      ) : null}

      <SetCaptionDialog
        open={setCaptionTarget != null}
        target={setCaptionTarget}
        onClose={() => setSetCaptionTarget(null)}
        onError={setError}
        onStatus={setStatus}
        onCaptionsChanged={() => {
          setCaptionReloadKey((k) => k + 1)
          const id = useAppStore.getState().selectedDatasetId
          if (id) void loadDataset(id)
          void refreshAll()
        }}
      />

      <IdentityTagDialog
        open={identityTagTarget != null}
        target={identityTagTarget}
        onClose={() => setIdentityTagTarget(null)}
        onError={setError}
        onStatus={setStatus}
        onCaptionsChanged={() => {
          setCaptionReloadKey((k) => k + 1)
          const id = useAppStore.getState().selectedDatasetId
          if (id) void loadDataset(id)
          void refreshAll()
        }}
      />

      <BulkToolsDialog
        open={bulkOpen}
        op={bulkOp}
        datasetId={selectedId}
        onClose={() => setBulkOpen(false)}
        onCaptionsChanged={() => setCaptionReloadKey((k) => k + 1)}
      />
    </div>
  )
}
