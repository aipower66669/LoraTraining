import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'
import { nanoid } from 'nanoid'
import { JobRecordSchema, type JobRecord } from '@shared/schemas/job'
import {
  materialiseTrainingConfig,
  sanitizeJobName,
  TrainingConfigSchema,
  datasetOutputFolder,
  applyGlobalTrainingModel,
  type TrainingConfig
} from '@shared/schemas/training-config'
import {
  datasetFullyCaptioned,
  missingCaptionCount,
  type DatasetRecord
} from '@shared/schemas/dataset'
import type { JobDetail, JobStatus, JobSummary } from '@shared/ipc/contract'
import { resolveJobTotalSteps, statusAfterStepsCaughtUp } from '@shared/queue-eta'
import { appError } from '@shared/errors'
import { datasetHasOpenJob, isOpenJobStatus } from '@shared/dataset-jobs'
import { buildQueueIdsFromJobs } from '@shared/queue-hydrate'
import { suggestLoraName } from '@shared/lora-name'
import { atomicWriteJson, atomicWriteFile } from '../security/atomic-write'
import { jobsDir, ensureJobsDir, loadSettings, patchSettings, touchRecent } from '../settings/store'
import { getCategory } from '../categories/store'
import {
  getDatasetRecord,
  latestCheckpointStepForDataset,
  listDatasetOutputs,
  scanFolder
} from '../datasets/store'
import { mapWithConcurrency } from '../util/concurrency'
import { trainingConfigToYaml } from './yaml'

async function writeJobYamlFile(yamlPath: string, config: TrainingConfig): Promise<void> {
  const settings = await loadSettings()
  await atomicWriteFile(
    yamlPath,
    trainingConfigToYaml(applyGlobalTrainingModel(config, settings.defaultTrainingConfig.model))
  )
}
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

const JOB_READ_CONCURRENCY = 16

/** In-memory job records — avoids re-reading every job.json on Create/Enqueue. */
let recordsCache: JobRecord[] | null = null
let recordsLoadPromise: Promise<JobRecord[]> | null = null
/**
 * Writes that land while recordsCache is null (or during a cold load) — never
 * seed an incomplete cache list. Merged by newer updatedAt on every list.
 */
const writeOverlay = new Map<string, JobRecord>()

function jobDir(id: string): string {
  return join(jobsDir(), id)
}

function jobJsonPath(id: string): string {
  return join(jobDir(id), 'job.json')
}

function mergeNewerById(base: JobRecord[], newer: Iterable<JobRecord>): JobRecord[] {
  const byId = new Map(base.map((r) => [r.id, r]))
  for (const record of newer) {
    const existing = byId.get(record.id)
    if (!existing || record.updatedAt >= existing.updatedAt) {
      byId.set(record.id, record)
    }
  }
  return [...byId.values()]
}

function upsertRecordsCache(record: JobRecord): void {
  writeOverlay.set(record.id, record)
  if (!recordsCache) return
  const i = recordsCache.findIndex((r) => r.id === record.id)
  if (i >= 0) recordsCache[i] = record
  else recordsCache.push(record)
}

function removeFromRecordsCache(id: string): void {
  writeOverlay.delete(id)
  if (!recordsCache) return
  recordsCache = recordsCache.filter((r) => r.id !== id)
}

export function invalidateJobsCache(): void {
  recordsCache = null
  recordsLoadPromise = null
  writeOverlay.clear()
}

async function readJob(id: string): Promise<JobRecord> {
  await ensureJobsDir()
  try {
    const raw = await readFile(jobJsonPath(id), 'utf8')
    return JobRecordSchema.parse(JSON.parse(raw))
  } catch {
    throw appError('no-job', `Job not found: ${id}`)
  }
}

async function writeJob(record: JobRecord): Promise<JobRecord> {
  await ensureJobsDir()
  await mkdir(jobDir(record.id), { recursive: true })
  await mkdir(join(jobDir(record.id), 'logs'), { recursive: true })
  const parsed = JobRecordSchema.parse(record)
  await atomicWriteJson(jobJsonPath(parsed.id), parsed)
  upsertRecordsCache(parsed)
  return parsed
}

