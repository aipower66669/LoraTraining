import type {
  DiversifyProgress,
  StressTestProgress,
  UpscaleProgress,
  ValidationProgress,
  WeightValidationProgress
} from '@shared/comfy'
import type { DiversifyMode } from '@shared/diversify-config'
import type {
  CategorySummary,
  DatasetDetail,
  DatasetSummary,
  JobDetail,
  JobSummary,
  QueueSnapshot
} from '@shared/ipc/contract'
import type { AppSettings } from '@shared/schemas/settings'
import { formatLibraryLoadStatus } from '@shared/library-load-progress'
import { toolConfigFlags } from '@shared/tool-config'
import type { AppStateGet, AppStateSet } from './types'
import { mergeCaptionFlags, selectionAfterMissing, unwrap } from './helpers'

/** Drop stale refreshAll results when a newer refresh started meanwhile. */
let refreshEpoch = 0
/** Drop stale refreshJobs results when a newer jobs/queue refresh started. */
let refreshJobsEpoch = 0
/**
 * Monotonic token for queue snapshot writes. Bumped on every intentional queue
 * update so an in-flight refreshAll/refreshJobs cannot clobber a newer
 * queue-updated / process-metrics self-heal.
 */
let queueViewEpoch = 0
/** Drop stale loadDataset results when a newer load started (or selection changed). */
let loadDatasetEpoch = 0

/** @internal — event handlers bump this when applying a fresher queue snapshot. */
export function noteQueueViewWrite(): number {
  return ++queueViewEpoch
}

/** Paint sidecar tiles immediately. Badge enrich patches the same rows later. */
function applyStickyDatasets(
  set: AppStateSet,
  get: AppStateGet,
  incoming: DatasetSummary[]
): DatasetSummary[] {
  const byId = new Map(get().datasets.map((d) => [d.id, d]))
  const list = incoming.map((d) => byId.get(d.id) ?? d)
  const progressNow = get().libraryLoadProgress
  const badgesFinished = progressNow?.phase === 'done'
  set({
    libraryLoading: false,
    datasets: list,
    ...(badgesFinished
      ? { libraryLoadProgress: null, statusMessage: 'Ready' }
      : {
          statusMessage:
            progressNow?.phase === 'enrich'
              ? formatLibraryLoadStatus(progressNow)
              : 'Updating dataset badges…',
          libraryLoadProgress:
            progressNow?.phase === 'enrich'
              ? progressNow
              : {
                  phase: 'enrich' as const,
                  done: 0,
                  total: list.length,
                  message: 'Updating dataset badges…'
                }
        })
  })
  return list
}

