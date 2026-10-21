import { spawn, type ChildProcess } from 'node:child_process'
import { access, appendFile, mkdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, delimiter, join, resolve } from 'node:path'
import { appError, type AppError } from '@shared/errors'
import type { JobStatus, QueueSnapshot } from '@shared/ipc/contract'
import {
  buildQueueIdsFromJobs,
  statusAfterRestart
} from '@shared/queue-hydrate'
import { resolveJobTotalSteps } from '@shared/queue-eta'
import { loadSettings } from '../settings/store'
import {
  getJobRecord,
  patchJobRuntime,
  writeYamlForJob,
  listJobs,
  listJobRecords,
  invalidateJobsCache
} from '../jobs/store'
import { datasetFullyCaptioned, missingCaptionCount } from '@shared/schemas/dataset'
import { getDatasetRecord } from '../datasets/store'
import { broadcast } from '../events/bus'
import { killProcessTree, pythonChildEnv } from '../runners/process-utils'
import { resolveTrainBootstrap } from '../runners/python-shim-path'
import { createEmptyProgress, parseMetricsLine } from '../progress/parser'
import { isCaptionBusy } from '../runners/joycaption'
import { resolvePythonExecutable, resolveScriptPath } from '../runners/resolve-python'
import { logger } from '../logging'
import { ensureJobsDir } from '../settings/store'
import { renameFinalCheckpoint } from '../jobs/renameFinalCheckpoint'
import { onTrainingProcessStarted, onTrainingQueueIdle } from './training-session'

let queueIds: string[] = []
let runningJobId: string | null = null
let activeChild: ChildProcess | null = null
let startedAtMs = 0
let userStopped = false
/** Set while Pause is killing the training process (exit code is non-zero). */
let userPaused = false
/** Finish the running job, then do not auto-start the next queued job. */
let stopAfterCurrent = false
let hydrated = false
/** After a successful empty-queue disk check, don't keep re-scanning !Jobs. */
let emptyQueueResyncDone = false

/**
 * Pause between a finished job and spawning the next one so CUDA/VRAM can settle.
 * Tests set this to 0 via `setInterJobDelayMsForTests`.
 */
let interJobDelayMs = 10_000

