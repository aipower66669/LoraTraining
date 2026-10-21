import { formatCaptionProgressStatus } from '@shared/caption-progress'
import { formatLibraryLoadStatus } from '@shared/library-load-progress'
import { imageStem } from '@shared/schemas/dataset'
import { datasetLifecycleStatus, type AppEvent, type QueueSnapshot } from '@shared/ipc/contract'
import type { AppStateGet, AppStateSet } from './types'
import { applyCompletedCaptions } from './helpers'
import { noteQueueViewWrite } from './actions'

/** Patch library + open detail trained/validated flags without a full refreshAll. */
function patchDatasetTrainedFlag(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string
): void {
  const datasets = get().datasets
  const detail = get().datasetDetail
  // New checkpoints lack Set previews → drop Validated/Done until completeness sync says otherwise.
  const nextDatasets = datasets.map((d) => {
    if (d.id !== datasetId) return d
    if (d.trained && !d.validated && !d.done) return d
    return {
      ...d,
      trained: true,
      validated: false,
      done: false,
      status: datasetLifecycleStatus({
        ready: d.ready,
        trained: true,
        validated: false,
        done: false
      })
    }
  })
  const nextDetail =
    detail && detail.id === datasetId
      ? {
          ...detail,
          trained: true,
          validated: false,
          done: false,
          status: datasetLifecycleStatus({
            ready: detail.ready,
            trained: true,
            validated: false,
            done: false
          })
        }
      : detail
  if (nextDatasets === datasets && nextDetail === detail) return
  set({
    datasets: nextDatasets,
    ...(nextDetail !== detail ? { datasetDetail: nextDetail } : {})
  })
}

/** Patch library + open detail Validated badge (promote or demote). */
function patchDatasetValidatedFlag(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string,
  validated: boolean
): void {
  const datasets = get().datasets
  const detail = get().datasetDetail
  const nextDatasets = datasets.map((d) => {
    if (d.id !== datasetId || d.validated === validated) return d
    const done = validated ? d.done : false
    return {
      ...d,
      validated,
      done,
      trained: validated ? true : d.trained,
      status: datasetLifecycleStatus({
        ready: d.ready,
        trained: validated ? true : d.trained,
        validated,
        done
      })
    }
  })
  const nextDetail =
    detail && detail.id === datasetId && detail.validated !== validated
      ? {
          ...detail,
          validated,
          done: validated ? detail.done : false,
          trained: validated ? true : detail.trained,
          status: datasetLifecycleStatus({
            ready: detail.ready,
            trained: validated ? true : detail.trained,
            validated,
            done: validated ? detail.done : false
          })
        }
      : detail
  if (nextDatasets === datasets && nextDetail === detail) return
  set({
    datasets: nextDatasets,
    ...(nextDetail !== detail ? { datasetDetail: nextDetail } : {})
  })
}

let refreshJobsFromEventsTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefreshJobs(get: AppStateGet): void {
  if (refreshJobsFromEventsTimer) clearTimeout(refreshJobsFromEventsTimer)
  refreshJobsFromEventsTimer = setTimeout(() => {
    refreshJobsFromEventsTimer = null
    void get().refreshJobs()
  }, 120)
}

function onJobUpdated(
  set: AppStateSet,
  get: AppStateGet,
  payload: {
    jobId?: string
    status: string
    progress?: import('@shared/ipc/contract').JobProgress | null
    datasetId?: string
  }
): void {
  // Apply status immediately — do not wait for a slow jobs.list() that can race
  // and briefly (or permanently, via stale cache) show failed after enqueue.
  if (payload.jobId && payload.status) {
    const status = payload.status as import('@shared/ipc/contract').JobSummary['status']
    const jobs = get().jobs
    const detail = get().jobDetail
    set({
      jobs: jobs.map((j) => (j.id === payload.jobId ? { ...j, status } : j)),
      ...(detail?.id === payload.jobId ? { jobDetail: { ...detail, status } } : {})
    })
  }
  scheduleRefreshJobs(get)
  const terminal = ['complete', 'failed', 'cancelled', 'draft'].includes(payload.status)
  const runningId = get().queue?.runningJobId ?? null
  // A late "complete" from job N must not wipe metrics for job N+1 already running.
  if (terminal) {
    if (!runningId || runningId === payload.jobId) {
      set({ liveProgress: null })
    }
  } else if (payload.progress) {
    set({ liveProgress: payload.progress })
  }
  if (payload.status === 'complete') {
    const datasetId =
      payload.datasetId ??
      (payload.jobId ? get().jobs.find((j) => j.id === payload.jobId)?.datasetId : undefined)
    if (datasetId) patchDatasetTrainedFlag(set, get, datasetId)
  }
}

