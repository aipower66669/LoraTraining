import { access, cp, mkdir, readdir, rename, rm, stat, readFile, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import {
  IMAGE_EXTENSIONS,
  DatasetRecordSchema,
  sanitizeDatasetFolderName,
  imageStem,
  type DatasetRecord
} from '@shared/schemas/dataset'
import { DATASET_SIDECAR } from '@shared/library-paths'
import { shouldCopyPathOnDatasetDuplicate } from '@shared/dataset-duplicate-copy'
import { originalSiblingFileName } from '@shared/upscale-filename'
import { defaultValidationSetConfig, isValidationSetDirName } from '@shared/validation-sets'
import { isStressTestSetDirName } from '@shared/stress-sets'
import { isWeightSetDirName } from '@shared/weight-sets'
import {
  datasetLifecycleStatus,
  type CheckpointEntry,
  type DatasetDetail,
  type DatasetOutputs,
  type DatasetSummary,
  type ImageEntry
} from '@shared/ipc/contract'
import { compareCheckpointsByStep, latestCheckpointStepFromNames } from '@shared/checkpoints'
import {
  buildPendingCheckpointEntries,
  loadInFlightTrainingPlan
} from './pendingTraining'
import {
  defaultLoraName,
  existingLoraStemFromCheckpointNames
} from '@shared/lora-name'
import { averageCheckpointRating } from '@shared/validation-ratings'
import { appError } from '@shared/errors'
import { assertInsideRoot } from '../security/path-guards'
import { mapWithConcurrency } from '../util/concurrency'
import { broadcast } from '../events/bus'
import { loadSettings, patchSettings, touchRecent } from '../settings/store'
import {
  getRegisteredFolder,
  registerDatasetFolder,
  unregisterDatasetFolder
} from '../media/protocol'
import { loadValidationRatings, setValidationRatingForFolder } from './validationRatings'
import { loadCheckpointPrefs, isKeepInComfy } from './checkpointPrefs'
import { assertAbsolutePath } from '../security/path-guards'
import { remapJobsDatasetFolder } from '../jobs/remapDatasetFolder'
import {
  ensureCategoryExists,
  invalidateCategoryCache,
  listCategories,
  removeCategory as deleteCategoryRecord
} from '../categories/store'
import {
  findDatasetRecordById,
  listAllDatasetRecordsFromLibrary,
  readDatasetSidecar,
  writeDatasetSidecar
} from '../library/datasetSidecar'
import { datasetSidecarPath } from '@shared/library-paths'

function isNoDatasetError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'no-dataset'
  )
}

function defaultOutputFolder(folderPath: string): string {
  return join(folderPath.replace(/[/\\]+$/, ''), 'output')
}

/**
 * Backfill/normalize an already-fetched record in place (categoryId,
 * validationSets defaults), writing back only if something changed. Split out
 * from `readRecord` so callers that already have a fresh record in hand (e.g.
 * `listDatasets` iterating a `listAllDatasetRecordsFromLibrary()` result) can
 * migrate it directly instead of paying for another full-library lookup.
 */
async function migrateRecord(found: DatasetRecord): Promise<DatasetRecord> {
  let dirty = false
  const parsed: Record<string, unknown> = { ...found }
  if (!parsed.categoryId || typeof parsed.categoryId !== 'string') {
    parsed.categoryId = ''
    dirty = true
  }
  if (!Array.isArray(parsed.validationSets) || parsed.validationSets.length === 0) {
    const settings = await loadSettings()
    const prompt = settings.lastValidationPrompt.trim()
    parsed.validationSets = [defaultValidationSetConfig(prompt ? { prompt } : {})]
    dirty = true
  }
  const migrated = DatasetRecordSchema.parse(parsed)
  if (dirty) {
    await writeDatasetSidecar(migrated.folderPath, migrated)
  }
  return migrated
}

async function readRecord(id: string): Promise<DatasetRecord> {
  // Hot path: after list/get has registered the folder, resolve via one sidecar
  // read instead of walking every dataset.json in the library (painful on SMB).
  const cachedFolder = getRegisteredFolder(id)
  if (cachedFolder) {
    try {
      const found = await readDatasetSidecar(cachedFolder)
      if (found.id === id) {
        return migrateRecord(found)
      }
      // Stale registration (folder reused / id mismatch) — drop and fall through.
      unregisterDatasetFolder(id)
    } catch {
      unregisterDatasetFolder(id)
    }
  }

  const found = await findDatasetRecordById(id)
  if (!found) {
    throw appError('no-dataset', `Dataset not found: ${id}`, {
      remediation: 'Re-add the dataset from the Datasets screen.'
    })
  }
  registerDatasetFolder(found.id, found.folderPath)
  return migrateRecord(found)
}

/** Last successful detail scan per dataset — used to skip full folder rescans on meta-only updates. */
const detailCache = new Map<string, DatasetDetail>()
/** Last known image-set fingerprint for folder-watch change detection. */
const lastImageFingerprint = new Map<string, string>()

function imageListFingerprint(images: ImageEntry[]): string {
  return [...images]
    .map(
      (i) =>
        `${i.fileName}\0${i.mtimeMs}\0${i.sizeBytes}\0${i.hasOriginal ? 1 : 0}\0${i.versionCount}\0${i.hasSpawned ? 1 : 0}\0${i.captionExists ? 1 : 0}`
    )
    .sort()
    .join('\n')
}

function cacheDetail(detail: DatasetDetail): DatasetDetail {
  detailCache.set(detail.id, detail)
  lastImageFingerprint.set(detail.id, imageListFingerprint(detail.images))
  return detail
}

function invalidateDetailCache(id: string): void {
  detailCache.delete(id)
}

async function persistRecord(record: DatasetRecord): Promise<void> {
  await writeDatasetSidecar(record.folderPath, record)
}

/** Bounded so scanning folders with thousands of images doesn't open that many fds at once. */
const SCAN_CONCURRENCY = 8

/** Apply `dataset.json` → `spawnedFromImages` onto scanned image entries. */
function applySpawnedFlags(
  images: ImageEntry[],
  spawnedFromImages: string[] | undefined
): ImageEntry[] {
  if (!spawnedFromImages?.length) {
    return images.map((img) => (img.hasSpawned ? { ...img, hasSpawned: false } : img))
  }
  const set = new Set(spawnedFromImages.map((f) => f.toLowerCase()))
  return images.map((img) => {
    const hasSpawned = set.has(img.fileName.toLowerCase())
    return img.hasSpawned === hasSpawned ? img : { ...img, hasSpawned }
  })
}

/**
 * Scan dataset folder images + caption presence.
 * `hasSpawned` is always false here — callers apply `spawnedFromImages` from the record.
 */
export async function scanFolder(
  folderPath: string,
  captionExt = 'txt'
): Promise<{ images: ImageEntry[]; stats: DatasetRecord['stats'] }> {
  const entries = await readdir(folderPath)
  const candidates = entries.filter((fileName) => IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase()))
  // Answer "does {stem}.{captionExt} exist?" from the single directory listing.
  // Version history is NTFS ADS (`VER_COUNT`) — probed per image (cheap streamExists).
  const entryByLower = new Map(entries.map((e) => [e.toLowerCase(), e]))

  const { readVerCount } = await import('../images/imageEdit')

  const scanned = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, async (fileName) => {
    const full = join(folderPath, fileName)
    const st = await stat(full)
    if (!st.isFile()) return null
    // Must use the real extension suffix. Lowercasing before basename breaks
    // stems for `.JPG`/`.PNG` and looks for `photo.JPG.txt` instead of `photo.txt`.
    const stem = imageStem(fileName)
    const captionOnDisk = entryByLower.get(`${stem}.${captionExt}`.toLowerCase())
    let captionExists = false
    let captionPreview: string | undefined
    if (captionOnDisk) {
      try {
        const text = await readFile(join(folderPath, captionOnDisk), 'utf8')
        captionExists = true
        captionPreview = text.slice(0, 120)
      } catch {
        captionExists = false
      }
    }
    const versionCount = await readVerCount(full)
    const entry: ImageEntry = {
      fileName,
      stem,
      captionExists,
      captionPreview,
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
      hasOriginal: versionCount >= 1,
      versionCount,
      hasSpawned: false
    }
    return entry
  })

  const images: ImageEntry[] = []
  const stems = new Map<string, string[]>()
  for (const entry of scanned) {
    if (!entry) continue
    images.push(entry)
    const list = stems.get(entry.stem) ?? []
    list.push(entry.fileName)
    stems.set(entry.stem, list)
  }

  images.sort((a, b) => a.fileName.localeCompare(b.fileName))
  const stemCollisions = [...stems.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([stem]) => stem)

  // Per-image caption coverage (not unique stems). Shared .txt for stem collisions
  // still means each colliding image is captioned.
  const captions = images.filter((i) => i.captionExists).length

  return {
    images,
    stats: {
      images: images.length,
      captions,
      stemCollisions
    }
  }
}

/** Walk output dir for checkpoints and Set-folder validation images. */
async function scanOutputFlags(
  root: string
): Promise<{ trained: boolean; hasValidationImages: boolean }> {
  let hasValidationImages = false

  // Set folders are direct children of output/ — check them before listing LoRAs.
  let rootEntries: string[]
  try {
    rootEntries = await readdir(root)
  } catch {
    return { trained: false, hasValidationImages: false }
  }
  for (const name of rootEntries) {
    if (!isValidationSetDirName(name)) continue
    if (await dirHasImage(join(root, name))) {
      hasValidationImages = true
      break
    }
  }

  const { listCheckpointSafetensorsShallow } = await import('./listCheckpoints')
  const hits = await listCheckpointSafetensorsShallow(root)
  return { trained: hits.length > 0, hasValidationImages }
}

async function dirHasImage(root: string): Promise<boolean> {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!st.isFile()) continue
      const ext = extname(name).toLowerCase()
      if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') return true
    }
  }
  return false
}