function toSummary(r: JobRecord, checkpointStep = 0): JobSummary {
  return {
    id: r.id,
    name: r.name,
    datasetId: r.datasetId,
    status: r.status,
    archived: r.archived,
    updatedAt: r.updatedAt,
    progress: r.progress,
    lastError: r.lastError,
    totalSteps: resolveJobTotalSteps({
      configSteps: r.config.train?.steps,
      progressTotalSteps: r.progress?.totalSteps,
      status: r.status
    }),
    checkpointStep: checkpointStep > 0 ? checkpointStep : 0,
    saveEvery: saveEveryFromConfig(r.config) ?? 250
  }
}

const IN_FLIGHT_PRIORITY: JobStatus[] = ['running', 'paused', 'queued', 'draft']

/**
 * Open (draft/queued/running/paused) job plan for a dataset — used for pending
 * Output rows and Validated demotion when further steps are planned.
 */
export async function getInFlightTrainingPlan(datasetId: string): Promise<{
  totalSteps: number
  saveEvery: number
  loraName: string
  status: JobStatus
  jobId: string
} | null> {
  const records = await listJobRecords()
  const hits = records.filter(
    (j) => j.datasetId === datasetId && !j.archived && isOpenJobStatus(j.status)
  )
  if (hits.length === 0) return null
  let best = hits[0]!
  let bestRank = IN_FLIGHT_PRIORITY.indexOf(best.status)
  for (let i = 1; i < hits.length; i++) {
    const c = hits[i]!
    const rank = IN_FLIGHT_PRIORITY.indexOf(c.status)
    if (rank >= 0 && (bestRank < 0 || rank < bestRank)) {
      best = c
      bestRank = rank
    }
  }
  const totalSteps =
    stepsFromConfig(best.config) ??
    resolveJobTotalSteps({
      configSteps: best.config.train?.steps,
      progressTotalSteps: best.progress?.totalSteps,
      status: best.status
    })
  if (!(totalSteps > 0)) return null
  return {
    totalSteps,
    saveEvery: saveEveryFromConfig(best.config) ?? 250,
    loraName: sanitizeJobName(best.config.name || best.name),
    status: best.status,
    jobId: best.id
  }
}

async function syncDatasetValidatedAfterJobChange(datasetId: string): Promise<void> {
  try {
    const { syncDatasetValidatedFlag } = await import('../datasets/store')
    await syncDatasetValidatedFlag(datasetId)
  } catch {
    /* ignore */
  }
}

function toDetail(r: JobRecord, checkpointStep = 0): JobDetail {
  return {
    ...toSummary(r, checkpointStep),
    config: r.config,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    yamlPath: r.yamlPath,
    queueOrder: r.queueOrder
  }
}

async function checkpointStepForRecord(
  r: JobRecord,
  cache?: Map<string, Promise<number>>
): Promise<number> {
  const load = (): Promise<number> =>
    latestCheckpointStepForDataset(r.datasetId).catch(() => 0)
  if (!cache) return load()
  let pending = cache.get(r.datasetId)
  if (!pending) {
    pending = load()
    cache.set(r.datasetId, pending)
  }
  return pending
}