function onQueueUpdated(set: AppStateSet, payload: QueueSnapshot): void {
  noteQueueViewWrite()
  set((s) => ({
    queue: payload,
    // Keep Jobs list pills in sync with the queue snapshot (enqueue → queued).
    jobs: s.jobs.map((j) => {
      const next = payload.statuses[j.id]
      return next && next !== j.status ? { ...j, status: next } : j
    }),
    jobDetail:
      s.jobDetail && payload.statuses[s.jobDetail.id]
        ? { ...s.jobDetail, status: payload.statuses[s.jobDetail.id]! }
        : s.jobDetail
  }))
}

function onCaptionProgress(
  set: AppStateSet,
  get: AppStateGet,
  p: Extract<AppEvent, { type: 'caption-progress' }>['payload']
): void {
  const selected = get().selectedImage
  const detail = get().datasetDetail
  const sameDataset = detail?.id === p.datasetId
  const completedNames = p.completedFileNames?.length
    ? p.completedFileNames
    : p.lastCompletedFileName
      ? [p.lastCompletedFileName]
      : []
  const nextDetail = sameDataset ? applyCompletedCaptions(detail, completedNames) : detail
  const shouldReloadCaption =
    sameDataset &&
    p.lastCompletedFileName &&
    selected &&
    (p.lastCompletedFileName.toLowerCase() === selected.toLowerCase() ||
      imageStem(p.lastCompletedFileName).toLowerCase() === imageStem(selected).toLowerCase())
  set({
    captionProgress: p,
    statusMessage: formatCaptionProgressStatus(p),
    datasetDetail: nextDetail,
    captionReloadNonce: shouldReloadCaption
      ? get().captionReloadNonce + 1
      : get().captionReloadNonce
  })
  // No loadDataset here — caption flags are patched above; full reload stomps edits.
}

function onToolRunUpdated(
  set: AppStateSet,
  get: AppStateGet,
  payload: Extract<AppEvent, { type: 'tool-run-updated' }>['payload']
): void {
  if (payload.status === 'running') {
    if (payload.message) {
      get().setStatus(payload.message)
    }
    return
  }
  const msg = payload.message ? payload.message : `Tool run ${payload.status}`
  if (!get().captionProgress || get().captionProgress?.status !== 'running') {
    get().setStatus(msg)
  }
  // Callers that mutate images (convert/shrink/bulk) already reload explicitly when done.
}

function patchImageHasOriginal(
  set: AppStateSet,
  get: AppStateGet,
  datasetId: string,
  fileName: string,
  hasOriginal: boolean
): void {
  const detail = get().datasetDetail
  if (!detail || detail.id !== datasetId) return
  set({
    datasetDetail: {
      ...detail,
      images: detail.images.map((img) =>
        img.fileName === fileName
          ? {
              ...img,
              hasOriginal,
              versionCount: hasOriginal ? Math.max(img.versionCount, 1) : 0
            }
          : img
      )
    }
  })
}

function onUpscaleProgress(
  set: AppStateSet,
  get: AppStateGet,
  payload: Extract<AppEvent, { type: 'upscale-progress' }>['payload']
): void {
  set({ upscaleProgress: payload })
  if (!payload.datasetId || !payload.fileName) return

  // Run all: keep the middle/details panes on the image currently being processed.
  if (payload.status === 'running' && (payload.batchTotal ?? 0) > 1) {
    const src = get().upscaleSource
    if (
      !src ||
      src.datasetId !== payload.datasetId ||
      src.fileName !== payload.fileName
    ) {
      set({
        upscaleSource: { datasetId: payload.datasetId, fileName: payload.fileName }
      })
    }
  }

  if (typeof payload.hasOriginal === 'boolean') {
    patchImageHasOriginal(set, get, payload.datasetId, payload.fileName, payload.hasOriginal)
  }
}