async function findSetPreviews(
  outputRoot: string,
  stem: string
): Promise<Array<{ setLabel: string; relativePath: string }>> {
  let entries: string[]
  try {
    entries = await readdir(outputRoot)
  } catch {
    return []
  }
  const setDirs = entries
    .filter(isValidationSetDirName)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const found: Array<{ setLabel: string; relativePath: string }> = []
  for (const setName of setDirs) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const candidate = join(outputRoot, setName, stem + ext)
      try {
        const st = await stat(candidate)
        if (st.isFile()) {
          found.push({
            setLabel: setName,
            relativePath: relative(outputRoot, candidate).replace(/\\/g, '/')
          })
          break
        }
      } catch {
        /* continue */
      }
    }
  }
  return found
}

/**
 * Prefer cached Set preview paths from checkpoint-prefs; only re-probe Set folders
 * when the cache is missing, incomplete (new Set), or a file was deleted/moved.
 */
async function resolveSetPreviewsCached(
  outputRoot: string,
  stem: string,
  prefs: import('@shared/checkpoint-prefs').CheckpointPrefsFile
): Promise<{
  images: Array<{ setLabel: string; relativePath: string }>
  changed: boolean
}> {
  let setDirs: string[] = []
  try {
    setDirs = (await readdir(outputRoot))
      .filter(isValidationSetDirName)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  } catch {
    setDirs = []
  }

  const cached = prefs.validationPreviews?.[stem]
  if (cached && typeof cached === 'object') {
    const found: Array<{ setLabel: string; relativePath: string }> = []
    let ok = true
    for (const setName of setDirs) {
      const rel = cached[setName]?.replace(/\\/g, '/')
      if (!rel) {
        ok = false
        break
      }
      try {
        const st = await stat(join(outputRoot, rel))
        if (!st.isFile()) {
          ok = false
          break
        }
        found.push({ setLabel: setName, relativePath: rel })
      } catch {
        ok = false
        break
      }
    }
    // Cache may list Sets that were removed — still OK if every current Set hits.
    if (ok && (setDirs.length === 0 || found.length === setDirs.length)) {
      return { images: found, changed: false }
    }
  }

  const images = await findSetPreviews(outputRoot, stem)
  const next: Record<string, string> = {}
  for (const img of images) next[img.setLabel] = img.relativePath
  const prev = prefs.validationPreviews?.[stem] ?? {}
  const same =
    Object.keys(next).length === Object.keys(prev).length &&
    Object.keys(next).every((k) => prev[k] === next[k])
  if (!same) {
    if (!prefs.validationPreviews) prefs.validationPreviews = {}
    if (Object.keys(next).length === 0) delete prefs.validationPreviews[stem]
    else prefs.validationPreviews[stem] = next
    return { images, changed: true }
  }
  return { images, changed: false }
}

/** Avoid hanging the library list on slow / offline network volumes. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function collectCheckpoints(root: string): Promise<CheckpointEntry[]> {
  const { listCheckpointSafetensorsShallow } = await import('./listCheckpoints')
  const { mutateCheckpointPrefs } = await import('./checkpointPrefs')
  const files = await listCheckpointSafetensorsShallow(root)
  // `root` is `{dataset}/output` — prefs live beside checkpoints under dataset/output/.
  const datasetFolder = dirname(root)
  const prefs = await loadCheckpointPrefs(datasetFolder)
  let dirty = false
  const out: CheckpointEntry[] = []
  for (const hit of files) {
    const stem = basename(hit.fileName, extname(hit.fileName))
    const { images: validationImages, changed } = await resolveSetPreviewsCached(
      root,
      stem,
      prefs
    )
    if (changed) dirty = true
    out.push({
      fileName: hit.fileName,
      relativePath: hit.relativePath,
      sizeBytes: hit.sizeBytes,
      mtimeMs: hit.mtimeMs,
      validationImageRelativePath: validationImages[0]?.relativePath ?? null,
      validationImages,
      averageRating: null,
      ratingCount: 0,
      // Placeholder — listDatasetOutputs overwrites from a fresh prefs load after reconcile.
      keepInComfy: isKeepInComfy(prefs, stem),
      comfyRelativeDir: null
    })
  }
  if (dirty) {
    // Merge preview cache onto a fresh load so concurrent keepInComfy toggles survive
    // (e.g. untick → add validation set → listOutputs rewrites validationPreviews).
    const previewSnap = prefs.validationPreviews
    await mutateCheckpointPrefs(datasetFolder, (latest) => {
      latest.validationPreviews = previewSnap
    })
  }
  out.sort(compareCheckpointsByStep)
  return out
}

async function toSummary(
  r: DatasetRecord,
  coverFileName?: string | null,
  flags?: { trained: boolean; hasValidationImages: boolean }
): Promise<DatasetSummary> {
  const scannedOrTimeout =
    flags ??
    (await withTimeout(
      scanOutputFlags(defaultOutputFolder(r.folderPath)),
      2500,
      null as { trained: boolean; hasValidationImages: boolean } | null
    ))
  // Sticky sidecar `trained` only survives timed-out output scans (network shares).
  // A completed scan that finds no checkpoints clears false sticky Trained
  // (e.g. vacuous Validated sync from older builds).
  const isTrained = scannedOrTimeout == null ? r.trained : scannedOrTimeout.trained
  // Completeness-based `validated`: retest on every library list when currently true
  // so badges demote without opening each dataset. Further-training plans also demote.
  let isValidated = r.validated
  if (r.validated) {
    const setCount = Math.max(1, r.validationSets?.length ?? 0)
    try {
      const { areValidationSetsComplete } = await import('../comfy/nextValidationLora')
      const complete = await withTimeout(
        areValidationSetsComplete(r.folderPath, setCount),
        5000,
        null as boolean | null
      )
      if (complete === false) {
        isValidated = false
      }
      // Timeout (null): keep sidecar value — avoid mass demotion on slow shares.
    } catch {
      /* keep sidecar validated */
    }
    if (isValidated) {
      try {
        const plan = await withTimeout(loadInFlightTrainingPlan(r.id), 2000, null)
        if (plan) {
          const latest = await withTimeout(latestCheckpointStepForDataset(r.id), 2000, 0)
          if (plan.totalSteps > (latest ?? 0)) isValidated = false
        }
      } catch {
        /* keep sidecar validated */
      }
    }
  }
  // Validated implies trained; never show Validated without Trained.
  const trainedOut = isValidated ? true : isTrained
  // Done is sticky only while still Validated — demote clears it.
  const isDone = isValidated ? Boolean(r.done) : false

  if (r.trained !== trainedOut || r.validated !== isValidated || r.done !== isDone) {
    const next = {
      ...r,
      trained: trainedOut,
      validated: isValidated,
      done: isDone,
      updatedAt: new Date().toISOString()
    }
    await persistRecord(next).catch(() => undefined)
  }
  return {
    id: r.id,
    name: r.name,
    folderPath: r.folderPath,
    categoryId: r.categoryId,
    trigger: r.trigger,
    stats: r.stats,
    updatedAt: r.updatedAt,
    coverFileName: coverFileName ?? null,
    ready: r.ready,
    validated: isValidated,
    trained: trainedOut,
    done: isDone,
    status: datasetLifecycleStatus({
      ready: r.ready,
      trained: trainedOut,
      validated: isValidated,
      done: isDone
    })
  }
}