/** @internal vitest only */
export function setInterJobDelayMsForTests(ms: number): void {
  interJobDelayMs = Math.max(0, ms)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queueIndex(jobId: string): number {
  return queueIds.indexOf(jobId)
}

/** Keep job in the FIFO at its current (or remembered) slot. */
function ensureInQueueAt(jobId: string, preferredOrder: number | null | undefined): number {
  const existing = queueIndex(jobId)
  if (existing >= 0) return existing
  const at = Math.max(0, Math.min(preferredOrder ?? 0, queueIds.length))
  queueIds.splice(at, 0, jobId)
  return at
}

async function persistQueueOrders(): Promise<void> {
  for (let i = 0; i < queueIds.length; i++) {
    const id = queueIds[i]!
    try {
      const job = await getJobRecord(id)
      if (job.queueOrder !== i) {
        await patchJobRuntime(id, {
          queueOrder: i,
          updatedAt: new Date().toISOString()
        })
      }
    } catch {
      /* skip missing */
    }
  }
}

/**
 * Load FIFO + normalize crashed "running" → paused from disk job.json files.
 * Throws if !Jobs cannot be read (caller must not mark hydrated in that case).
 */
async function loadQueueFromDisk(): Promise<void> {
  const records = await listJobRecords()
  const existingIds = new Set(records.map((r) => r.id))
  queueIds = buildQueueIdsFromJobs(records).filter((id) => existingIds.has(id))

  for (const id of queueIds) {
    const job = records.find((r) => r.id === id)
    if (!job) continue
    const nextStatus = statusAfterRestart(job.status)
    if (nextStatus !== job.status) {
      try {
        await patchJobRuntime(id, {
          status: nextStatus,
          updatedAt: new Date().toISOString()
        })
        broadcast({ type: 'job-updated', payload: { jobId: id, status: nextStatus } })
      } catch (err) {
        logger.warn({ err, jobId: id }, 'queue hydrate status normalize failed')
      }
    }
  }

  // Never resume a running child after restart — process is gone.
  runningJobId = null
  activeChild = null
  onTrainingQueueIdle()

  if (queueIds.length > 0) {
    logger.info({ count: queueIds.length, queueIds }, 'queue restored from disk')
  } else {
    logger.info('queue hydrate: no queued/paused jobs on disk')
  }
}

/**
 * If memory says the FIFO is empty but disk still has queued members (e.g. first
 * hydrate raced an unavailable library drive and cached nothing), rebuild once.
 */
async function maybeResyncEmptyQueueFromDisk(): Promise<void> {
  if (queueIds.length > 0 || runningJobId || emptyQueueResyncDone) return
  invalidateJobsCache()
  let records: Awaited<ReturnType<typeof listJobRecords>>
  try {
    records = await listJobRecords()
  } catch (err) {
    // Drive may still be unavailable — try again on a later ensureHydrated.
    logger.warn({ err }, 'queue re-sync skipped — !Jobs unreadable')
    return
  }
  emptyQueueResyncDone = true
  const existingIds = new Set(records.map((r) => r.id))
  const ids = buildQueueIdsFromJobs(records).filter((id) => existingIds.has(id))
  if (ids.length === 0) return
  logger.warn(
    { count: ids.length },
    'queue FIFO was empty in memory but disk has queue members — restoring'
  )
  queueIds = ids
  for (const id of queueIds) {
    const job = records.find((r) => r.id === id)
    if (!job) continue
    const nextStatus = statusAfterRestart(job.status)
    if (nextStatus !== job.status) {
      try {
        await patchJobRuntime(id, {
          status: nextStatus,
          updatedAt: new Date().toISOString()
        })
        broadcast({ type: 'job-updated', payload: { jobId: id, status: nextStatus } })
      } catch (err) {
        logger.warn({ err, jobId: id }, 'queue re-sync status normalize failed')
      }
    }
  }
  await emitQueue()
}

async function ensureHydrated(): Promise<void> {
  if (hydrated) {
    await maybeResyncEmptyQueueFromDisk()
    return
  }
  await loadQueueFromDisk()
  hydrated = true
}

function snapshot(statuses?: Record<string, JobStatus>): Promise<QueueSnapshot> {
  return (async () => {
    await ensureHydrated()
    // One pass (cache hit after first load) — previously listed every job.json twice.
    const records = await listJobRecords()
    const existingIds = new Set(records.map((r) => r.id))
    // Drop orphan queue slots (deleted jobs that never left the in-memory FIFO).
    const pruned = queueIds.filter((id) => existingIds.has(id))
    if (pruned.length !== queueIds.length) {
      queueIds = pruned
    }
    const map: Record<string, JobStatus> = statuses ?? {}
    for (const r of records) map[r.id] = r.status
    const totalSteps: Record<string, number> = {}
    for (const id of queueIds) {
      const record = records.find((r) => r.id === id)
      const steps = resolveJobTotalSteps({
        configSteps: record?.config.train?.steps,
        progressTotalSteps: record?.progress?.totalSteps,
        status: record?.status ?? map[id]
      })
      if (steps > 0) totalSteps[id] = steps
    }
    return {
      jobIds: [...queueIds],
      runningJobId,
      statuses: map,
      totalSteps,
      stopAfterCurrent
    }
  })()
}

async function emitQueue(): Promise<QueueSnapshot> {
  const snap = await snapshot()
  broadcast({ type: 'queue-updated', payload: snap })
  return snap
}

export async function listQueue(): Promise<QueueSnapshot> {
  return snapshot()
}

/** Re-emit queue snapshot when a queued job's config (e.g. steps) changes. */
export async function refreshQueueAfterJobChange(jobId: string): Promise<void> {
  await ensureHydrated()
  if (!queueIds.includes(jobId)) return
  await emitQueue()
}

/** Warm the in-memory FIFO from persisted job status/queueOrder (app startup). */
export async function hydrateQueue(): Promise<QueueSnapshot> {
  return snapshot()
}

export async function enqueue(jobId: string): Promise<QueueSnapshot> {
  return enqueueMany([jobId])
}

/**
 * Enqueue one or many jobs. Caption gate uses sidecar stats when already complete,
 * otherwise a cheap readdir-only check — never a full image/ADS scan.
 * Validated demotion runs in the background after the queue snapshot returns.
 */
export async function enqueueMany(jobIds: string[]): Promise<QueueSnapshot> {
  await ensureHydrated()
  const ids = [...new Set(jobIds.filter((id) => typeof id === 'string' && id.trim()))]
  if (ids.length === 0) {
    return snapshot()
  }

  const datasetsNeedingValidatedSync = new Set<string>()

  for (const jobId of ids) {
    const job = await getJobRecord(jobId)
    const dataset = await getDatasetRecord(job.datasetId)
    try {
      await access(dataset.folderPath, constants.F_OK)
    } catch {
      throw appError('folder-missing', `Dataset folder missing: ${dataset.folderPath}`)
    }

    let liveStats = dataset.stats
    if (!datasetFullyCaptioned(liveStats)) {
      const { quickCaptionCoverage } = await import('../datasets/captionCoverage')
      liveStats = {
        ...liveStats,
        ...(await quickCaptionCoverage(dataset.folderPath, dataset.captionExt))
      }
    }
    if (!datasetFullyCaptioned(liveStats)) {
      const missing = missingCaptionCount(liveStats)
      throw appError(
        'validation',
        missing > 0
          ? `Cannot enqueue: ${missing} image${missing === 1 ? '' : 's'} still missing captions`
          : 'Cannot enqueue: dataset has no images',
        {
          remediation:
            'Caption every image before enqueueing. Training never runs with uncaptioned images.'
        }
      )
    }

    if (job.status === 'running') {
      throw appError('busy', 'Job is already running')
    }
    if (!queueIds.includes(jobId)) {
      queueIds.push(jobId)
    }
    await patchJobRuntime(jobId, {
      status: 'queued',
      queueOrder: queueIds.indexOf(jobId),
      updatedAt: new Date().toISOString(),
      lastError: null,
      finishedAt: null
    })
    broadcast({
      type: 'job-updated',
      payload: { jobId, status: 'queued', datasetId: job.datasetId }
    })
    datasetsNeedingValidatedSync.add(job.datasetId)
  }

  const snap = await emitQueue()

  // Further-training demotes Validated — do not block the enqueue IPC on output walks.
  void (async () => {
    try {
      const { syncDatasetValidatedFlag } = await import('../datasets/store')
      for (const datasetId of datasetsNeedingValidatedSync) {
        await syncDatasetValidatedFlag(datasetId).catch(() => undefined)
      }
    } catch {
      /* store mock / optional */
    }
  })()

  return snap
}

export async function removeFromQueue(jobId: string): Promise<QueueSnapshot> {
  await ensureHydrated()
  if (runningJobId === jobId) {
    throw appError('busy', 'Cannot remove a running job from the queue', {
      remediation: 'Stop or pause the job first.'
    })
  }
  queueIds = queueIds.filter((id) => id !== jobId)
  try {
    const job = await getJobRecord(jobId)
    if (job.status === 'queued') {
      await patchJobRuntime(jobId, {
        status: 'draft',
        queueOrder: null,
        updatedAt: new Date().toISOString()
      })
      broadcast({ type: 'job-updated', payload: { jobId, status: 'draft' } })
    } else if (job.queueOrder != null) {
      await patchJobRuntime(jobId, {
        queueOrder: null,
        updatedAt: new Date().toISOString()
      })
    }
  } catch {
    // Job may already be gone (delete path) — still drop the queue slot.
  }
  return emitQueue()
}

/**
 * Drop a job id from the in-memory FIFO when the job is being deleted.
 * Does not rewrite job.json (file is about to disappear).
 */
export async function purgeDeletedJobFromQueue(jobId: string): Promise<QueueSnapshot> {
  await ensureHydrated()
  if (runningJobId === jobId) {
    throw appError('busy', 'Cannot delete a running job', {
      remediation: 'Stop or pause the job first, then delete it.'
    })
  }
  const before = queueIds.length
  queueIds = queueIds.filter((id) => id !== jobId)
  if (queueIds.length === before) {
    return snapshot()
  }
  return emitQueue()
}

/** Reorder the queue. The running job (if any) is kept at the front. */
export async function reorderQueue(orderedIds: string[]): Promise<QueueSnapshot> {
  await ensureHydrated()
  const current = new Set(queueIds)
  if (
    orderedIds.length !== queueIds.length ||
    orderedIds.some((id) => !current.has(id)) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    throw appError('validation', 'Queue reorder list must match the current queue jobs')
  }

  let next = [...orderedIds]
  if (runningJobId) {
    if (!next.includes(runningJobId)) {
      throw appError('validation', 'Running job must remain in the queue')
    }
    next = [runningJobId, ...next.filter((id) => id !== runningJobId)]
  }
  queueIds = next

  for (let i = 0; i < queueIds.length; i++) {
    const id = queueIds[i]!
    try {
      const job = await getJobRecord(id)
      if (job.queueOrder !== i) {
        await patchJobRuntime(id, {
          queueOrder: i,
          updatedAt: new Date().toISOString()
        })
      }
    } catch {
      /* skip missing */
    }
  }
  return emitQueue()
}

export async function startQueue(): Promise<QueueSnapshot> {
  await ensureHydrated()
  userStopped = false
  stopAfterCurrent = false
  if (runningJobId) {
    return emitQueue()
  }
  // Start also resumes a paused job (checkpoint continue) without changing its slot.
  const jobs = await listJobs()
  const pausedSummary = jobs.find((j) => j.status === 'paused')
  if (pausedSummary) {
    try {
      const paused = await getJobRecord(pausedSummary.id)
      ensureInQueueAt(paused.id, paused.queueOrder)
    } catch {
      ensureInQueueAt(pausedSummary.id, 0)
    }
  }
  await startNext()
  return emitQueue()
}

async function startNext(): Promise<void> {
  if (runningJobId) return
  const settings = await loadSettings()
  const continueOnFailure = settings.queue.continueOnFailure !== false
  if (!settings.queue.allowConcurrentCaptioning && isCaptionBusy()) {
    throw appError('queue-busy', 'Captioning is running; training is blocked', {
      remediation: 'Wait for JoyCaption to finish or enable concurrent captioning.'
    })
  }
  // Skip cancelled/failed slots left in the FIFO after Stop; Start the next runnable job.
  for (const nextId of [...queueIds]) {
    let job
    try {
      job = await getJobRecord(nextId)
    } catch {
      queueIds = queueIds.filter((id) => id !== nextId)
      continue
    }
    if (job.status === 'queued' || job.status === 'paused' || job.status === 'draft') {
      if (queueIds[0] !== nextId) {
        queueIds = [nextId, ...queueIds.filter((id) => id !== nextId)]
      }
      try {
        await runJob(nextId, { continueOnFailure })
      } catch (err) {
        await failJobPreflight(nextId, err)
        if (!continueOnFailure) return
        continue
      }
      return
    }
  }
}

function formatJobFailureError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as AppError
    const parts = [String(e.message)]
    if (e.remediation) parts.push(e.remediation)
    return parts.join('\n').slice(0, 2000)
  }
  return String(err).slice(0, 2000)
}