function onDiversifyProgress(
  set: AppStateSet,
  get: AppStateGet,
  payload: Extract<AppEvent, { type: 'diversify-progress' }>['payload']
): void {
  set({ diversifyProgress: payload })
  if (!payload.datasetId || !payload.fileName) return

  if (payload.status === 'running' && (payload.batchTotal ?? 0) > 1) {
    const src = get().diversifySource
    if (
      !src ||
      src.datasetId !== payload.datasetId ||
      src.fileName !== payload.fileName
    ) {
      set({
        diversifySource: { datasetId: payload.datasetId, fileName: payload.fileName }
      })
    }
  }
}

/**
 * Image add/remove detected by folder watch (dataset.json / captions ignored).
 * Also patches library lifecycle badges when main includes trained/validated flags
 * (training checkpoints / validation sync) — does not require the dataset to be open.
 */
function onDatasetFolderChanged(
  set: AppStateSet,
  get: AppStateGet,
  payload: Extract<AppEvent, { type: 'dataset-folder-changed' }>['payload']
): void {
  const { datasetId, trained, validated, done } = payload

  if (
    typeof trained === 'boolean' ||
    typeof validated === 'boolean' ||
    typeof done === 'boolean'
  ) {
    const datasets = get().datasets
    const detail = get().datasetDetail
    const nextDatasets = datasets.map((d) => {
      if (d.id !== datasetId) return d
      const nextTrained = typeof trained === 'boolean' ? trained : d.trained
      const nextValidated = typeof validated === 'boolean' ? validated : d.validated
      const nextDone = !nextValidated
        ? false
        : typeof done === 'boolean'
          ? done
          : d.done
      if (
        nextTrained === d.trained &&
        nextValidated === d.validated &&
        nextDone === d.done
      ) {
        return d
      }
      return {
        ...d,
        trained: nextTrained,
        validated: nextValidated,
        done: nextDone,
        status: datasetLifecycleStatus({
          ready: d.ready,
          trained: nextTrained,
          validated: nextValidated,
          done: nextDone
        })
      }
    })
    const nextDetail =
      detail && detail.id === datasetId
        ? (() => {
            const nextTrained = typeof trained === 'boolean' ? trained : detail.trained
            const nextValidated =
              typeof validated === 'boolean' ? validated : detail.validated
            const nextDone = !nextValidated
              ? false
              : typeof done === 'boolean'
                ? done
                : detail.done
            if (
              nextTrained === detail.trained &&
              nextValidated === detail.validated &&
              nextDone === detail.done
            ) {
              return detail
            }
            return {
              ...detail,
              trained: nextTrained,
              validated: nextValidated,
              done: nextDone,
              status: datasetLifecycleStatus({
                ready: detail.ready,
                trained: nextTrained,
                validated: nextValidated,
                done: nextDone
              })
            }
          })()
        : detail
    if (nextDatasets !== datasets || nextDetail !== detail) {
      set({
        datasets: nextDatasets,
        ...(nextDetail !== detail ? { datasetDetail: nextDetail } : {})
      })
    }
  }

  if (get().selectedDatasetId !== datasetId) return
  const prev = get().datasetDetail
  void get()
    .loadDataset(datasetId)
    .then(() => {
      const detail = get().datasetDetail
      if (!detail || detail.id !== datasetId) return
      if (prev && prev.id === datasetId) {
        set({
          datasetDetail: {
            ...detail,
            name: prev.name,
            trigger: prev.trigger,
            notes: prev.notes,
            captionGuidance: prev.captionGuidance,
            categoryId: prev.categoryId,
            ready: prev.ready
          }
        })
      }
      set({
        datasets: get().datasets.map((d) =>
          d.id === datasetId
            ? {
                ...d,
                stats: detail.stats,
                coverFileName: detail.coverFileName,
                updatedAt: detail.updatedAt,
                ready: detail.ready,
                trained: detail.trained,
                validated: detail.validated,
                done: detail.done,
                status: detail.status
              }
            : d
        )
      })
    })
}