/** First image filename (alphabetical) without a full caption scan — library cover fallback. */
async function firstImageName(r: DatasetRecord): Promise<string | null> {
  try {
    const entries = await withTimeout(readdir(r.folderPath), 2000, [] as string[])
    const images = entries
      .filter((fileName) => IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
    return images[0] ?? null
  } catch {
    return null
  }
}

async function resolveCoverFileName(r: DatasetRecord): Promise<string | null> {
  if (r.coverFileName) {
    try {
      const full = assertInsideRoot(r.folderPath, join(r.folderPath, basename(r.coverFileName)))
      await access(full, constants.F_OK)
      return basename(r.coverFileName)
    } catch {
      /* missing or invalid — fall through */
    }
  }
  return firstImageName(r)
}

async function toDetail(r: DatasetRecord): Promise<DatasetDetail> {
  const scanned = await scanFolder(r.folderPath, r.captionExt).catch(() => ({
    images: [] as ImageEntry[],
    stats: r.stats
  }))
  const images = applySpawnedFlags(scanned.images, r.spawnedFromImages)
  const { stats } = scanned
  const cover =
    r.coverFileName && images.some((img) => img.fileName === r.coverFileName)
      ? r.coverFileName
      : (images[0]?.fileName ?? null)

  // Keep sidecar stats in sync with the live folder scan (caption writes used to
  // leave dataset.json.stats stale, which greys Create Job incorrectly).
  const statsChanged =
    stats.images !== r.stats.images ||
    stats.captions !== r.stats.captions ||
    JSON.stringify(stats.stemCollisions ?? []) !== JSON.stringify(r.stats.stemCollisions ?? [])
  let record = r
  if (statsChanged) {
    record = {
      ...r,
      stats,
      updatedAt: new Date().toISOString()
    }
    await persistRecord(record).catch(() => undefined)
  }

  return cacheDetail({
    ...(await toSummary(record, cover)),
    captionExt: record.captionExt,
    notes: record.notes,
    captionGuidance: record.captionGuidance ?? '',
    createdAt: record.createdAt,
    images
  })
}

function stickySummary(r: DatasetRecord): DatasetSummary {
  // Mirror toSummary sticky rules without disk walks so explorer tabs populate ASAP.
  const isValidated = Boolean(r.validated)
  const trainedOut = isValidated ? true : Boolean(r.trained)
  const isDone = isValidated ? Boolean(r.done) : false
  return {
    id: r.id,
    name: r.name,
    folderPath: r.folderPath,
    categoryId: r.categoryId,
    trigger: r.trigger,
    stats: r.stats,
    updatedAt: r.updatedAt,
    coverFileName: r.coverFileName ?? null,
    ready: r.ready,
    validated: isValidated,
    trained: trainedOut,
    done: isDone,
    status: datasetLifecycleStatus({
      ready: r.ready,
      trained: trainedOut,
      validated: isValidated,
      done: isDone
    })
  }
}

export type ListDatasetsOptions = {
  /** Explorer status tab — enrich matching datasets first; Done last unless focused. */
  prioritize?: import('@shared/explorer-status').DatasetStatusFilter
  /** Renderer refresh epoch; partial events with a different token are ignored. */
  listToken?: number
  /**
   * Return sidecar tiles immediately and walk output badges after the IPC
   * handler returns. The explorer paints before the badge pass.
   */
  deferBadges?: boolean
}

const LIST_ENRICH_CONCURRENCY = 6
/** Newer library refresh cancels an in-flight badge walk. */
let badgeEnrichGen = 0

type PreparedDataset = { record: DatasetRecord; sticky: DatasetSummary }

export async function listDatasets(opts?: ListDatasetsOptions): Promise<DatasetSummary[]> {
  const prioritize = opts?.prioritize ?? 'all'
  const listToken = opts?.listToken ?? 0

  const emitLoadProgress = (
    progress: import('@shared/library-load-progress').LibraryLoadProgress
  ): void => {
    broadcast({
      type: 'library-load-progress',
      payload: { listToken, ...progress }
    })
  }

  invalidateCategoryCache()
  await listCategories()
  const { syncCategoryFolderDatasets, watchCategoryFolders } = await import('./categorySync')
  emitLoadProgress({
    phase: 'sync',
    done: 0,
    total: 0,
    message: 'Discovering datasets…'
  })
  await syncCategoryFolderDatasets(undefined, emitLoadProgress, { quiet: true }).catch(
    () => undefined
  )
  void watchCategoryFolders()

  emitLoadProgress({
    phase: 'read',
    done: 0,
    total: 0,
    message: 'Reading dataset sidecars…'
  })
  const records = await listAllDatasetRecordsFromLibrary()

  const queuedIds = new Set<string>()
  try {
    const { listJobRecords } = await import('../jobs/store')
    const { isQueuedJobStatus } = await import('@shared/dataset-jobs')
    const jobs = await listJobRecords()
    for (const j of jobs) {
      if (!j.archived && isQueuedJobStatus(j.status)) queuedIds.add(j.datasetId)
    }
  } catch {
    /* queue hint optional for priority */
  }

  const { compareDatasetsForListPriority } = await import('@shared/explorer-status')

  const prepared: PreparedDataset[] = []
  for (const r0 of records) {
    try {
      const r = await migrateRecord(r0)
      let record = r
      const category = await ensureCategoryExists(r.categoryId)
      if (category && r.categoryId !== category.id) {
        record = { ...r, categoryId: category.id, updatedAt: new Date().toISOString() }
        await persistRecord(record)
      }
      registerDatasetFolder(record.id, record.folderPath)
      prepared.push({ record, sticky: stickySummary(record) })
    } catch {
      /* skip broken sidecars */
    }
  }

  prepared.sort((a, b) =>
    compareDatasetsForListPriority(
      a.sticky,
      b.sticky,
      prioritize,
      queuedIds.has(a.sticky.id),
      queuedIds.has(b.sticky.id)
    )
  )

  const sticky = prepared.map((p) => p.sticky)
  // Sidecar tiles first. Output walks must not gate the explorer.
  broadcast({
    type: 'datasets-list-partial',
    payload: { listToken, phase: 'sticky', datasets: sticky }
  })

  const gen = ++badgeEnrichGen
  const runEnrich = (): Promise<DatasetSummary[]> =>
    enrichDatasetBadges(prepared, listToken, gen, emitLoadProgress)

  if (opts?.deferBadges) {
    setImmediate(() => {
      void runEnrich()
    })
    return sticky
  }
  return runEnrich()
}

async function enrichDatasetBadges(
  prepared: PreparedDataset[],
  listToken: number,
  gen: number,
  emitLoadProgress: (
    progress: import('@shared/library-load-progress').LibraryLoadProgress
  ) => void
): Promise<DatasetSummary[]> {
  const enrichTotal = prepared.length
  if (gen !== badgeEnrichGen) return prepared.map((p) => p.sticky)
  emitLoadProgress({
    phase: 'enrich',
    done: 0,
    total: enrichTotal,
    message: 'Updating dataset badges…'
  })
  if (enrichTotal === 0) {
    emitLoadProgress({
      phase: 'done',
      done: 0,
      total: 0,
      message: 'Ready'
    })
    return []
  }

  const enriched: DatasetSummary[] = new Array(prepared.length)
  let enrichBuffer: DatasetSummary[] = []
  let enrichFlushTimer: ReturnType<typeof setTimeout> | null = null
  let enrichDone = 0

  const flushEnrich = (): void => {
    if (enrichFlushTimer) {
      clearTimeout(enrichFlushTimer)
      enrichFlushTimer = null
    }
    if (enrichBuffer.length === 0 || gen !== badgeEnrichGen) return
    const batch = enrichBuffer
    enrichBuffer = []
    broadcast({
      type: 'datasets-list-partial',
      payload: { listToken, phase: 'enrich', datasets: batch }
    })
  }

  const queueEnrichPartial = (summary: DatasetSummary): void => {
    if (gen !== badgeEnrichGen) return
    enrichBuffer.push(summary)
    if (enrichBuffer.length >= 8) {
      flushEnrich()
      return
    }
    if (!enrichFlushTimer) {
      enrichFlushTimer = setTimeout(flushEnrich, 40)
    }
  }

  await mapWithConcurrency(prepared, LIST_ENRICH_CONCURRENCY, async (item, index) => {
    if (gen !== badgeEnrichGen) return item.sticky
    try {
      // Done / idle tiles keep sidecar badges. Reopening work (add validation set,
      // further training steps, keep-in-Comfy changes) clears Done via
      // syncDatasetValidatedFlag — this pass must not re-walk them.
      const needsOutputWalk =
        !item.record.done && (item.record.trained || item.record.validated)
      // Cover is independent of the output walk. A null sidecar means "first
      // image"; a saved name is used only while that file is still in the folder.
      const coverFileName = await resolveCoverFileName(item.record)
      const summary = needsOutputWalk
        ? await toSummary(item.record, coverFileName)
        : { ...item.sticky, coverFileName }
      if (gen !== badgeEnrichGen) return summary
      enriched[index] = summary
      queueEnrichPartial(summary)
      enrichDone++
      if (enrichDone === enrichTotal || enrichDone % 6 === 0) {
        emitLoadProgress({
          phase: 'enrich',
          done: enrichDone,
          total: enrichTotal,
          message: 'Updating dataset badges…'
        })
      }
      return summary
    } catch {
      enriched[index] = item.sticky
      queueEnrichPartial(item.sticky)
      enrichDone++
      return item.sticky
    }
  })
  flushEnrich()
  if (gen !== badgeEnrichGen) {
    return enriched.filter((s): s is DatasetSummary => s != null)
  }

  emitLoadProgress({
    phase: 'done',
    done: enrichTotal,
    total: enrichTotal,
    message: 'Ready'
  })

  const out = enriched.filter((s): s is DatasetSummary => s != null)
  return out.length === prepared.length ? out : prepared.map((p, i) => out[i] ?? p.sticky)
}

export async function getDataset(id: string): Promise<DatasetDetail> {
  const r = await readRecord(id)
  registerDatasetFolder(r.id, r.folderPath)
  // Self-heal sticky Validated from older builds (completeness vs keep-in-Comfy).
  await syncDatasetValidatedFlag(id, { quiet: true }).catch(() => undefined)
  const detail = await toDetail(await readRecord(id))
  // Watch for image add/remove only (folderWatch ignores dataset.json / captions / tmp).
  // UI reloads only when the image set actually changes.
  const { watchDatasetFolder } = await import('./folderWatch')
  void watchDatasetFolder(id)
  const { warmDatasetThumbs } = await import('../media/thumbs')
  void warmDatasetThumbs(
    r.id,
    r.folderPath,
    detail.images.slice(0, 36).map((img) => img.fileName)
  )
  return detail
}

export async function createDataset(input: {
  name: string
  folderPath: string
  categoryId: string
  trigger?: string
}): Promise<DatasetDetail> {
  const category = await ensureCategoryExists(input.categoryId)
  if (!category) {
    throw appError('not-found', `Category not found: ${input.categoryId}`, {
      remediation: 'Create a category first, then add the dataset.'
    })
  }
  const folderPath = assertAbsolutePath(input.folderPath)
  const { normFolderKey } = await import('./categorySync')
  const pathKey = normFolderKey(folderPath)
  const existingAll = await listAllDatasetRecordsFromLibrary()
  for (const existing of existingAll) {
    if (normFolderKey(existing.folderPath) === pathKey) {
      throw appError('validation', `A dataset already uses this folder: ${existing.name}`, {
        remediation: 'Open the existing dataset, or pick a different folder.'
      })
    }
  }
  const now = new Date().toISOString()
  const scanned = await scanFolder(folderPath)
  const settings = await loadSettings()
  const rememberedPrompt = settings.lastValidationPrompt.trim()
  const record: DatasetRecord = DatasetRecordSchema.parse({
    id: nanoid(),
    name: input.name || basename(folderPath),
    folderPath,
    categoryId: category.id,
    trigger: input.trigger ?? '',
    captionExt: 'txt',
    notes: '',
    ready: false,
    trained: false,
    validated: false,
    done: false,
    validationSets: [
      defaultValidationSetConfig(rememberedPrompt ? { prompt: rememberedPrompt } : {})
    ],
    createdAt: now,
    updatedAt: now,
    stats: scanned.stats
  })
  await persistRecord(record)
  registerDatasetFolder(record.id, record.folderPath)
  await patchSettings({ recentDatasetIds: touchRecent(settings.recentDatasetIds, record.id) })
  return {
    ...(await toSummary(record, scanned.images[0]?.fileName ?? null, {
      trained: false,
      hasValidationImages: false
    })),
    captionExt: record.captionExt,
    notes: record.notes,
    captionGuidance: record.captionGuidance ?? '',
    createdAt: record.createdAt,
    images: scanned.images
  }
}

/** Create `{categoryFolder}/{name}/` and register it (folder-backed categories). */
export async function createDatasetInCategory(input: {
  name: string
  categoryId: string
}): Promise<DatasetDetail> {
  const { createDatasetInCategory: createInCat } = await import('./categorySync')
  const record = await createInCat(input)
  const settings = await loadSettings()
  await patchSettings({ recentDatasetIds: touchRecent(settings.recentDatasetIds, record.id) })
  return getDataset(record.id)
}

/**
 * Create a new folder-backed dataset and copy (not move) one image plus its
 * caption / `.original` / `{stem}.upscale.json` sidecars from another dataset.
 * Records the source file name on the source `dataset.json` → `spawnedFromImages`
 * so the grid can show it was used as a Create-New-Dataset source.
 */
export async function createDatasetFromImage(input: {
  sourceDatasetId: string
  fileName: string
  name: string
  categoryId: string
}): Promise<DatasetDetail> {
  const source = await readRecord(input.sourceDatasetId)
  const base = basename(input.fileName)
  if (
    base !== input.fileName ||
    input.fileName.includes('..') ||
    input.fileName.includes('/') ||
    input.fileName.includes('\\')
  ) {
    throw appError('validation', 'Invalid image file name')
  }
  const ext = extname(base).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw appError('validation', `Not an image file: ${base}`)
  }

  const srcImage = assertInsideRoot(source.folderPath, join(source.folderPath, base))
  try {
    await access(srcImage, constants.F_OK)
  } catch {
    throw appError('not-found', `Image not found: ${base}`)
  }

  const created = await createDatasetInCategory({
    name: input.name,
    categoryId: input.categoryId
  })
  const destRoot = assertAbsolutePath(created.folderPath)
  const stem = imageStem(base)
  const siblings = [
    base,
    `${stem}.${source.captionExt}`,
    `${stem}.upscale.json`
  ]
  // Also try `.txt` when the source uses a non-txt caption extension.
  if (source.captionExt !== 'txt') {
    siblings.push(`${stem}.txt`)
  }

  const { copyFile } = await import('node:fs/promises')
  try {
    const { muteDatasetFolderWatch } = await import('./folderWatch')
    muteDatasetFolderWatch(2000)
  } catch {
    /* optional */
  }

  let copiedImage = false
  for (const name of siblings) {
    const src = assertInsideRoot(source.folderPath, join(source.folderPath, name))
    const dest = assertInsideRoot(destRoot, join(destRoot, name))
    try {
      await access(src, constants.F_OK)
    } catch {
      continue
    }
    if (name === base) {
      const { tipBytesForNonAdsDest } = await import('../images/imageEdit')
      const tip = await tipBytesForNonAdsDest(src, dest)
      if (tip) {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(dest, tip)
      } else {
        await copyFile(src, dest)
      }
      copiedImage = true
    } else {
      await copyFile(src, dest)
    }
  }

  if (!copiedImage) {
    throw appError('process-failed', `Failed to copy image into the new dataset: ${base}`)
  }

  // Flag the source image on the source dataset sidecar (not a filesystem marker).
  const already = (source.spawnedFromImages ?? []).some(
    (f) => f.toLowerCase() === base.toLowerCase()
  )
  if (!already) {
    const nextSource: DatasetRecord = {
      ...source,
      spawnedFromImages: [...(source.spawnedFromImages ?? []), base],
      updatedAt: new Date().toISOString()
    }
    await persistRecord(nextSource)
  }
  invalidateDetailCache(source.id)
  broadcast({ type: 'dataset-folder-changed', payload: { datasetId: source.id } })

  await updateDataset({
    id: created.id,
    trigger: input.name.trim(),
    captionGuidance: source.captionGuidance ?? '',
    coverFileName: base
  })
  return getDataset(created.id)
}