/** Preflight threw before spawn — mark failed, log to UI, drop from FIFO. */
async function failJobPreflight(jobId: string, err: unknown): Promise<void> {
  const lastError = formatJobFailureError(err)
  const line = `Preflight failed: ${lastError.split('\n')[0]}`
  queueIds = queueIds.filter((id) => id !== jobId)
  const now = new Date().toISOString()
  try {
    const job = await getJobRecord(jobId)
    await patchJobRuntime(jobId, {
      status: 'failed',
      lastError,
      finishedAt: now,
      updatedAt: now,
      queueOrder: null
    })
    broadcast({
      type: 'job-updated',
      payload: { jobId, status: 'failed', datasetId: job.datasetId }
    })
    broadcast({ type: 'process-log', payload: { jobId, stream: 'stderr', line } })
    try {
      const logDir = join(await ensureJobsDir(), jobId, 'logs')
      await mkdir(logDir, { recursive: true })
      const logFile = join(logDir, `preflight-${now.replace(/[:.]/g, '-')}.log`)
      await appendFile(logFile, `${line}\n${lastError}\n`)
    } catch {
      /* best-effort */
    }
  } catch (inner) {
    logger.warn({ err: inner, jobId }, 'failJobPreflight could not persist job state')
  }
  await emitQueue()
  logger.warn({ jobId, lastError }, 'training preflight failed')
}