export async function listJobs(): Promise<JobSummary[]> {
  const records = await listJobRecords()
  const stepCache = new Map<string, Promise<number>>()
  const promoted = await mapWithConcurrency(records, JOB_READ_CONCURRENCY, (r) =>
    promoteIfStepsCaughtUp(r, stepCache)
  )
  const summaries = await mapWithConcurrency(promoted, JOB_READ_CONCURRENCY, async (r) => {
    const checkpointStep = await checkpointStepForRecord(r, stepCache)
    return toSummary(r, checkpointStep)
  })
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Full job records (includes queueOrder) for queue hydrate / internal use. */
export async function listJobRecords(): Promise<JobRecord[]> {
  // Prefer an in-flight cold load over returning a partial view.
  if (recordsLoadPromise) return recordsLoadPromise
  if (recordsCache) return mergeNewerById(recordsCache, writeOverlay.values())

  recordsLoadPromise = (async () => {
    await ensureJobsDir()
    let dirs: Dirent[]
    try {
      dirs = await readdir(jobsDir(), { withFileTypes: true })
    } catch (err) {
      // Do NOT cache [] — a missing Z: / transient IO error would permanently
      // empty the queue + Jobs list until process restart.
      const { logger } = await import('../logging')
      logger.warn({ err }, 'listJobRecords: failed to read !Jobs directory')
      throw err
    }
    const names = dirs.filter((d) => d.isDirectory()).map((d) => d.name)
    const settled = await mapWithConcurrency(names, JOB_READ_CONCURRENCY, async (name) => {
      try {
        return await readJob(name)
      } catch {
        return null
      }
    })
    const list = settled.filter((r): r is JobRecord => r !== null)
    // Prefer writes that landed while this load was in flight (newer updatedAt).
    recordsCache = mergeNewerById(list, writeOverlay.values())
    return recordsCache
  })()

  try {
    return await recordsLoadPromise
  } catch (err) {
    recordsLoadPromise = null
    throw err
  } finally {
    recordsLoadPromise = null
  }
}

export async function getJob(id: string): Promise<JobDetail> {
  const r = await promoteIfStepsCaughtUp(await readJob(id))
  return toDetail(r, await checkpointStepForRecord(r))
}

export async function getJobRecord(id: string): Promise<JobRecord> {
  const overlay = writeOverlay.get(id)
  if (overlay) return promoteIfStepsCaughtUp(overlay)
  const cached = recordsCache?.find((r) => r.id === id)
  if (cached) return promoteIfStepsCaughtUp(cached)
  return promoteIfStepsCaughtUp(await readJob(id))
}

/**
 * Persist status when configured steps catch up to (or fall behind) the latest
 * on-disk checkpoint: draft/cancelled/failed → complete at N/N; complete → draft
 * when steps are raised past the checkpoint. Uses checkpoint filenames — not tqdm.
 */
async function promoteIfStepsCaughtUp(
  r: JobRecord,
  stepCache?: Map<string, Promise<number>>
): Promise<JobRecord> {
  const configSteps =
    typeof r.config.train?.steps === 'number'
      ? r.config.train.steps
      : Number(r.config.train?.steps)
  const checkpointStep = await checkpointStepForRecord(r, stepCache)
  const nextStatus = statusAfterStepsCaughtUp({
    status: r.status,
    currentStep: checkpointStep > 0 ? checkpointStep : null,
    configSteps
  })
  if (nextStatus === r.status) return r

  const now = new Date().toISOString()

  if (nextStatus === 'draft') {
    return writeJob({
      ...r,
      status: 'draft',
      finishedAt: null,
      updatedAt: now
    })
  }

  if (nextStatus !== 'complete') return r

  const progress =
    r.progress && typeof configSteps === 'number' && Number.isFinite(configSteps) && configSteps > 0
      ? {
          ...r.progress,
          currentStep: checkpointStep > 0 ? checkpointStep : r.progress.currentStep,
          totalSteps: Math.floor(configSteps)
        }
      : r.progress
        ? {
            ...r.progress,
            currentStep: checkpointStep > 0 ? checkpointStep : r.progress.currentStep
          }
        : checkpointStep > 0
          ? {
              currentStep: checkpointStep,
              totalSteps:
                typeof configSteps === 'number' && Number.isFinite(configSteps) && configSteps > 0
                  ? Math.floor(configSteps)
                  : undefined,
              elapsedMs: 0,
              pausedMs: 0,
              updatedAt: now
            }
          : r.progress
  const next = await writeJob({
    ...r,
    status: 'complete',
    progress,
    queueOrder: null,
    finishedAt: r.finishedAt ?? now,
    lastError: null,
    updatedAt: now
  })
  try {
    const { purgeDeletedJobFromQueue } = await import('../queue/engine')
    await purgeDeletedJobFromQueue(next.id)
  } catch {
    /* not queued */
  }
  try {
    const { markDatasetTrained } = await import('../datasets/store')
    await markDatasetTrained(next.datasetId)
  } catch {
    /* dataset may be gone */
  }
  return next
}

export async function saveJobRecord(record: JobRecord): Promise<JobRecord> {
  return writeJob(record)
}

/**
 * Runtime / queue updates (status, progress, queue slot, errors).
 * Always re-reads the on-disk record and **never** replaces `config` — only the
 * Jobs UI save path (`updateJob`) may rewrite user training settings.
 */
export async function patchJobRuntime(
  id: string,
  patch: Partial<
    Pick<
      JobRecord,
      | 'status'
      | 'progress'
      | 'lastError'
      | 'queueOrder'
      | 'startedAt'
      | 'finishedAt'
      | 'archived'
      | 'yamlPath'
      | 'updatedAt'
    >
  >
): Promise<JobRecord> {
  // Fresh disk read — do not use getJobRecord (may promote/write) or a stale cache copy.
  const current = await readJob(id)
  return writeJob({
    ...current,
    ...patch,
    id: current.id,
    name: current.name,
    datasetId: current.datasetId,
    config: current.config,
    createdAt: current.createdAt,
    updatedAt: patch.updatedAt ?? new Date().toISOString()
  })
}

function stepsFromConfig(config: TrainingConfig | undefined): number | null {
  const s = config?.train?.steps
  if (typeof s === 'number' && Number.isFinite(s) && s > 0) return Math.floor(s)
  if (typeof s === 'string') {
    const n = Number(s)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return null
}

function saveEveryFromConfig(config: TrainingConfig | undefined): number | null {
  const s = config?.save?.save_every
  if (typeof s === 'number' && Number.isFinite(s) && s > 0) return Math.floor(s)
  return null
}

/** Last job in the live queue (same preference as Steps / Save Every on create). */
function lastQueuedJob(records: JobRecord[]): JobRecord | undefined {
  const queueIds = buildQueueIdsFromJobs(records)
  if (queueIds.length === 0) return undefined
  const lastId = queueIds[queueIds.length - 1]!
  return records.find((r) => r.id === lastId)
}

/** Prefer steps from the last job in the live queue; else settings / 2000. */
function resolveCreateJobSteps(records: JobRecord[], settingsFallback: number): number {
  return stepsFromConfig(lastQueuedJob(records)?.config) ?? settingsFallback
}

/** Prefer save_every from the last job in the live queue; else settings / 250. */
function resolveCreateJobSaveEvery(records: JobRecord[], settingsFallback: number): number {
  return saveEveryFromConfig(lastQueuedJob(records)?.config) ?? settingsFallback
}

/** Steps / Save every that `createJob` would apply (for UI tooltips). */
export async function getCreateJobDefaults(): Promise<{ steps: number; saveEvery: number }> {
  const [settings, records] = await Promise.all([loadSettings(), listJobRecords()])
  const settingsSteps = stepsFromConfig(settings.defaultTrainingConfig) ?? 2000
  const settingsSaveEvery = saveEveryFromConfig(settings.defaultTrainingConfig) ?? 250
  return {
    steps: resolveCreateJobSteps(records, settingsSteps),
    saveEvery: resolveCreateJobSaveEvery(records, settingsSaveEvery)
  }
}

/** Existing output stem if present, else Category_Dataset (main is source of truth on create). */
async function suggestedLoraNameForDataset(dataset: DatasetRecord): Promise<string> {
  const [category, outputs] = await Promise.all([
    dataset.categoryId
      ? getCategory(dataset.categoryId).catch(() => null)
      : Promise.resolve(null),
    listDatasetOutputs(dataset.id)
  ])
  return suggestLoraName({
    categoryName: category?.name ?? '',
    datasetName: dataset.name,
    checkpointFileNames: outputs.checkpoints.map((c) => c.fileName)
  })
}

export async function createJob(input: {
  name: string
  datasetId: string
}): Promise<JobDetail> {
  // Parallelize the three independent lookups — previously this path did
  // getDatasetRecord, then listJobs (all job.json files), then listJobRecords
  // AGAIN for steps, then writeYamlForJob which re-read the job + dataset and
  // rewrote job.json. That stack was multi-second with a large !Jobs folder.
  const [dataset, settings, records] = await Promise.all([
    getDatasetRecord(input.datasetId),
    loadSettings(),
    listJobRecords()
  ])
  try {
    await access(dataset.folderPath, constants.F_OK)
  } catch {
    throw appError('folder-missing', `Dataset folder missing: ${dataset.folderPath}`, {
      remediation: 'Fix the dataset folder path or rescan after restoring files.'
    })
  }

  if (datasetHasOpenJob(records, input.datasetId)) {
    throw appError(
      'validation',
      'This dataset already has a job',
      {
        remediation: 'Open that job, or archive it before creating another.'
      }
    )
  }

  if (!dataset.ready) {
    throw appError('validation', 'Dataset is not marked Ready', {
      remediation:
        'Tick Ready on the dataset after you have checked captions and images, then create the job.'
    })
  }

  // Live scan — sidecar stats can lag behind caption writes until rescan/open.
  const scanned = await scanFolder(dataset.folderPath, dataset.captionExt).catch(() => null)
  const liveStats = scanned?.stats ?? dataset.stats
  if (!datasetFullyCaptioned(liveStats)) {
    const missing = missingCaptionCount(liveStats)
    throw appError(
      'validation',
      missing > 0
        ? `Cannot create a job: ${missing} image${missing === 1 ? '' : 's'} still missing captions`
        : 'Cannot create a job: dataset has no images',
      {
        remediation: 'Caption every image (JoyCaption or manually), then create the job.'
      }
    )
  }

  const settingsSteps = stepsFromConfig(settings.defaultTrainingConfig) ?? 2000
  const steps = resolveCreateJobSteps(records, settingsSteps)
  const settingsSaveEvery = saveEveryFromConfig(settings.defaultTrainingConfig) ?? 250
  const saveEvery = resolveCreateJobSaveEvery(records, settingsSaveEvery)
  const now = new Date().toISOString()
  const id = nanoid()
  // LoRA stem: existing output checkpoint stem, else Category_Dataset.
  const name = await suggestedLoraNameForDataset(dataset)
  const config = materialiseTrainingConfig(settings.defaultTrainingConfig, {
    jobName: name,
    folderPath: dataset.folderPath,
    trigger: dataset.trigger,
    steps,
    saveEvery
  })
  const yamlPath = join(jobDir(id), 'config.yaml')
  const record = await writeJob(
    JobRecordSchema.parse({
      id,
      name,
      datasetId: input.datasetId,
      status: 'draft',
      config,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      yamlPath,
      progress: null,
      lastError: null,
      queueOrder: null
    })
  )
  // Write YAML only — do not re-read job/dataset or rewrite job.json.
  await writeJobYamlFile(yamlPath, record.config)
  // Recents are not on the critical path for opening the Jobs screen.
  void patchSettings({ recentJobIds: touchRecent(settings.recentJobIds, id) }).catch(() => undefined)
  // Further-training plan can demote Validated immediately.
  await syncDatasetValidatedAfterJobChange(input.datasetId)
  return toDetail(record)
}

export async function updateJob(input: {
  id: string
  name?: string
  datasetId?: string
  config?: unknown
  archived?: boolean
}): Promise<JobDetail> {
  const r = await readJob(input.id)
  let datasetId = r.datasetId
  let datasetChanged = false
  if (input.datasetId !== undefined && input.datasetId !== r.datasetId) {
    await getDatasetRecord(input.datasetId)
    const others = (await listJobRecords()).filter((j) => j.id !== input.id)
    if (datasetHasOpenJob(others, input.datasetId)) {
      throw appError(
        'validation',
        'That dataset already has a job',
        {
          remediation: 'Pick another Ready dataset, or archive the other job first.'
        }
      )
    }
    datasetId = input.datasetId
    datasetChanged = true
  }
  const config = input.config
    ? TrainingConfigSchema.parse(input.config)
    : structuredClone(r.config)
  const dataset = await getDatasetRecord(datasetId)
  config.training_folder = datasetOutputFolder(dataset.folderPath)
  if (config.datasets[0]) {
    config.datasets[0].folder_path = dataset.folderPath
  }
  // Preserve editable LoRA name. On dataset-only updates (no config payload),
  // re-suggest from the new folder; when config is sent (Jobs UI), keep it.
  if (datasetChanged && input.config === undefined) {
    config.name = await suggestedLoraNameForDataset(dataset)
  } else {
    config.name = sanitizeJobName(config.name)
  }
  const name = config.name
  const yamlPath = join(jobDir(r.id), 'config.yaml')

  const configSteps =
    typeof config.train.steps === 'number' ? config.train.steps : Number(config.train.steps)
  const checkpointStep = await checkpointStepForRecord({ ...r, config })
  let progress = r.progress
  if (typeof configSteps === 'number' && Number.isFinite(configSteps) && configSteps > 0) {
    if (progress) {
      progress = {
        ...progress,
        totalSteps: Math.floor(configSteps),
        ...(checkpointStep > 0 ? { currentStep: checkpointStep } : {})
      }
    } else if (checkpointStep > 0) {
      progress = {
        currentStep: checkpointStep,
        totalSteps: Math.floor(configSteps),
        elapsedMs: 0,
        pausedMs: 0,
        updatedAt: new Date().toISOString()
      }
    }
  }
  const prevStatus = r.status
  const status = statusAfterStepsCaughtUp({
    status: r.status,
    currentStep: checkpointStep > 0 ? checkpointStep : null,
    configSteps
  }) as typeof r.status
  const now = new Date().toISOString()
  const promotedComplete = status === 'complete' && prevStatus !== 'complete'
  const demotedFromComplete = prevStatus === 'complete' && status === 'draft'

  const next = await writeJob({
    ...r,
    name,
    datasetId,
    config,
    status,
    progress,
    archived: input.archived ?? r.archived,
    yamlPath,
    queueOrder: promotedComplete ? null : r.queueOrder,
    finishedAt: demotedFromComplete
      ? null
      : promotedComplete
        ? (r.finishedAt ?? now)
        : r.finishedAt,
    lastError: promotedComplete ? null : r.lastError,
    updatedAt: now
  })
  // YAML only — do not re-read/rewrite job.json (old writeYamlForJob did that).
  await writeJobYamlFile(yamlPath, next.config)
  if (promotedComplete) {
    try {
      const { purgeDeletedJobFromQueue } = await import('../queue/engine')
      await purgeDeletedJobFromQueue(next.id)
    } catch {
      /* not queued / queue busy — status already complete on disk */
    }
  }
  await syncDatasetValidatedAfterJobChange(datasetId)
  if (datasetChanged && r.datasetId !== datasetId) {
    await syncDatasetValidatedAfterJobChange(r.datasetId)
  }
  return toDetail(next, checkpointStep)
}

export async function duplicateJob(id: string): Promise<JobDetail> {
  const r = await readJob(id)
  const records = await listJobRecords()
  if (datasetHasOpenJob(records, r.datasetId)) {
    throw appError(
      'validation',
      'This dataset already has a job',
      {
        remediation: 'Archive the existing job before duplicating, or open that job instead.'
      }
    )
  }
  await getDatasetRecord(r.datasetId)
  const now = new Date().toISOString()
  const newId = nanoid()
  const yamlPath = join(jobDir(newId), 'config.yaml')
  const config = structuredClone(r.config) as TrainingConfig
  // Keep the cloned stem so resume stays compatible with existing checkpoints.
  config.name = sanitizeJobName(config.name)
  const name = config.name
  const record = await writeJob(
    JobRecordSchema.parse({
      ...r,
      id: newId,
      name,
      status: 'draft',
      archived: false,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      yamlPath,
      progress: null,
      lastError: null,
      queueOrder: null,
      config
    })
  )
  await writeJobYamlFile(yamlPath, record.config)
  await syncDatasetValidatedAfterJobChange(record.datasetId)
  return toDetail(record)
}

export async function removeJob(id: string): Promise<{ deleted: true }> {
  const { purgeDeletedJobFromQueue } = await import('../queue/engine')
  await purgeDeletedJobFromQueue(id)
  const r = await readJob(id)
  await rm(jobDir(id), { recursive: true, force: true })
  removeFromRecordsCache(id)
  // Clearing the further-training plan may restore Validated.
  await syncDatasetValidatedAfterJobChange(r.datasetId)
  return { deleted: true }
}

export async function writeYamlForJob(id: string): Promise<{ yamlPath: string }> {
  const r = await readJob(id)
  const dataset = await getDatasetRecord(r.datasetId)
  const config = structuredClone(r.config) as TrainingConfig
  config.training_folder = datasetOutputFolder(dataset.folderPath)
  if (config.datasets[0]) {
    config.datasets[0].folder_path = dataset.folderPath
  }
  const yamlPath = join(jobDir(id), 'config.yaml')
  await writeJobYamlFile(yamlPath, config)
  // Persist path/folder sync without a second full rewrite cycle when unchanged.
  if (
    r.yamlPath !== yamlPath ||
    r.config.training_folder !== config.training_folder ||
    r.config.datasets[0]?.folder_path !== config.datasets[0]?.folder_path
  ) {
    await writeJob({
      ...r,
      config,
      yamlPath,
      updatedAt: new Date().toISOString()
    })
  }
  return { yamlPath }
}

export async function exportYamlText(id: string): Promise<{ yaml: string }> {
  const r = await readJob(id)
  const settings = await loadSettings()
  return {
    yaml: trainingConfigToYaml(
      applyGlobalTrainingModel(r.config, settings.defaultTrainingConfig.model)
    )
  }
}