/**
 * Duplicate a dataset folder as a sibling: copy images, captions, and image
 * sidecars; skip `output/` and the source `dataset.json`. New sidecar gets a
 * fresh id and cleared ready/trained/validated/done/spawned flags (set configs kept;
 * stress/weight checkpoint picks cleared since output is not copied).
 */
export async function duplicateDataset(input: {
  sourceDatasetId: string
  name: string
}): Promise<DatasetDetail> {
  const source = await readRecord(input.sourceDatasetId)
  const displayName = sanitizeDatasetFolderName(input.name.trim() || source.name)
  const parent = dirname(assertAbsolutePath(source.folderPath))
  const destPath = assertAbsolutePath(join(parent, displayName))

  if (normalize(destPath).toLowerCase() === normalize(source.folderPath).toLowerCase()) {
    throw appError('validation', 'Choose a different name than the source dataset', {
      remediation: 'Pick a new folder name (e.g. add V2).'
    })
  }
  try {
    await access(destPath, constants.F_OK)
    throw appError('validation', `A folder already exists at: ${destPath}`, {
      remediation: 'Choose a different dataset name.'
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'validation') {
      throw err
    }
  }

  try {
    const { muteDatasetFolderWatch } = await import('./folderWatch')
    muteDatasetFolderWatch(5000)
  } catch {
    /* optional */
  }

  const sourceRoot = resolve(assertAbsolutePath(source.folderPath))
  try {
    await cp(sourceRoot, destPath, {
      recursive: true,
      errorOnExist: true,
      filter: (src) => {
        // Resolve so Windows drive-letter / separator quirks don't break `relative`.
        const resolvedSrc = resolve(src)
        if (resolvedSrc === sourceRoot) return true
        const rel = relative(sourceRoot, resolvedSrc)
        if (!rel || rel === '.') return true
        // Outside the source tree — do not copy (avoids accidental sidecar leakage).
        if (rel.startsWith('..') || rel.split(/[/\\]/).includes('..')) return false
        return shouldCopyPathOnDatasetDuplicate(rel)
      }
    })
  } catch (err) {
    await rm(destPath, { recursive: true, force: true }).catch(() => undefined)
    throw appError(
      'process-failed',
      `Failed to copy dataset folder: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Belt-and-suspenders: remove any sidecar that slipped through the filter.
  await unlink(join(destPath, DATASET_SIDECAR)).catch(() => undefined)

  const now = new Date().toISOString()
  let scanned: { images: ImageEntry[]; stats: DatasetRecord['stats'] }
  try {
    scanned = await scanFolder(destPath, source.captionExt)
  } catch (err) {
    await rm(destPath, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

  const coverStillThere =
    source.coverFileName != null &&
    scanned.images.some((img) => img.fileName.toLowerCase() === source.coverFileName!.toLowerCase())

  const record = DatasetRecordSchema.parse({
    id: nanoid(),
    name: displayName,
    folderPath: destPath,
    categoryId: source.categoryId,
    trigger: source.trigger,
    captionGuidance: source.captionGuidance ?? '',
    captionExt: source.captionExt,
    notes: source.notes,
    ready: false,
    trained: false,
    validated: false,
    done: false,
    coverFileName: coverStillThere ? source.coverFileName : null,
    spawnedFromImages: [],
    validationSets: source.validationSets,
    stressTestSets: (source.stressTestSets ?? []).map((s) => ({
      ...s,
      checkpointFileName: null
    })),
    weightSets: (source.weightSets ?? []).map((s) => ({
      ...s,
      checkpointFileName: null
    })),
    stressCompareModelOrder: [],
    stressCompareSetOrder: [],
    stressCompareCollapsedModels: [],
    createdAt: now,
    updatedAt: now,
    stats: scanned.stats
  })

  try {
    await persistRecord(record)
  } catch (err) {
    await rm(destPath, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

  registerDatasetFolder(record.id, record.folderPath)
  invalidateCategoryCache()
  const settings = await loadSettings()
  await patchSettings({ recentDatasetIds: touchRecent(settings.recentDatasetIds, record.id) })
  broadcast({
    type: 'category-datasets-changed',
    payload: { categoryId: record.categoryId }
  })
  return getDataset(record.id)
}

const IMPORT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

/** Copy image/caption files into a dataset folder (never move). */
export async function importDatasetFiles(input: {
  datasetId: string
  paths: string[]
}): Promise<{ imported: number; skipped: number }> {
  const r = await readRecord(input.datasetId)
  const root = assertAbsolutePath(r.folderPath)
  let imported = 0
  let skipped = 0
  const { copyFile } = await import('node:fs/promises')
  for (const raw of input.paths) {
    const src = normalize(raw)
    const base = basename(src)
    if (
      !base ||
      base.includes('..') ||
      base.includes('/') ||
      base.includes('\\') ||
      base.startsWith('.')
    ) {
      skipped++
      continue
    }
    const ext = extname(base).toLowerCase()
    const isImage = IMPORT_IMAGE_EXTS.has(ext)
    const isCaption = ext === `.${r.captionExt}` || ext === '.txt'
    if (!isImage && !isCaption) {
      skipped++
      continue
    }
    const dest = assertInsideRoot(root, join(root, base))
    try {
      await copyFile(src, dest)
      imported++
    } catch {
      skipped++
    }
  }
  if (imported > 0) {
    await rescanDataset(input.datasetId)
  }
  return { imported, skipped }
}

/**
 * Copy or move training images (plus caption / `.original` / upscale sidecars)
 * from one dataset folder into another. Skips when the destination already has
 * that image basename. Move refuses when source === target.
 */
export async function transferDatasetImages(input: {
  sourceDatasetId: string
  targetDatasetId: string
  fileNames: string[]
  mode: 'copy' | 'move'
}): Promise<{ transferred: number; skipped: number; mode: 'copy' | 'move' }> {
  if (input.sourceDatasetId === input.targetDatasetId) {
    throw appError('validation', 'Cannot transfer images into the same dataset')
  }
  const mode = input.mode === 'copy' ? 'copy' : 'move'
  const source = await readRecord(input.sourceDatasetId)
  const target = await readRecord(input.targetDatasetId)
  await assertDatasetIdle(
    input.sourceDatasetId,
    mode === 'move' ? 'move images out of' : 'copy images from'
  )
  await assertDatasetIdle(input.targetDatasetId, 'add images to')

  const sourceRoot = assertAbsolutePath(source.folderPath)
  const targetRoot = assertAbsolutePath(target.folderPath)

  try {
    const { muteDatasetFolderWatch } = await import('./folderWatch')
    muteDatasetFolderWatch(2500)
  } catch {
    /* optional */
  }

  const { copyFile } = await import('node:fs/promises')
  const { invalidateDatasetThumb } = await import('../media/thumbs')

  async function transferFile(srcPath: string, destPath: string): Promise<void> {
    if (mode === 'move') {
      try {
        await rename(srcPath, destPath)
        return
      } catch {
        await copyFile(srcPath, destPath)
        await unlink(srcPath).catch(() => undefined)
        return
      }
    }
    await copyFile(srcPath, destPath)
  }

  let transferred = 0
  let skipped = 0
  const movedBases: string[] = []

  for (const rawName of input.fileNames) {
    const base = basename(rawName)
    if (
      base !== rawName ||
      rawName.includes('..') ||
      rawName.includes('/') ||
      rawName.includes('\\')
    ) {
      skipped++
      continue
    }
    const ext = extname(base).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      skipped++
      continue
    }

    const srcImage = assertInsideRoot(sourceRoot, join(sourceRoot, base))
    const destImage = assertInsideRoot(targetRoot, join(targetRoot, base))
    try {
      await access(srcImage, constants.F_OK)
    } catch {
      skipped++
      continue
    }
    try {
      await access(destImage, constants.F_OK)
      skipped++
      continue
    } catch {
      /* dest free */
    }

    try {
      const { tipBytesForNonAdsDest } = await import('../images/imageEdit')
      const tip = await tipBytesForNonAdsDest(srcImage, destImage)
      if (tip) {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(destImage, tip)
        if (mode === 'move') {
          await unlink(srcImage).catch(() => undefined)
          // Drop legacy sibling if present
          const legacy = join(sourceRoot, originalSiblingFileName(base))
          await unlink(legacy).catch(() => undefined)
        }
      } else {
        await transferFile(srcImage, destImage)
      }
    } catch {
      skipped++
      continue
    }

    const stem = imageStem(base)
    const captionDest = assertInsideRoot(
      targetRoot,
      join(targetRoot, `${stem}.${target.captionExt}`)
    )
    for (const capName of [`${stem}.${source.captionExt}`, `${stem}.txt`]) {
      const srcCap = assertInsideRoot(sourceRoot, join(sourceRoot, capName))
      try {
        await access(srcCap, constants.F_OK)
      } catch {
        continue
      }
      try {
        await transferFile(srcCap, captionDest)
      } catch {
        /* caption optional */
      }
      break
    }

    for (const side of [`${stem}.upscale.json`, originalSiblingFileName(base)]) {
      // Legacy `.original` siblings may still exist pre-migration — copy/remove with transfer.
      const srcSide = assertInsideRoot(sourceRoot, join(sourceRoot, side))
      const destSide = assertInsideRoot(targetRoot, join(targetRoot, side))
      try {
        await access(srcSide, constants.F_OK)
      } catch {
        continue
      }
      try {
        await transferFile(srcSide, destSide)
      } catch {
        /* optional */
      }
    }

    transferred++
    if (mode === 'move') movedBases.push(base)
    await invalidateDatasetThumb(input.targetDatasetId, base, targetRoot).catch(() => undefined)
    if (mode === 'move') {
      await invalidateDatasetThumb(input.sourceDatasetId, base, sourceRoot).catch(() => undefined)
    }
  }

  if (mode === 'move' && movedBases.length > 0) {
    const srcNow = await readRecord(input.sourceDatasetId)
    const coverGone =
      srcNow.coverFileName != null &&
      movedBases.some((b) => b.toLowerCase() === srcNow.coverFileName!.toLowerCase())
    if (coverGone) {
      const nextCover = await firstImageName(srcNow)
      const next = {
        ...srcNow,
        coverFileName: nextCover,
        updatedAt: new Date().toISOString()
      }
      await persistRecord(next).catch(() => undefined)
    }
  }

  if (transferred > 0) {
    await rescanDataset(input.sourceDatasetId).catch(() => undefined)
    await rescanDataset(input.targetDatasetId).catch(() => undefined)
    broadcast({
      type: 'dataset-folder-changed',
      payload: { datasetId: input.sourceDatasetId }
    })
    broadcast({
      type: 'dataset-folder-changed',
      payload: { datasetId: input.targetDatasetId }
    })
  }

  return { transferred, skipped, mode }
}

export async function updateDataset(input: {
  id: string
  name?: string
  trigger?: string
  notes?: string
  captionGuidance?: string
  categoryId?: string
  ready?: boolean
  trained?: boolean
  validated?: boolean
  /** Internal only — prefer `markDatasetDone` to set true (wildcard gate). */
  done?: boolean
  coverFileName?: string | null
}): Promise<DatasetDetail> {
  const r = await readRecord(input.id)
  let categoryId = r.categoryId
  if (input.categoryId !== undefined) {
    const category = await ensureCategoryExists(input.categoryId)
    if (!category) {
      throw appError('not-found', `Category not found: ${input.categoryId}`, {
        remediation: 'Pick an existing category.'
      })
    }
    categoryId = category.id
  }

  let folderPath = r.folderPath
  let name = input.name !== undefined ? input.name.trim() || r.name : r.name

  if (input.name !== undefined) {
    const folderName = sanitizeDatasetFolderName(name)
    name = folderName
    const currentBase = basename(r.folderPath)
    if (folderName !== currentBase) {
      await assertDatasetIdleForRename(r.id)
      const parent = dirname(r.folderPath)
      const dest = join(parent, folderName)
      await assertCanRenameFolder(r.folderPath, dest)
      await renameFolderSafe(r.folderPath, dest)
      folderPath = dest
      unregisterDatasetFolder(r.id)
      registerDatasetFolder(r.id, folderPath)
      await remapJobsDatasetFolder({
        datasetId: r.id,
        oldFolderPath: r.folderPath,
        newFolderPath: folderPath
      })
    }
  }

  let coverFileName = r.coverFileName ?? null
  if (input.coverFileName !== undefined) {
    if (input.coverFileName === null || input.coverFileName === '') {
      coverFileName = null
    } else {
      const base = basename(input.coverFileName)
      if (
        base !== input.coverFileName ||
        input.coverFileName.includes('..') ||
        input.coverFileName.includes('/') ||
        input.coverFileName.includes('\\')
      ) {
        throw appError('validation', 'Invalid cover file name')
      }
      const ext = extname(base).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) {
        throw appError('validation', `Not an image file: ${base}`)
      }
      const full = assertInsideRoot(folderPath, join(folderPath, base))
      try {
        await access(full, constants.F_OK)
      } catch {
        throw appError('not-found', `Image not found: ${base}`)
      }
      coverFileName = base
    }
  }

  const nextValidated = input.validated ?? r.validated
  // Never promote Done via generic update — only markDatasetDone may set true.
  let nextDone = input.done === false ? false : Boolean(r.done)
  if (input.done === true) {
    nextDone = true
  }
  if (!nextValidated) nextDone = false

  const next: DatasetRecord = {
    ...r,
    name,
    folderPath,
    trigger: input.trigger ?? r.trigger,
    notes: input.notes ?? r.notes,
    captionGuidance:
      input.captionGuidance !== undefined ? input.captionGuidance : (r.captionGuidance ?? ''),
    categoryId,
    ready: input.ready ?? r.ready,
    trained: input.trained ?? r.trained,
    validated: nextValidated,
    done: nextDone,
    coverFileName,
    updatedAt: new Date().toISOString()
  }
  await persistRecord(next)
  registerDatasetFolder(next.id, next.folderPath)

  // Meta-only patches (no rename, no cover change): reuse the last scanned image
  // list so blur-saving trigger/notes/etc. doesn't re-stat every file on the share.
  const folderUnchanged = folderPath === r.folderPath
  const coverUnchanged = input.coverFileName === undefined
  const cached = detailCache.get(next.id)
  if (cached && folderUnchanged && coverUnchanged) {
    // Meta-only edits keep sticky badges from cache; explicit lifecycle patches win.
    const trainedOut =
      input.trained !== undefined ? next.trained : next.trained || cached.trained
    const validatedOut =
      input.validated !== undefined ? next.validated : next.validated || cached.validated
    const doneOut = !validatedOut
      ? false
      : input.done !== undefined
        ? next.done
        : next.done || cached.done
    return cacheDetail({
      ...cached,
      name: next.name,
      folderPath: next.folderPath,
      categoryId: next.categoryId,
      trigger: next.trigger,
      notes: next.notes,
      captionGuidance: next.captionGuidance ?? '',
      ready: next.ready,
      trained: trainedOut,
      validated: validatedOut,
      done: doneOut,
      updatedAt: next.updatedAt,
      status: datasetLifecycleStatus({
        ready: next.ready,
        trained: trainedOut,
        validated: validatedOut,
        done: doneOut
      })
    })
  }

  return toDetail(next)
}

/**
 * Resolve the LoRA stem used for wildcard matching: prefer an existing
 * checkpoint stem, else Category_Dataset.
 */
async function resolveDatasetLoraStem(r: DatasetRecord): Promise<string> {
  const outFolder = defaultOutputFolder(r.folderPath)
  let fileNames: string[] = []
  try {
    const checkpoints = await collectCheckpoints(outFolder)
    fileNames = checkpoints.map((c) => c.fileName)
  } catch {
    fileNames = []
  }
  const fromOutput = existingLoraStemFromCheckpointNames(fileNames)
  if (fromOutput) return fromOutput
  const category = await ensureCategoryExists(r.categoryId)
  return defaultLoraName(category?.name ?? '', r.name)
}

/**
 * User-only path to set `done: true`. Requires Validated and at least one
 * wildcard-library `<lora:stem…>` reference (step/brace variants ok).
 */
export async function markDatasetDone(id: string): Promise<DatasetDetail> {
  await syncDatasetValidatedFlag(id, { quiet: true }).catch(() => undefined)
  const r = await readRecord(id)
  if (!r.validated) {
    const plan = await loadInFlightTrainingPlan(id).catch(() => null)
    const latest = await latestCheckpointStepForDataset(id).catch(() => 0)
    if (plan && plan.totalSteps > latest) {
      throw appError(
        'validation',
        `Further training is planned through step ${plan.totalSteps} (output is at ${latest || 0}).`,
        {
          remediation:
            'Wait for training to finish and re-validate new checkpoints before marking Done.'
        }
      )
    }
    throw appError(
      'validation',
      'Dataset must be Validated before it can be marked Done.',
      {
        remediation:
          'Finish LoRA Validation Steps for every keep-in-Comfy checkpoint, then try again.'
      }
    )
  }
  if (r.done) {
    return getDataset(id)
  }

  const stem = await resolveDatasetLoraStem(r)
  const { wildcardsReferenceLoraStem } = await import('../wildcards/service')
  const { folderConfigured, referenced } = await wildcardsReferenceLoraStem(stem)
  if (!folderConfigured) {
    throw appError(
      'validation',
      'No wildcards library folder is configured.',
      {
        remediation:
          'Set Settings → ComfyUI → Wildcards to your Dynamic Prompts folder, add a <lora:' +
          stem +
          '> reference, then try again.'
      }
    )
  }
  if (!referenced) {
    throw appError(
      'validation',
      `No wildcard file references this LoRA (“${stem}”).`,
      {
        remediation:
          `Add a <lora:${stem}> tag (step suffixes and brace variants like ` +
          `<lora:${stem}_000000{250|500}> are fine) to a file under the wildcards folder, then try again.`
      }
    )
  }

  const detail = await updateDataset({ id, done: true })
  broadcast({
    type: 'dataset-folder-changed',
    payload: {
      datasetId: id,
      trained: detail.trained,
      validated: detail.validated,
      done: true
    }
  })
  return detail
}

/**
 * Sticky “trained” flag when a training job completes (or a scan finds checkpoints).
 * Library badges use this so status does not depend on a slow output-folder scan.
 * Always re-syncs `validated` — new checkpoints mean sets may be incomplete again.
 */
export async function markDatasetTrained(id: string): Promise<void> {
  const r = await readRecord(id)
  if (!r.trained) {
    await updateDataset({ id, trained: true })
  }
  const validated = await syncDatasetValidatedFlag(id, { quiet: true })
  const after = await readRecord(id).catch(() => null)
  broadcast({
    type: 'dataset-folder-changed',
    payload: {
      datasetId: id,
      trained: true,
      validated,
      done: after?.done ?? false
    }
  })
}

/**
 * Set `validated` from LoRA Validation completeness: every set has a preview for
 * every keep-in-Comfy checkpoint. Also false when an open job plans steps beyond
 * the highest on-disk checkpoint (further training). Can promote or demote.
 * **Done is sticky only while Validated** — demotion clears `done` so the dataset
 * returns to normal badge enrich / training output work. Does not touch Stress sets.
 * No keep-in-Comfy checkpoints ⇒ not Validated; no `.safetensors` ⇒ not Trained either.
 */
export async function syncDatasetValidatedFlag(
  id: string,
  opts?: { quiet?: boolean }
): Promise<boolean> {
  const r = await readRecord(id)
  const setCount = Math.max(1, r.validationSets?.length ?? 0)
  let complete = false
  let safetensorsCount: number | null = null
  try {
    const { getValidationSetsStatus } = await import('../comfy/nextValidationLora')
    const status = await getValidationSetsStatus(r.folderPath, setCount)
    complete = status.complete
    safetensorsCount = status.safetensorsCount
  } catch {
    complete = false
  }
  if (complete) {
    try {
      const plan = await loadInFlightTrainingPlan(id)
      if (plan) {
        const latest = await latestCheckpointStepForDataset(id)
        if (plan.totalSteps > latest) complete = false
      }
    } catch {
      /* ignore plan lookup errors — keep preview-based complete */
    }
  }
  // Trust a successful listing: empty output clears false sticky Trained from older bugs.
  const trained =
    safetensorsCount === null ? r.trained || complete : safetensorsCount > 0 || complete
  const nextDone = complete ? Boolean(r.done) : false
  if (r.validated === complete && r.trained === trained && r.done === nextDone) {
    if (!opts?.quiet) {
      broadcast({
        type: 'dataset-folder-changed',
        payload: { datasetId: id, trained, validated: complete, done: nextDone }
      })
    }
    return complete
  }
  await updateDataset({
    id,
    validated: complete,
    trained,
    done: nextDone
  })
  // Always notify when flags change — quiet only suppresses the no-op ping.
  // Done→not-Done after add-set / further-training must update explorer tiles
  // even when getDataset used quiet:true.
  broadcast({
    type: 'validation-previews-changed',
    payload: { datasetId: id }
  })
  broadcast({
    type: 'dataset-folder-changed',
    payload: { datasetId: id, trained, validated: complete, done: nextDone }
  })
  return complete
}

/** @deprecated Prefer syncDatasetValidatedFlag — kept for call-site clarity. */
export async function markDatasetValidated(id: string): Promise<void> {
  await syncDatasetValidatedFlag(id)
}

async function assertDatasetIdle(datasetId: string, action: string): Promise<void> {
  const { isValidationRunningForDataset } = await import('../comfy/validationQueue')
  // Only an active run blocks (done / cancelled / error must not).
  if (isValidationRunningForDataset(datasetId)) {
    throw appError('busy', `Cannot ${action} while validation is running for this dataset`, {
      remediation: 'Wait for validation to finish or cancel it first.'
    })
  }
  const { listQueue } = await import('../queue/engine')
  const { getJobRecord, listJobs } = await import('../jobs/store')
  const snap = await listQueue()
  if (snap.runningJobId) {
    try {
      const job = await getJobRecord(snap.runningJobId)
      if (job.datasetId === datasetId) {
        throw appError('busy', `Cannot ${action} while a training job is running for this dataset`, {
          remediation: 'Wait for the job to finish or stop the queue first.'
        })
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'busy') {
        throw err
      }
      /* job missing — ignore */
    }
  }
  const jobs = await listJobs()
  if (jobs.some((j) => j.datasetId === datasetId && j.status === 'paused')) {
    throw appError('busy', `Cannot ${action} while a training job is paused for this dataset`, {
      remediation: 'Stop or cancel the paused job first (Queue → Stop), then clear output.'
    })
  }
}

async function assertDatasetIdleForRename(datasetId: string): Promise<void> {
  await assertDatasetIdle(datasetId, 'rename')
}

async function assertCanRenameFolder(from: string, to: string): Promise<void> {
  try {
    await access(from, constants.F_OK)
  } catch {
    throw appError('folder-missing', `Dataset folder missing: ${from}`, {
      remediation: 'Restore the folder or re-add the dataset before renaming.'
    })
  }
  const samePath =
    process.platform === 'win32'
      ? from.toLowerCase() === to.toLowerCase()
      : from === to
  if (samePath) return
  try {
    await access(to, constants.F_OK)
    throw appError('validation', `A folder already exists at: ${to}`, {
      remediation: 'Choose a different name, or move/rename the existing folder first.'
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'validation') {
      throw err
    }
    /* dest missing — good */
  }
}

/** Rename folder; two-step on Windows when only case changes. */
async function renameFolderSafe(from: string, to: string): Promise<void> {
  if (from === to) return
  const caseOnly =
    process.platform === 'win32' && from.toLowerCase() === to.toLowerCase() && from !== to
  if (caseOnly) {
    const tmp = `${from}__lt_rename_tmp__`
    await rename(from, tmp)
    await rename(tmp, to)
    return
  }
  await rename(from, to)
}


export async function removeDataset(id: string): Promise<{ deleted: true }> {
  const { stopDatasetFolderWatch } = await import('./folderWatch')
  stopDatasetFolderWatch()

  let folderPath: string | undefined
  try {
    const r = await readRecord(id)
    folderPath = r.folderPath
    await unlink(datasetSidecarPath(r.folderPath)).catch(() => undefined)
  } catch (err) {
    if (!isNoDatasetError(err)) throw err
    folderPath = getRegisteredFolder(id)
  }

  unregisterDatasetFolder(id)
  invalidateDetailCache(id)
  const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
  if (folderPath) {
    await invalidateAllDatasetThumbs(id, folderPath)
  }
  return { deleted: true }
}

/**
 * Permanently delete the dataset folder on disk (images, captions, output/)
 * and remove the library record. Refuses while training/validation is active,
 * and refuses to delete a category root folder.
 */
export async function deleteDatasetForever(id: string): Promise<{ deleted: true; folderDeleted: boolean }> {
  await assertDatasetIdle(id, 'delete')

  let r: DatasetRecord | null = null
  try {
    r = await readRecord(id)
  } catch (err) {
    if (!isNoDatasetError(err)) throw err
  }

  // Already gone from disk/library — just clear registrations and succeed.
  if (!r) {
    const { stopDatasetFolderWatch } = await import('./folderWatch')
    stopDatasetFolderWatch()
    const folderPath = getRegisteredFolder(id)
    unregisterDatasetFolder(id)
    invalidateDetailCache(id)
    if (folderPath) {
      const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
      await invalidateAllDatasetThumbs(id, folderPath)
    }
    return { deleted: true, folderDeleted: false }
  }

  const folderPath = assertAbsolutePath(r.folderPath)
  const folderKey =
    process.platform === 'win32' ? resolve(folderPath).toLowerCase() : resolve(folderPath)

  const cats = await listCategories()
  for (const cat of cats) {
    const root = cat.folderPath?.trim()
    if (!root) continue
    try {
      const rootKey =
        process.platform === 'win32'
          ? resolve(assertAbsolutePath(root)).toLowerCase()
          : resolve(assertAbsolutePath(root))
      if (rootKey === folderKey) {
        throw appError(
          'validation',
          'Refusing to delete a category root folder',
          {
            remediation:
              'This path is a category folder. Delete individual dataset subfolders instead.'
          }
        )
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'validation') {
        throw err
      }
    }
  }

  const { stopDatasetFolderWatch } = await import('./folderWatch')
  stopDatasetFolderWatch()

  // Best-effort: remove staged Comfy LoRAs before wiping output/.
  try {
    const outFolder = resolve(defaultOutputFolder(r.folderPath))
    let checkpoints: CheckpointEntry[] = []
    try {
      checkpoints = await collectCheckpoints(outFolder)
    } catch {
      checkpoints = []
    }
    const { deleteStagedValidationLora } = await import('./checkpointPrefs')
    for (const cp of checkpoints) {
      try {
        await deleteStagedValidationLora({
          datasetFolder: r.folderPath,
          fileName: cp.fileName,
          datasetSubfolder: undefined
        })
      } catch {
        /* continue */
      }
    }
  } catch {
    /* folder may already be gone */
  }

  let folderDeleted = false
  try {
    await access(folderPath, constants.F_OK)
    await rm(folderPath, { recursive: true, force: true })
    folderDeleted = true
  } catch (err) {
    // Missing folder: still remove library entry.
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    if (code !== 'ENOENT') {
      throw appError(
        'process-failed',
        `Could not delete folder: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  await unlink(datasetSidecarPath(r.folderPath)).catch(() => undefined)
  unregisterDatasetFolder(id)
  invalidateDetailCache(id)
  const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
  await invalidateAllDatasetThumbs(id, r.folderPath)

  // Avoid immediate rediscovery races while the FS settles.
  try {
    const { muteDatasetFolderWatch } = await import('./folderWatch')
    muteDatasetFolderWatch(1500)
  } catch {
    /* optional */
  }

  return { deleted: true, folderDeleted }
}

export async function rescanDataset(
  id: string
): Promise<{ images: ImageEntry[]; stats: DatasetRecord['stats'] }> {
  const r = await readRecord(id)
  const scanned = await scanFolder(r.folderPath, r.captionExt)
  const images = applySpawnedFlags(scanned.images, r.spawnedFromImages)
  const statsChanged =
    scanned.stats.images !== r.stats.images ||
    scanned.stats.captions !== r.stats.captions ||
    JSON.stringify(scanned.stats.stemCollisions ?? []) !==
      JSON.stringify(r.stats.stemCollisions ?? [])
  if (statsChanged) {
    const next: DatasetRecord = {
      ...r,
      stats: scanned.stats,
      updatedAt: new Date().toISOString()
    }
    await persistRecord(next)
    registerDatasetFolder(next.id, next.folderPath)
  }
  lastImageFingerprint.set(id, imageListFingerprint(images))
  // Explicit rescan always drops cache so the next get is fresh.
  invalidateDetailCache(id)
  return { images, stats: scanned.stats }
}

/**
 * Folder-watch path: scan, but report whether the image set actually changed.
 * Does not notify callers to reload when only dataset.json / noise was involved
 * (those files are already ignored by the watcher) or when images are identical.
 */
export async function rescanDatasetIfImagesChanged(id: string): Promise<{
  changed: boolean
  images: ImageEntry[]
  stats: DatasetRecord['stats']
}> {
  const r = await readRecord(id)
  const scanned = await scanFolder(r.folderPath, r.captionExt)
  const images = applySpawnedFlags(scanned.images, r.spawnedFromImages)
  const nextFp = imageListFingerprint(images)
  const prevFp = lastImageFingerprint.get(id) ?? null

  if (prevFp !== null && prevFp === nextFp) {
    return { changed: false, images, stats: scanned.stats }
  }

  // No prior fingerprint (e.g. watch before getDataset finished): establish baseline only.
  if (prevFp === null) {
    lastImageFingerprint.set(id, nextFp)
    return { changed: false, images, stats: scanned.stats }
  }

  lastImageFingerprint.set(id, nextFp)

  const statsChanged =
    scanned.stats.images !== r.stats.images ||
    scanned.stats.captions !== r.stats.captions ||
    JSON.stringify(scanned.stats.stemCollisions ?? []) !==
      JSON.stringify(r.stats.stemCollisions ?? [])
  if (statsChanged) {
    const next: DatasetRecord = {
      ...r,
      stats: scanned.stats,
      updatedAt: new Date().toISOString()
    }
    await persistRecord(next)
    registerDatasetFolder(next.id, next.folderPath)
  }

  const cached = detailCache.get(id)
  if (cached && cached.id === id) {
    cacheDetail({
      ...cached,
      images,
      stats: scanned.stats,
      updatedAt: new Date().toISOString()
    })
  } else {
    invalidateDetailCache(id)
  }
  return { changed: true, images, stats: scanned.stats }
}

/**
 * Wipe dataset `output/` (checkpoints, caches, validation images, prefs/ratings)
 * and delete this dataset’s staged LoRAs from the ComfyUI LoRA folder.
 */
export async function clearDatasetOutput(id: string): Promise<{
  cleared: true
  checkpointsRemoved: number
  deletedFromComfy: number
}> {
  const { cancelValidationIfActiveForDataset } = await import('../comfy/validationQueue')
  await cancelValidationIfActiveForDataset(id)
  await assertDatasetIdle(id, 'clear output')
  const r = await readRecord(id)
  const datasetFolder = resolve(r.folderPath)
  const outFolder = resolve(defaultOutputFolder(r.folderPath))

  if (!outFolder || outFolder.toLowerCase() === datasetFolder.toLowerCase()) {
    throw appError('validation', 'Refusing to clear the dataset folder as training output', {
      remediation: 'Expected a dedicated output/ folder under the dataset.'
    })
  }
  const underDataset =
    outFolder.toLowerCase().startsWith(datasetFolder.toLowerCase() + '\\') ||
    outFolder.toLowerCase().startsWith(datasetFolder.toLowerCase() + '/')
  if (!underDataset) {
    throw appError(
      'validation',
      `Refusing to delete output outside the dataset folder: ${outFolder}`,
      { remediation: 'Dataset output must stay under the dataset directory.' }
    )
  }

  let checkpoints: CheckpointEntry[] = []
  try {
    checkpoints = await collectCheckpoints(outFolder)
  } catch {
    checkpoints = []
  }

  let deletedFromComfy = 0
  const { deleteStagedValidationLora } = await import('./checkpointPrefs')
  for (const cp of checkpoints) {
    try {
      const result = await deleteStagedValidationLora({
        datasetFolder: r.folderPath,
        fileName: cp.fileName,
        datasetSubfolder: undefined
      })
      if (result.deleted) deletedFromComfy++
    } catch {
      /* Comfy folder unset or file already gone */
    }
  }

  await rm(outFolder, { recursive: true, force: true })
  await mkdir(outFolder, { recursive: true })

  const { listValidationSets } = await import('../comfy/validationSets')
  await listValidationSets(id)

  await updateDataset({ id, trained: false, validated: false, done: false })

  broadcast({
    type: 'dataset-folder-changed',
    payload: { datasetId: id, trained: false, validated: false, done: false }
  })
  broadcast({ type: 'validation-previews-changed', payload: { datasetId: id } })

  return {
    cleared: true,
    checkpointsRemoved: checkpoints.length,
    deletedFromComfy
  }
}

/**
 * Highest numbered checkpoint step for a dataset — same walk as the Output tab,
 * step = digits after the last `_` in the `.safetensors` basename.
 */
export async function latestCheckpointStepForDataset(id: string): Promise<number> {
  const r = await readRecord(id)
  const trainingFolder = defaultOutputFolder(r.folderPath)
  let checkpoints: CheckpointEntry[]
  try {
    checkpoints = await collectCheckpoints(trainingFolder)
  } catch {
    return 0
  }
  const step = latestCheckpointStepFromNames(checkpoints.map((c) => c.fileName))
  return step != null && step > 0 ? step : 0
}

export async function listDatasetOutputs(id: string): Promise<DatasetOutputs> {
  const r = await readRecord(id)
  const trainingFolder = defaultOutputFolder(r.folderPath)
  const checkpoints = await collectCheckpoints(trainingFolder)
  const ratings = await loadValidationRatings(r.folderPath)
  const { reconcileStagedComfyDirs } = await import('./checkpointPrefs')
  const healedDirs = await reconcileStagedComfyDirs({
    datasetFolder: r.folderPath,
    fileNames: checkpoints.map((c) => c.fileName)
  })
  // Reload after heal so keep/path prefs match what reconcile just wrote.
  const prefsAfter = await loadCheckpointPrefs(r.folderPath)
  const outputRel = relative(r.folderPath, trainingFolder).replace(/\\/g, '/') || 'output'
  for (const cp of checkpoints) {
    const stem = basename(cp.fileName, extname(cp.fileName))
    const { average, count } = averageCheckpointRating(ratings, stem)
    cp.averageRating = average
    cp.ratingCount = count
    cp.keepInComfy = isKeepInComfy(prefsAfter, stem)
    cp.comfyRelativeDir = healedDirs.get(stem) ?? null
    if (cp.validationImageRelativePath) {
      cp.validationImageRelativePath = `${outputRel}/${cp.validationImageRelativePath}`
    }
    cp.validationImages = cp.validationImages.map((img) => ({
      ...img,
      relativePath: `${outputRel}/${img.relativePath}`
    }))
  }

  // Append synthetic rows for steps planned by an open job but not on disk yet.
  try {
    const plan = await loadInFlightTrainingPlan(id)
    if (plan) {
      const existingNames = checkpoints.map((c) => c.fileName)
      const pending = buildPendingCheckpointEntries({
        plan,
        existingFileNames: existingNames,
        fallbackStem: r.name
      })
      if (pending.length > 0) {
        checkpoints.push(...pending)
        checkpoints.sort(compareCheckpointsByStep)
      }
    }
  } catch {
    /* ignore plan lookup — still return on-disk checkpoints */
  }

  return { trainingFolder, checkpoints }
}

const PREVIEW_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

/** Delete one validation preview for a checkpoint stem in a Set folder. */
export async function deleteValidationPreview(opts: {
  datasetId: string
  setLabel: string
  stem: string
}): Promise<{ deleted: true; average: number | null; count: number }> {
  const { datasetId, setLabel, stem } = opts
  if (!setLabel.trim() || !stem.trim()) {
    throw appError('validation', 'setLabel and stem are required')
  }
  if (
    !isValidationSetDirName(setLabel) &&
    !isStressTestSetDirName(setLabel) &&
    !isWeightSetDirName(setLabel)
  ) {
    throw appError('validation', `Invalid preview set folder: ${setLabel}`)
  }

  const r = await readRecord(datasetId)
  const setDir = join(defaultOutputFolder(r.folderPath), setLabel)
  let removed = 0
  for (const ext of PREVIEW_EXTS) {
    const candidate = assertInsideRoot(r.folderPath, join(setDir, `${stem}${ext}`))
    try {
      await unlink(candidate)
      removed++
    } catch {
      /* missing ok */
    }
    try {
      await unlink(assertInsideRoot(r.folderPath, join(setDir, `${stem}${ext.toUpperCase()}`)))
      removed++
    } catch {
      /* missing ok */
    }
  }
  if (removed === 0) {
    throw appError('not-found', `No preview image found for ${stem} in ${setLabel}`)
  }

  if (isValidationSetDirName(setLabel)) {
    try {
      const { mutateCheckpointPrefs } = await import('./checkpointPrefs')
      await mutateCheckpointPrefs(r.folderPath, (prefs) => {
        const stemMap = prefs.validationPreviews?.[stem]
        if (!stemMap || !(setLabel in stemMap)) return
        delete stemMap[setLabel]
        if (Object.keys(stemMap).length === 0) delete prefs.validationPreviews[stem]
      })
    } catch {
      /* prefs optional */
    }
  }

  // Drop the per-set rating so averages stay honest.
  const ratingResult = await setValidationRatingForFolder({
    datasetFolder: r.folderPath,
    setLabel,
    stem,
    rating: null
  })
  if (isValidationSetDirName(setLabel)) {
    await syncDatasetValidatedFlag(datasetId).catch(() => undefined)
  }

  if (isValidationSetDirName(setLabel)) {
    const { clearValidationLastPreviewForStem } = await import('../comfy/validationQueue')
    clearValidationLastPreviewForStem(setLabel, stem)
  } else if (isWeightSetDirName(setLabel)) {
    const { clearWeightLastPreviewForStem } = await import('../comfy/weightQueue')
    clearWeightLastPreviewForStem(setLabel, stem)
  } else {
    const { clearStressLastPreviewForStem } = await import('../comfy/stressQueue')
    clearStressLastPreviewForStem(setLabel, stem)
  }

  broadcast({
    type: isValidationSetDirName(setLabel)
      ? 'validation-previews-changed'
      : isWeightSetDirName(setLabel)
        ? 'weight-previews-changed'
        : 'stress-previews-changed',
    payload: { datasetId }
  })
  return { deleted: true, average: ratingResult.average, count: ratingResult.count }
}

/** Absolute path of any file under the dataset folder (path-guarded). */
export async function resolveDatasetRelativePath(
  datasetId: string,
  relativePath: string
): Promise<string> {
  const r = await readRecord(datasetId)
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized || normalized.includes('..')) {
    throw appError('validation', 'Invalid relative path')
  }
  const full = assertInsideRoot(r.folderPath, join(r.folderPath, ...normalized.split('/')))
  try {
    await access(full, constants.F_OK)
  } catch {
    throw appError('not-found', `File not found: ${normalized}`)
  }
  return full
}

/** Absolute path of a dataset image (path-guarded). */
export async function resolveDatasetImagePath(
  datasetId: string,
  fileName: string
): Promise<string> {
  const r = await readRecord(datasetId)
  const base = basename(fileName)
  if (base !== fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw appError('validation', 'Invalid image file name')
  }
  const ext = extname(base).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw appError('validation', `Not an image file: ${base}`)
  }
  const imagePath = assertInsideRoot(r.folderPath, join(r.folderPath, base))
  try {
    await access(imagePath, constants.F_OK)
  } catch {
    throw appError('not-found', `Image not found: ${base}`)
  }
  return imagePath
}

/** Delete a training image and its caption (same stem) from the dataset folder. */
export async function deleteDatasetImage(
  datasetId: string,
  fileName: string,
  opts?: { permanent?: boolean }
): Promise<{
  deleted: true
  permanent: boolean
  fileName: string
  coverFileName: string | null
  stats: DatasetRecord['stats']
  updatedAt: string
}> {
  const permanent = opts?.permanent === true
  const r = await readRecord(datasetId)
  const base = basename(fileName)
  if (base !== fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw appError('validation', 'Invalid image file name')
  }
  const ext = extname(base).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw appError('validation', `Not an image file: ${base}`)
  }

  const imagePath = assertInsideRoot(r.folderPath, join(r.folderPath, base))
  const stem = basename(base, extname(base))
  const captionPath = assertInsideRoot(
    r.folderPath,
    join(r.folderPath, `${stem}.${r.captionExt}`)
  )
  const originalPath = assertInsideRoot(
    r.folderPath,
    join(r.folderPath, originalSiblingFileName(base))
  )
  const upscaleConfigPath = assertInsideRoot(r.folderPath, join(r.folderPath, `${stem}.upscale.json`))

  let hadCaption = false
  try {
    await access(captionPath, constants.F_OK)
    hadCaption = true
  } catch {
    /* no caption */
  }
  let hadOriginal = false
  try {
    await access(originalPath, constants.F_OK)
    hadOriginal = true
  } catch {
    /* no original backup */
  }
  let hadUpscaleConfig = false
  try {
    await access(upscaleConfigPath, constants.F_OK)
    hadUpscaleConfig = true
  } catch {
    /* no upscale sidecar */
  }

  try {
    await access(imagePath, constants.F_OK)
  } catch {
    throw appError('not-found', `Image not found: ${base}`)
  }

  if (permanent) {
    try {
      await unlink(imagePath)
    } catch {
      throw appError('not-found', `Image not found: ${base}`)
    }
    await unlink(captionPath).catch(() => undefined)
    if (hadOriginal) await unlink(originalPath).catch(() => undefined)
    if (hadUpscaleConfig) await unlink(upscaleConfigPath).catch(() => undefined)
  } else {
    const { shell } = await import('electron')
    try {
      await shell.trashItem(imagePath)
    } catch (err) {
      throw appError(
        'process-failed',
        `Could not move to trash: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (hadCaption) {
      await shell.trashItem(captionPath).catch(() => undefined)
    }
    if (hadOriginal) {
      await shell.trashItem(originalPath).catch(() => undefined)
    }
    if (hadUpscaleConfig) {
      await shell.trashItem(upscaleConfigPath).catch(() => undefined)
    }
  }

  // Stop folder-watch from rescanning and resetting selection to image[0].
  const { muteDatasetFolderWatch } = await import('./folderWatch')
  muteDatasetFolderWatch(1500)

  const { invalidateDatasetThumb } = await import('../media/thumbs')
  await invalidateDatasetThumb(datasetId, base, r.folderPath)

  // Names-only pass (no per-file stat/caption reads) to refresh stem-collision list.
  let stemCollisions = [...(r.stats.stemCollisions ?? [])]
  try {
    const entries = await readdir(r.folderPath)
    const stemLower = stem.toLowerCase()
    const remainingSameStem = entries.filter((name) => {
      const e = extname(name).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(e)) return false
      return imageStem(name).toLowerCase() === stemLower
    }).length
    if (remainingSameStem <= 1) {
      stemCollisions = stemCollisions.filter((s) => s.toLowerCase() !== stemLower)
    }
  } catch {
    /* keep previous collisions */
  }

  // Library tiles use summary.coverFileName. listDatasets resolves a null sidecar
  // cover to the first image, but this IPC used to return the raw sidecar value
  // (often null) and wipe the explorer thumb. Always return an effective cover:
  // surviving explicit cover if still on disk, otherwise first remaining image.
  let coverFileName: string | null = null
  if (r.coverFileName && r.coverFileName.toLowerCase() !== base.toLowerCase()) {
    try {
      const coverPath = assertInsideRoot(
        r.folderPath,
        join(r.folderPath, basename(r.coverFileName))
      )
      await access(coverPath, constants.F_OK)
      coverFileName = basename(r.coverFileName)
    } catch {
      coverFileName = null
    }
  }
  if (!coverFileName) {
    coverFileName = await firstImageName(r)
  }

  const updatedAt = new Date().toISOString()
  const stats = {
    images: Math.max(0, (r.stats.images ?? 1) - 1),
    captions: hadCaption ? Math.max(0, (r.stats.captions ?? 0) - 1) : (r.stats.captions ?? 0),
    stemCollisions
  }
  const next: DatasetRecord = {
    ...r,
    coverFileName,
    stats,
    spawnedFromImages: (r.spawnedFromImages ?? []).filter(
      (f) => f.toLowerCase() !== base.toLowerCase()
    ),
    updatedAt
  }
  await persistRecord(next)
  registerDatasetFolder(next.id, next.folderPath)
  invalidateDetailCache(datasetId)

  return {
    deleted: true,
    permanent,
    fileName: base,
    coverFileName,
    stats,
    updatedAt
  }
}

export async function getDatasetRecord(id: string): Promise<DatasetRecord> {
  return readRecord(id)
}

/** Move datasets out of a deleted category, then remove the category. */
export async function removeCategoryAndReassign(categoryId: string): Promise<{
  deleted: true
  movedToCategoryId: string | null
  movedCount: number
}> {
  const result = await deleteCategoryRecord(categoryId)
  let movedCount = 0
  const targetId = result.movedToCategoryId
  if (!targetId) {
    return { ...result, movedCount: 0 }
  }
  const records = await listAllDatasetRecordsFromLibrary()
  for (const r0 of records) {
    try {
      // r0 was just read fresh above — migrate in place, no per-record re-walk.
      const r = await migrateRecord(r0)
      if (r.categoryId !== categoryId) continue
      await persistRecord({
        ...r,
        categoryId: targetId,
        updatedAt: new Date().toISOString()
      })
      movedCount++
    } catch {
      /* skip */
    }
  }
  return { ...result, movedCount }
}