async function runJob(
  jobId: string,
  opts: { continueOnFailure: boolean }
): Promise<void> {
  const settings = await loadSettings()
  const tool = settings.tools.aiToolkit
  if (!tool.workingDirectory) {
    throw appError('tool-not-configured', 'AI Toolkit is not configured', {
      remediation: 'Set working directory in Settings. Python is optional if on PATH or in the venv.'
    })
  }

  let pythonExe: string
  try {
    ;({ exe: pythonExe } = await resolvePythonExecutable(
      tool.pythonExecutable,
      tool.workingDirectory
    ))
  } catch (err) {
    throw appError('tool-not-configured', err instanceof Error ? err.message : String(err), {
      remediation: 'Install Python, add it to PATH, or browse to the toolkit venv python.exe.'
    })
  }

  const runScript = resolveScriptPath(tool.runScript || 'run.py', tool.workingDirectory)

  const job = await getJobRecord(jobId)
  const dataset = await getDatasetRecord(job.datasetId)
  let liveStats = dataset.stats
  if (!datasetFullyCaptioned(liveStats)) {
    const { quickCaptionCoverage } = await import('../datasets/captionCoverage')
    liveStats = {
      ...liveStats,
      ...(await quickCaptionCoverage(dataset.folderPath, dataset.captionExt))
    }
  }
  if (!datasetFullyCaptioned(liveStats)) {
    const missing = missingCaptionCount(liveStats)
    throw appError(
      'validation',
      missing > 0
        ? `Cannot start training: ${missing} image${missing === 1 ? '' : 's'} still missing captions`
        : 'Cannot start training: dataset has no images',
      {
        remediation: 'Caption every image before training. Uncaptioned images are not allowed.'
      }
    )
  }

  // Permanently commit tip ADS edits into $DATA so AI Toolkit sees final pixels.
  const { commitDatasetImageVersions } = await import('../images/imageEdit')
  const commitResult = await commitDatasetImageVersions(dataset.folderPath)
  broadcast({
    type: 'process-log',
    payload: {
      jobId,
      stream: 'stdout',
      line: `Preflight: committed ${commitResult.committed} image tip(s), skipped ${commitResult.skipped} (no VER_*)`
    }
  })
  logger.info(
    { jobId, datasetId: job.datasetId, ...commitResult, folderPath: dataset.folderPath },
    'Committed dataset image tips before training'
  )
  if (commitResult.committed > 0) {
    const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
    await invalidateAllDatasetThumbs(job.datasetId, dataset.folderPath)
    broadcast({ type: 'dataset-folder-changed', payload: { datasetId: job.datasetId } })
  }

  const { yamlPath } = await writeYamlForJob(jobId)
  const totalSteps =
    typeof job.config.train.steps === 'number' ? job.config.train.steps : undefined

  runningJobId = jobId
  startedAtMs = Date.now()
  userStopped = false
  userPaused = false

  const progress = createEmptyProgress(totalSteps)
  const now = new Date().toISOString()
  await patchJobRuntime(jobId, {
    status: 'running',
    startedAt: job.startedAt ?? now,
    finishedAt: null,
    progress,
    lastError: null,
    updatedAt: now
  })
  broadcast({ type: 'job-updated', payload: { jobId, status: 'running', progress } })

  const logDir = join(await ensureJobsDir(), jobId, 'logs')
  await mkdir(logDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logFile = join(logDir, `train-${stamp}.log`)

  const childEnv = pythonChildEnv()
  const bootstrap = process.platform === 'win32' ? resolveTrainBootstrap() : null
  const spawnArgs = bootstrap
    ? [bootstrap, runScript, yamlPath, ...tool.extraArgs]
    : [runScript, yamlPath, ...tool.extraArgs]

  if (process.platform === 'win32') {
    const shimNote = bootstrap
      ? `[LoraTraining] training via train_bootstrap.py (safetensors 1455 workaround)\n`
      : childEnv.PYTHONPATH
        ? `[LoraTraining] WARNING: train_bootstrap.py missing — PYTHONPATH only: ${childEnv.PYTHONPATH.split(delimiter)[0]}\n`
        : '[LoraTraining] WARNING: python-shims missing — OSError 1455 workaround inactive\n'
    void appendFile(logFile, shimNote)
  }

  const child = spawn(pythonExe, spawnArgs, {
    cwd: tool.workingDirectory,
    windowsHide: true,
    env: childEnv
  })
  activeChild = child
  onTrainingProcessStarted(child.pid)

  let currentProgress = progress
  let lineBuf = ''
  /** Tail of stderr for a useful lastError when the process crashes. */
  const recentStderr: string[] = []
  const saveEveryRaw = job.config.save?.save_every
  const saveEvery =
    typeof saveEveryRaw === 'number' && Number.isFinite(saveEveryRaw) && saveEveryRaw > 0
      ? Math.floor(saveEveryRaw)
      : typeof saveEveryRaw === 'string' && Number(saveEveryRaw) > 0
        ? Math.floor(Number(saveEveryRaw))
        : 0
  let lastCheckpointSyncBucket = 0
  let checkpointSyncTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleCheckpointLifecycleSync = (): void => {
    const step = currentProgress.currentStep ?? 0
    if (saveEvery <= 0 || step < saveEvery) return
    const bucket = Math.floor(step / saveEvery)
    if (bucket <= lastCheckpointSyncBucket) return
    lastCheckpointSyncBucket = bucket
    // Wait for the .safetensors write to finish before re-checking Validated.
    if (checkpointSyncTimer) clearTimeout(checkpointSyncTimer)
    checkpointSyncTimer = setTimeout(() => {
      checkpointSyncTimer = null
      void import('../datasets/store')
        .then(({ markDatasetTrained }) => markDatasetTrained(job.datasetId))
        .catch((err) =>
          logger.warn(
            { err, jobId, datasetId: job.datasetId, step },
            'mid-train validated sync failed'
          )
        )
    }, 2000)
  }

  const applyMetrics = (line: string): void => {
    currentProgress = parseMetricsLine(line, currentProgress, startedAtMs)
    broadcast({ type: 'process-metrics', payload: { jobId, progress: currentProgress } })
    scheduleCheckpointLifecycleSync()
  }

  const onData = (stream: 'stdout' | 'stderr') => (buf: Buffer) => {
    const text = buf.toString()
    void appendFile(logFile, text)
    lineBuf += text

    // Flush newline-terminated records to the live log.
    for (;;) {
      const nl = lineBuf.search(/\r?\n/)
      if (nl < 0) break
      const line = lineBuf.slice(0, nl)
      lineBuf = lineBuf.slice(nl).replace(/^\r?\n/, '')
      if (!line.trim()) continue
      if (stream === 'stderr') {
        recentStderr.push(line.trim())
        if (recentStderr.length > 40) recentStderr.shift()
      }
      broadcast({ type: 'process-log', payload: { jobId, stream, line } })
      applyMetrics(line)
    }

    // tqdm updates with \r only — keep the latest segment for metrics, don't spam the log.
    if (lineBuf.includes('\r')) {
      const parts = lineBuf.split('\r')
      lineBuf = parts[parts.length - 1] ?? ''
      const latest = lineBuf.trim()
      if (latest) applyMetrics(latest)
    } else if (lineBuf.trim()) {
      applyMetrics(lineBuf)
    }
  }
  child.stdout?.on('data', onData('stdout'))
  child.stderr?.on('data', onData('stderr'))

  child.on('exit', (code) => {
    void (async () => {
      if (checkpointSyncTimer) {
        clearTimeout(checkpointSyncTimer)
        checkpointSyncTimer = null
      }
      // Only release the "current run" slot if this child still owns it. A late
      // exit/error from job N must not clear job N+1 after auto-advance.
      if (activeChild === child) activeChild = null
      if (runningJobId === jobId) runningJobId = null
      const latest = await getJobRecord(jobId)
      const pauseIntent = userPaused || latest.status === 'paused'
      userPaused = false

      let status: JobStatus
      if (pauseIntent) {
        status = 'paused'
      } else if (userStopped) {
        status = 'cancelled'
      } else if (code === 0) {
        status = 'complete'
      } else {
        status = 'failed'
      }

      // Stop / pause should leave the job in the FIFO (Retry / Resume / Remove).
      // Complete and failed leave the FIFO (failed does not auto-start the next).
      const leaveInQueue = status === 'paused' || status === 'cancelled'
      let order: number | null = null
      if (leaveInQueue) {
        order = ensureInQueueAt(jobId, latest.queueOrder)
      } else {
        queueIds = queueIds.filter((id) => id !== jobId)
      }

      if (status === 'complete') {
        const steps =
          typeof latest.config.train.steps === 'number'
            ? latest.config.train.steps
            : Number(latest.config.train.steps)
        try {
          const result = await renameFinalCheckpoint({
            trainingFolder: latest.config.training_folder,
            loraName: latest.config.name,
            totalSteps: steps
          })
          for (const r of result.renamed) {
            const line = `Renamed final checkpoint: ${basename(r.from)} → ${basename(r.to)}`
            void appendFile(logFile, `${line}\n`)
            broadcast({ type: 'process-log', payload: { jobId, stream: 'stdout', line } })
          }
          if (result.renamed.length === 0 && result.skippedReason) {
            logger.info(
              { jobId, reason: result.skippedReason },
              'final checkpoint rename skipped'
            )
          }
        } catch (err) {
          logger.warn({ err, jobId }, 'final checkpoint rename failed')
        }
        // tqdm often ends at total−2; snap persisted progress to configured steps.
        if (Number.isFinite(steps) && steps > 0) {
          currentProgress = {
            ...currentProgress,
            currentStep: Math.floor(steps),
            totalSteps: Math.floor(steps),
            percent: 100,
            etaMs: 0
          }
        }
        try {
          const { markDatasetTrained } = await import('../datasets/store')
          await markDatasetTrained(latest.datasetId)
        } catch (err) {
          logger.warn({ err, jobId, datasetId: latest.datasetId }, 'mark dataset trained failed')
        }
      }

      const finishedAt = new Date().toISOString()
      const failDetail =
        recentStderr.length > 0
          ? recentStderr.slice(-12).join('\n').slice(0, 2000)
          : null
      await patchJobRuntime(jobId, {
        status,
        progress: currentProgress,
        finishedAt: status === 'paused' ? null : finishedAt,
        lastError:
          status === 'failed'
            ? failDetail
              ? `Exit code ${code}\n${failDetail}`
              : `Exit code ${code}`
            : null,
        updatedAt: finishedAt,
        queueOrder: order
      })
      if (leaveInQueue) {
        await persistQueueOrders()
      }
      broadcast({
        type: 'job-updated',
        payload: {
          jobId,
          status,
          progress: currentProgress,
          datasetId: latest.datasetId
        }
      })
      await emitQueue()
      // Auto-advance after complete, or after failure when continueOnFailure is on.
      // Skip if another job already owns the slot (stale handler after advance).
      const mayAdvance =
        !userStopped &&
        !stopAfterCurrent &&
        !runningJobId &&
        (status === 'complete' || (status === 'failed' && opts.continueOnFailure))
      if (stopAfterCurrent && (status === 'complete' || status === 'failed')) {
        stopAfterCurrent = false
        await emitQueue()
        logger.info({ jobId, status }, 'queue stop-after-current: not advancing')
      }
      if (status === 'failed' && !opts.continueOnFailure) {
        logger.warn(
          { jobId, code, remaining: queueIds.length },
          'training failed — queue stopped (continueOnFailure=false)'
        )
      } else if (status === 'failed' && opts.continueOnFailure) {
        logger.warn(
          { jobId, code, remaining: queueIds.length },
          'training failed — advancing to next queued job'
        )
      }
      if (mayAdvance) {
        try {
          if (interJobDelayMs > 0) {
            logger.info(
              { jobId, delayMs: interJobDelayMs, remaining: queueIds.length },
              'waiting before next queue job (GPU cooldown)'
            )
            await sleep(interJobDelayMs)
          }
          // Re-check after cooldown — user may have started something else.
          if (!runningJobId) await startNext()
        } catch (err) {
          logger.warn({ err }, 'auto-advance failed')
        }
      }
      // Keep the wake lock across the inter-job cooldown when another job starts;
      // release only when the queue is idle again.
      if (!runningJobId) {
        onTrainingQueueIdle()
      }
    })()
  })

  child.on('error', (err) => {
    void (async () => {
      if (activeChild === child) activeChild = null
      if (runningJobId === jobId) runningJobId = null
      queueIds = queueIds.filter((id) => id !== jobId)
      const latest = await getJobRecord(jobId)
      // Don't clobber a terminal status already written by the exit handler.
      if (['complete', 'failed', 'cancelled', 'paused'].includes(latest.status)) {
        await emitQueue()
        if (!runningJobId) onTrainingQueueIdle()
        return
      }
      await patchJobRuntime(jobId, {
        status: 'failed',
        lastError: err.message,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        queueOrder: null
      })
      broadcast({ type: 'job-updated', payload: { jobId, status: 'failed' } })
      await emitQueue()
      if (!runningJobId) onTrainingQueueIdle()
    })()
  })
}

export async function pauseQueue(): Promise<QueueSnapshot> {
  await ensureHydrated()
  if (!runningJobId || !activeChild?.pid) {
    throw appError('not-found', 'No running job to pause')
  }
  const jobId = runningJobId
  userPaused = true
  const job = await getJobRecord(jobId)
  const order = ensureInQueueAt(jobId, job.queueOrder)
  await patchJobRuntime(jobId, {
    status: 'paused',
    queueOrder: order,
    updatedAt: new Date().toISOString()
  })
  await persistQueueOrders()
  await killProcessTree(activeChild.pid)
  // exit handler will finalize; mark paused already
  broadcast({ type: 'job-updated', payload: { jobId, status: 'paused', progress: job.progress } })
  return emitQueue()
}

export async function resumeQueue(): Promise<QueueSnapshot> {
  await ensureHydrated()
  userStopped = false
  userPaused = false
  // Keep stopAfterCurrent across pause/resume of the same job.
  // Resume paused job if any — keep its saved queue slot (do not jump to front).
  const jobs = await listJobs()
  const pausedSummary = jobs.find((j) => j.status === 'paused')
  if (pausedSummary) {
    try {
      const paused = await getJobRecord(pausedSummary.id)
      ensureInQueueAt(paused.id, paused.queueOrder)
    } catch {
      ensureInQueueAt(pausedSummary.id, 0)
    }
    await startNext()
    return emitQueue()
  }
  await startNext()
  return emitQueue()
}

export async function stopQueue(): Promise<QueueSnapshot> {
  await ensureHydrated()
  if (!runningJobId || !activeChild?.pid) {
    throw appError('not-found', 'No running job to stop')
  }
  userStopped = true
  stopAfterCurrent = false
  const jobId = runningJobId
  await killProcessTree(activeChild.pid)
  broadcast({ type: 'job-updated', payload: { jobId, status: 'cancelled' } })
  return emitQueue()
}

/**
 * Toggle: let the current training finish, then do not start the next queued job.
 * Remaining jobs stay in the FIFO. Can turn off while paused; only arm while running.
 */
export async function setStopAfterCurrent(enabled?: boolean): Promise<QueueSnapshot> {
  await ensureHydrated()
  const next = enabled ?? !stopAfterCurrent
  if (next && !runningJobId) {
    throw appError(
      'not-found',
      'Nothing is training — stop-after-current only applies while running',
      {
        remediation: 'Start a job first, or use Remove on queued jobs you do not want.'
      }
    )
  }
  stopAfterCurrent = next
  return emitQueue()
}

export async function retryJob(jobId: string): Promise<QueueSnapshot> {
  const job = await getJobRecord(jobId)
  if (job.status !== 'failed' && job.status !== 'cancelled') {
    throw appError('validation', 'Only failed or cancelled jobs can be retried')
  }
  return enqueue(jobId)
}

/**
 * Wipe the job's training output folder, reset progress, re-queue at head, and start.
 * If a job is running/paused, it is stopped first.
 */
export async function restartClear(jobId?: string): Promise<QueueSnapshot> {
  await ensureHydrated()
  const jobs = await listJobs()
  const id =
    jobId ??
    runningJobId ??
    jobs.find((j) => j.status === 'paused')?.id ??
    queueIds[0] ??
    jobs.find((j) => j.status === 'queued' || j.status === 'failed' || j.status === 'cancelled')
      ?.id

  if (!id) {
    throw appError('not-found', 'No job to restart', {
      remediation: 'Enqueue a job first.'
    })
  }

  if (runningJobId === id && activeChild?.pid) {
    userStopped = true
    const pid = activeChild.pid
    activeChild = null
    runningJobId = null
    await killProcessTree(pid)
    await new Promise((r) => setTimeout(r, 300))
  } else if (runningJobId === id) {
    runningJobId = null
    activeChild = null
  }

  const job = await getJobRecord(id)
  const dataset = await getDatasetRecord(job.datasetId)
  const outFolder = resolve(job.config.training_folder)
  const datasetFolder = resolve(dataset.folderPath)

  if (!outFolder || outFolder.toLowerCase() === datasetFolder.toLowerCase()) {
    throw appError('validation', 'Refusing to clear dataset folder as training output', {
      remediation: 'Check the job training_folder path.'
    })
  }
  const underDataset =
    outFolder.toLowerCase().startsWith(datasetFolder.toLowerCase() + '\\') ||
    outFolder.toLowerCase().startsWith(datasetFolder.toLowerCase() + '/')
  if (!underDataset && !/[/\\]output$/i.test(outFolder)) {
    throw appError(
      'validation',
      `Refusing to delete training folder outside dataset output: ${outFolder}`,
      { remediation: 'training_folder should be the dataset output folder.' }
    )
  }

  await rm(outFolder, { recursive: true, force: true })
  await mkdir(outFolder, { recursive: true })
  const totalSteps =
    typeof job.config.train.steps === 'number' ? job.config.train.steps : undefined
  const progress = createEmptyProgress(totalSteps)
  await patchJobRuntime(id, {
    status: 'queued',
    progress,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    queueOrder: 0,
    updatedAt: new Date().toISOString()
  })

  queueIds = [id, ...queueIds.filter((q) => q !== id)]
  userStopped = false
  broadcast({ type: 'job-updated', payload: { jobId: id, status: 'queued', progress } })
  await startNext()
  return emitQueue()
}