function onCategoryDatasetsChanged(set: AppStateSet, get: AppStateGet): void {
  // Library list only — do not reload the open dataset detail.
  void get().refreshAll()
}

function onDatasetsListPartial(
  set: AppStateSet,
  get: AppStateGet,
  payload: {
    listToken: number
    phase: 'sticky' | 'enrich'
    datasets: import('@shared/ipc/contract').DatasetSummary[]
  }
): void {
  if (payload.listToken !== get().datasetsListToken) return
  if (payload.phase === 'sticky') {
    set({
      datasets: payload.datasets,
      libraryLoading: false,
      statusMessage: 'Updating dataset badges…'
    })
    return
  }
  if (payload.datasets.length === 0) return
  const byId = new Map(payload.datasets.map((d) => [d.id, d]))
  set({
    datasets: get().datasets.map((d) => byId.get(d.id) ?? d)
  })
}

function onLibraryLoadProgress(
  set: AppStateSet,
  get: AppStateGet,
  payload: import('@shared/library-load-progress').LibraryLoadProgress & {
    listToken: number
  }
): void {
  if (payload.listToken !== get().datasetsListToken) return
  const { listToken: _t, ...progress } = payload
  set({
    libraryLoadProgress: progress.phase === 'done' ? null : progress,
    statusMessage: formatLibraryLoadStatus(progress)
  })
}

/** Central event router for events pushed from the main process. */
export function applyEvent(set: AppStateSet, get: AppStateGet, event: AppEvent): void {
  switch (event.type) {
    case 'validation-progress':
      set({ validationProgress: event.payload })
      if (event.payload.datasetId && event.payload.status === 'done') {
        const complete = (event.payload.lastMessage ?? '').includes(
          'All validation sets complete'
        )
        patchDatasetValidatedFlag(set, get, event.payload.datasetId, complete)
      }
      return
    case 'weight-progress':
      set({ weightProgress: event.payload })
      return
    case 'stress-progress':
      set({ stressProgress: event.payload })
      return
    case 'preview-continuum':
      set({ previewContinuumActive: event.payload.active })
      return
    case 'upscale-progress':
      onUpscaleProgress(set, get, event.payload)
      return
    case 'diversify-progress':
      onDiversifyProgress(set, get, event.payload)
      return
    case 'process-log':
      get().pushLog({
        stream: event.payload.stream === 'stderr' ? 'stderr' : 'stdout',
        line: event.payload.line
      })
      return
    case 'process-metrics': {
      // Self-heal if a stale refreshJobs/queue-updated left the UI thinking idle
      // while training is still emitting metrics (common after auto-advance).
      const jobId = event.payload.jobId
      const queue = get().queue
      const jobs = get().jobs
      const patch: {
        liveProgress: typeof event.payload.progress
        queue?: QueueSnapshot
        jobs?: typeof jobs
      } = { liveProgress: event.payload.progress }
      if (queue && queue.runningJobId !== jobId) {
        noteQueueViewWrite()
        patch.queue = {
          ...queue,
          runningJobId: jobId,
          statuses: { ...queue.statuses, [jobId]: 'running' }
        }
      }
      if (jobs.some((j) => j.id === jobId && j.status !== 'running')) {
        patch.jobs = jobs.map((j) => (j.id === jobId ? { ...j, status: 'running' } : j))
      }
      set(patch)
      return
    }
    case 'job-updated':
      onJobUpdated(set, get, event.payload)
      return
    case 'queue-updated':
      onQueueUpdated(set, event.payload)
      return
    case 'caption-progress':
      onCaptionProgress(set, get, event.payload)
      return
    case 'tool-run-updated':
      onToolRunUpdated(set, get, event.payload)
      return
    case 'dataset-folder-changed':
      onDatasetFolderChanged(set, get, event.payload)
      return
    case 'category-datasets-changed':
      onCategoryDatasetsChanged(set, get)
      return
    case 'datasets-list-partial':
      onDatasetsListPartial(set, get, event.payload)
      return
    case 'library-load-progress':
      onLibraryLoadProgress(set, get, event.payload)
      return
    case 'validation-previews-changed':
      return
    case 'stress-previews-changed':
      return
  }
}