export async function refreshAll(set: AppStateSet, get: AppStateGet): Promise<void> {
  const epoch = ++refreshEpoch
  const qEpoch = ++queueViewEpoch
  set({
    libraryLoading: true,
    libraryLoadProgress: {
      phase: 'sync',
      done: 0,
      total: 0,
      message: 'Loading library…'
    },
    datasetsListToken: epoch,
    statusMessage: 'Loading library…'
  })
  try {
    // Categories first so renames / folder badges show before the slower dataset sync.
    const [settings, categories, version] = await Promise.all([
      window.loraTraining.settings.get(),
      window.loraTraining.categories.list(),
      window.loraTraining.system.getVersion()
    ])
    if (epoch !== refreshEpoch) return
    set({
      settings: unwrap(settings) as AppSettings,
      categories: unwrap(categories) as CategorySummary[],
      versionLabel: (() => {
        const v = unwrap(version) as { version: string; electron: string; node: string }
        return `v${v.version} · Electron ${v.electron}`
      })(),
      statusMessage: 'Discovering datasets…',
      libraryLoadProgress: {
        phase: 'sync',
        done: 0,
        total: 0,
        message: 'Discovering datasets…'
      }
    })

    const prioritize = get().explorerStatusFilter
    const jobsPromise = window.loraTraining.jobs.list().then((result) => {
      if (epoch === refreshEpoch) {
        try {
          set({ jobs: unwrap(result) as JobSummary[] })
        } catch {
          /* leave jobs as-is; final set handles errors */
        }
      }
      return result
    })
    const datasetsPromise = window.loraTraining
      .datasets.list({
        prioritize,
        listToken: epoch,
        deferBadges: true
      })
      .then((result) => {
        if (epoch === refreshEpoch) {
          try {
            applyStickyDatasets(set, get, unwrap(result) as DatasetSummary[])
          } catch {
            /* final set handles a bad payload */
          }
        }
        return result
      })
    const [
      datasets,
      jobs,
      queue,
      validationProgress,
      weightProgress,
      stressProgress,
      continuumActive,
      upscaleProgress,
      diversifyProgress
    ] = await Promise.all([
      datasetsPromise,
      jobsPromise,
      window.loraTraining.queue.list(),
      window.loraTraining.comfy.getValidationProgress(),
      window.loraTraining.comfy.getWeightValidationProgress(),
      window.loraTraining.comfy.getStressTestProgress(),
      window.loraTraining.comfy.getPreviewContinuumActive(),
      window.loraTraining.upscale.getProgress(),
      window.loraTraining.diversify.getProgress()
    ])
    if (epoch !== refreshEpoch) return
    let validation: ValidationProgress | null = null
    try {
      validation = unwrap(validationProgress) as ValidationProgress
    } catch {
      validation = null
    }
    let weight: WeightValidationProgress | null = null
    try {
      weight = unwrap(weightProgress) as WeightValidationProgress
    } catch {
      weight = null
    }
    let stress: StressTestProgress | null = null
    try {
      stress = unwrap(stressProgress) as StressTestProgress
    } catch {
      stress = null
    }
    let previewContinuumActive = false
    try {
      previewContinuumActive = Boolean(
        (unwrap(continuumActive) as { active?: boolean }).active
      )
    } catch {
      previewContinuumActive = false
    }
    let upscale: UpscaleProgress | null = null
    try {
      upscale = unwrap(upscaleProgress) as UpscaleProgress
    } catch {
      upscale = null
    }
    let diversify: DiversifyProgress | null = null
    try {
      diversify = unwrap(diversifyProgress) as DiversifyProgress
    } catch {
      diversify = null
    }
    const incoming = unwrap(datasets) as DatasetSummary[]
    const list = applyStickyDatasets(set, get, incoming)
    const selectedId = get().selectedDatasetId
    const selectedGone =
      selectedId != null && !list.some((d) => d.id === selectedId)
    const queueSnap = unwrap(queue) as QueueSnapshot
    const listedJobs = unwrap(jobs) as JobSummary[]
    const mergedJobs = listedJobs.map((j) => {
      if (!queueSnap.jobIds.includes(j.id)) return j
      const next = queueSnap.statuses[j.id]
      return next && next !== j.status ? { ...j, status: next } : j
    })

    set({
      jobs: mergedJobs,
      ...(qEpoch === queueViewEpoch ? { queue: queueSnap } : {}),
      validationProgress: validation,
      weightProgress: weight,
      stressProgress: stress,
      previewContinuumActive,
      upscaleProgress: upscale,
      diversifyProgress: diversify,
      ...(selectedGone
        ? {
            selectedDatasetId: null,
            datasetDetail: null,
            selectedImage: null,
            selectedImages: [],
            error: null
          }
        : {})
    })
  } catch (err) {
    if (epoch !== refreshEpoch) return
    set({
      libraryLoading: false,
      libraryLoadProgress: null,
      statusMessage: 'Ready',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/** Jobs + queue only — skips the slow full-library datasets.list() walk. */
export async function refreshJobs(set: AppStateSet): Promise<void> {
  const epoch = ++refreshJobsEpoch
  const qEpoch = ++queueViewEpoch
  try {
    const [jobs, queue] = await Promise.all([
      window.loraTraining.jobs.list(),
      window.loraTraining.queue.list()
    ])
    // Auto-advance fires complete→idle then running in quick succession; a slow
    // list() from the idle refresh must not overwrite the newer running snapshot.
    if (epoch !== refreshJobsEpoch) return
    const queueSnap = unwrap(queue) as QueueSnapshot
    const listed = unwrap(jobs) as JobSummary[]
    // Keep FIFO members aligned with the queue snapshot (enqueue → queued) even
    // if jobs.list briefly returns a stale failed/draft from a racing cold load.
    const mergedJobs = listed.map((j) => {
      if (!queueSnap.jobIds.includes(j.id)) return j
      const next = queueSnap.statuses[j.id]
      return next && next !== j.status ? { ...j, status: next } : j
    })
    set({
      jobs: mergedJobs,
      ...(qEpoch === queueViewEpoch ? { queue: queueSnap } : {})
    })
  } catch (err) {
    if (epoch !== refreshJobsEpoch) return
    set({ error: err instanceof Error ? err.message : String(err) })
  }
}

export async function loadDataset(
  set: AppStateSet,
  get: AppStateGet,
  id: string,
  opts?: { preserveCaptionFlags?: boolean }
): Promise<void> {
  const epoch = ++loadDatasetEpoch
  const prevDatasetId = get().selectedDatasetId
  // Switch selection immediately, but keep the previous detail mounted so the
  // 3-pane layout does not collapse to library-only (that caused a grid flash).
  // DatasetsScreen treats detail.id !== selectedId as "loading" and blanks panes.
  if (prevDatasetId !== id) {
    set({
      selectedDatasetId: id,
      selectedImage: null,
      selectedImages: []
    })
  }
  try {
    const prevSelected = get().selectedImage
    const prevSelectedImages = get().selectedImages
    const prevDetail = get().datasetDetail
    const detailRaw = unwrap(await window.loraTraining.datasets.get(id)) as DatasetDetail
    if (epoch !== loadDatasetEpoch) return
    // Re-read after await: a fast local delete may have already advanced selection.
    const selectedNow = get().selectedImage
    const detailNow = get().datasetDetail
    const detail = opts?.preserveCaptionFlags
      ? mergeCaptionFlags(detailNow?.id === id ? detailNow : prevDetail, detailRaw)
      : detailRaw

    let keep: string | null
    if (prevDatasetId !== id) {
      // Switching datasets: first image is fine.
      keep = detail.images[0]?.fileName ?? null
    } else if (selectedNow && detail.images.some((i) => i.fileName === selectedNow)) {
      keep = selectedNow
    } else if (prevSelected && detail.images.some((i) => i.fileName === prevSelected)) {
      keep = prevSelected
    } else {
      // Selection was deleted (or raced): pick next/prev from a list that still had that file.
      const missing =
        (selectedNow && !detail.images.some((i) => i.fileName === selectedNow) ? selectedNow : null) ??
        (prevSelected && !detail.images.some((i) => i.fileName === prevSelected) ? prevSelected : null)
      const lists = [prevDetail, detailNow].filter((d): d is DatasetDetail => !!d && d.id === id)
      const anchor =
        lists.find((d) => missing != null && d.images.some((i) => i.fileName === missing))?.images ??
        lists[0]?.images
      keep = selectionAfterMissing(anchor, missing, detail.images)
    }

    const present = new Set(detail.images.map((i) => i.fileName))
    let selectedImages: string[]
    if (prevDatasetId !== id) {
      selectedImages = keep ? [keep] : []
    } else {
      selectedImages = prevSelectedImages.filter((f) => present.has(f))
      if (selectedImages.length === 0) {
        selectedImages = keep ? [keep] : []
      } else if (keep && !selectedImages.includes(keep)) {
        keep = selectedImages[0] ?? null
      }
    }

    if (epoch !== loadDatasetEpoch) return
    set({
      selectedDatasetId: id,
      datasetDetail: detail,
      selectedImage: keep,
      selectedImages,
      error: null
    })
  } catch (err) {
    if (epoch !== loadDatasetEpoch) return
    const message = err instanceof Error ? err.message : String(err)
    const gone =
      message.toLowerCase().includes('dataset not found') ||
      (err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'no-dataset')
    if (gone) {
      // Folder vanished — drop the ghost selection and refresh the library list.
      set({
        selectedDatasetId: null,
        datasetDetail: null,
        selectedImage: null,
        selectedImages: [],
        error: null
      })
      void refreshAll(set, get)
      return
    }
    set({ error: message })
  }
}

export async function loadJob(set: AppStateSet, id: string): Promise<void> {
  try {
    const detail = unwrap(await window.loraTraining.jobs.get(id)) as JobDetail
    set({ selectedJobId: id, jobDetail: detail })
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) })
  }
}

export async function goToActiveValidation(set: AppStateSet, get: AppStateGet): Promise<void> {
  const progress = get().validationProgress
  const datasetId = progress?.datasetId
  if (!datasetId || progress?.status !== 'running') return
  const setIndex = typeof progress.setIndex === 'number' ? progress.setIndex : 0
  set({ screen: 'datasets', error: null })
  await get().loadDataset(datasetId)
  set({
    datasetsMiddleTab: 'validate',
    validationFocusRequest: {
      datasetId,
      setIndex,
      token: (get().validationFocusRequest?.token ?? 0) + 1
    }
  })
}

export async function goToActiveWeightValidation(
  set: AppStateSet,
  get: AppStateGet
): Promise<void> {
  const progress = get().weightProgress
  const datasetId = progress?.datasetId
  if (!datasetId || progress?.status !== 'running') return
  const setIndex = typeof progress.setIndex === 'number' ? progress.setIndex : 0
  set({ screen: 'datasets', error: null })
  await get().loadDataset(datasetId)
  set({
    datasetsMiddleTab: 'weight',
    weightFocusRequest: {
      datasetId,
      setIndex,
      token: (get().weightFocusRequest?.token ?? 0) + 1
    }
  })
}

export async function goToActiveStressTest(set: AppStateSet, get: AppStateGet): Promise<void> {
  const progress = get().stressProgress
  const datasetId = progress?.datasetId
  if (!datasetId || progress?.status !== 'running') return
  const setIndex = typeof progress.setIndex === 'number' ? progress.setIndex : 0
  set({ screen: 'datasets', error: null })
  await get().loadDataset(datasetId)
  set({
    datasetsMiddleTab: 'stress',
    stressFocusRequest: {
      datasetId,
      setIndex,
      token: (get().stressFocusRequest?.token ?? 0) + 1
    }
  })
}

/** Jump to whichever preview run is active (Steps / Weight / Stress). */
export async function goToActivePreviewRun(set: AppStateSet, get: AppStateGet): Promise<void> {
  if (get().validationProgress?.status === 'running') {
    await goToActiveValidation(set, get)
    return
  }
  if (get().weightProgress?.status === 'running') {
    await goToActiveWeightValidation(set, get)
    return
  }
  if (get().stressProgress?.status === 'running') {
    await goToActiveStressTest(set, get)
  }
}

/** "Upscale" from ImageGrid: switch to the Upscale tab with this dataset image as source. */
export async function requestUpscale(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string,
  fileName: string
): Promise<void> {
  if (!toolConfigFlags(get().settings).comfy) {
    get().setError('ComfyUI is not configured. Set Settings → ComfyUI → LoRA folder.')
    return
  }
  if (get().selectedDatasetId !== datasetId) {
    await get().loadDataset(datasetId)
  }
  set({
    datasetsMiddleTab: 'upscale',
    upscaleOpenRequest: {
      datasetId,
      fileName,
      token: (get().upscaleOpenRequest?.token ?? 0) + 1
    }
  })
}

const LAST_DIVERSIFY_MODE_KEY = 'lora-training:last-diversify-mode'

export function readLastDiversifyMode(): DiversifyMode {
  try {
    const v = localStorage.getItem(LAST_DIVERSIFY_MODE_KEY)
    return v === 'expression' ? 'expression' : 'context'
  } catch {
    return 'context'
  }
}

export function writeLastDiversifyMode(mode: DiversifyMode): void {
  try {
    localStorage.setItem(LAST_DIVERSIFY_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** Diversify from ImageGrid/toolbar: open Context or Expression with this image. */
export async function requestDiversify(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string,
  fileName: string,
  mode?: DiversifyMode
): Promise<void> {
  if (!toolConfigFlags(get().settings).comfy) {
    get().setError('ComfyUI is not configured. Set Settings → ComfyUI → LoRA folder.')
    return
  }
  const resolved = mode ?? readLastDiversifyMode()
  writeLastDiversifyMode(resolved)
  if (get().selectedDatasetId !== datasetId) {
    await get().loadDataset(datasetId)
  }
  set({
    datasetsMiddleTab: resolved,
    diversifyOpenRequest: {
      datasetId,
      fileName,
      mode: resolved,
      token: (get().diversifyOpenRequest?.token ?? 0) + 1
    }
  })
}

export function openImageEditor(
  set: AppStateSet,
  datasetId: string,
  fileName: string
): void {
  set({ imageEditor: { datasetId, fileName }, error: null })
}

export function closeImageEditor(set: AppStateSet): void {
  set({ imageEditor: null })
}

/** Save Filerobot output as the next tip ADS version (`$DATA` stays pristine on NTFS). */
export async function saveEditedImage(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string,
  fileName: string,
  dataBase64: string
): Promise<void> {
  try {
    unwrap(await window.loraTraining.imageEdit.save(datasetId, fileName, dataBase64))
    set({ imageEditor: null })
    get().setStatus(`Saved ${fileName}`)
    if (get().selectedDatasetId === datasetId) {
      await get().loadDataset(datasetId)
      // Tip ADS save does not bump $DATA mtime; force caption/media consumers to refresh.
      set({ captionReloadNonce: get().captionReloadNonce + 1 })
    }
  } catch (e) {
    get().setError(e instanceof Error ? e.message : String(e))
    throw e
  }
}

/** Save As… via system dialog (new file; no version history). */
export async function saveEditedImageAs(
  get: AppStateGet,
  datasetId: string,
  fileName: string,
  dataBase64: string
): Promise<string | null> {
  const detail = get().datasetDetail
  const folder =
    detail && detail.id === datasetId ? detail.folderPath.replace(/[/\\]+$/, '') : ''
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : '.jpg'
  const sep = folder.includes('\\') || !folder.includes('/') ? '\\' : '/'
  const defaultPath = folder ? `${folder}${sep}${stem}_edited${ext}` : `${stem}_edited${ext}`
  try {
    const res = unwrap(
      await window.loraTraining.imageEdit.saveAs(dataBase64, defaultPath)
    ) as { path: string | null; cancelled: boolean }
    if (res.cancelled || !res.path) return null
    const savedName = res.path.replace(/^.*[/\\]/, '')
    get().setStatus(`Saved as ${savedName}`)
    const savedDir = res.path.replace(/[/\\][^/\\]+$/, '').replace(/[/\\]+$/, '')
    const sameFolder =
      folder.length > 0 &&
      savedDir.replace(/\//g, '\\').toLowerCase() === folder.replace(/\//g, '\\').toLowerCase()
    if (sameFolder && get().selectedDatasetId === datasetId) {
      await get().loadDataset(datasetId)
    }
    return res.path
  } catch (e) {
    get().setError(e instanceof Error ? e.message : String(e))
    throw e
  }
}
