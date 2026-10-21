import { watch, type FSWatcher } from 'node:fs'
import { access, mkdir, readdir, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import {
  DATASET_DISCOVERY_EXTENSIONS,
  type CategoryRecord
} from '@shared/schemas/category'
import {
  DatasetRecordSchema,
  sanitizeDatasetFolderName,
  type DatasetRecord
} from '@shared/schemas/dataset'
import {
  datasetSidecarPath,
  isDiscoverableDatasetDirName
} from '@shared/library-paths'
import { defaultValidationSetConfig } from '@shared/validation-sets'
import type { LibraryLoadProgress } from '@shared/library-load-progress'
import { appError } from '@shared/errors'
import { listCategories } from '../categories/store'
import { broadcast } from '../events/bus'
import { logger } from '../logging'
import { assertAbsolutePath } from '../security/path-guards'
import { loadSettings } from '../settings/store'
import { registerDatasetFolder, unregisterDatasetFolder, listRegisteredDatasetIds } from '../media/protocol'
import {
  listAllDatasetRecordsFromLibrary,
  writeDatasetSidecar
} from '../library/datasetSidecar'
import { mapWithConcurrency } from '../util/concurrency'

export { isDiscoverableDatasetDirName }

/** Last dataset ids seen after a successful sync — used to detect vanished folders. */
let lastKnownDatasetIds = new Set<string>()

/** Concurrent folder probes under one category root (network shares). */
const DISCOVERY_CONCURRENCY = 8

export type SyncProgressCallback = (progress: LibraryLoadProgress) => void

export function normFolderKey(folderPath: string): string {
  const n = resolve(folderPath).replace(/[/\\]+$/, '')
  return process.platform === 'win32' ? n.toLowerCase() : n
}

/** True if a top-level file name qualifies a folder as a discoverable dataset. */
export function isDiscoveryImageFileName(fileName: string): boolean {
  return DATASET_DISCOVERY_EXTENSIONS.has(extname(fileName).toLowerCase())
}

/** Whether `dataset.json` already marks this folder as a dataset. */
export async function folderHasDatasetSidecar(folderPath: string): Promise<boolean> {
  try {
    await access(datasetSidecarPath(folderPath), constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a directory qualifies as a dataset folder.
 * Prefer an existing `dataset.json` (never look inside for nested datasets).
 * Otherwise require at least one top-level jpg/jpeg/png — still no recursion.
 */
export async function folderIsDiscoverableDataset(folderPath: string): Promise<boolean> {
  if (await folderHasDatasetSidecar(folderPath)) return true
  return folderHasDiscoveryImages(folderPath)
}

/** Whether a directory contains at least one top-level jpg/jpeg/png (non-recursive). */
export async function folderHasDiscoveryImages(folderPath: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(folderPath)
  } catch {
    return false
  }
  return entries.some((name) => isDiscoveryImageFileName(name))
}

function isImmediateChildOf(parent: string, child: string): boolean {
  const p = normFolderKey(parent)
  const c = normFolderKey(child)
  if (c === p) return false
  if (!c.startsWith(p)) return false
  const rel = c.slice(p.length)
  if (!rel.startsWith('\\') && !rel.startsWith('/')) return false
  const rest = rel.slice(1)
  return rest.length > 0 && !rest.includes('\\') && !rest.includes('/')
}

/** Exported for tests — whether a dataset folder is managed by a category root. */
export function isCategoryManagedDatasetFolder(
  categoryRoot: string,
  datasetFolderPath: string
): boolean {
  return isImmediateChildOf(categoryRoot, datasetFolderPath)
}

async function listDatasetRecords(): Promise<DatasetRecord[]> {
  return listAllDatasetRecordsFromLibrary()
}

async function writeNewDiscoveredDataset(opts: {
  folderPath: string
  categoryId: string
  name?: string
}): Promise<DatasetRecord> {
  const folderPath = assertAbsolutePath(opts.folderPath)
  const existing = await findRecordByFolderPath(folderPath)
  if (existing) {
    if (existing.categoryId !== opts.categoryId) {
      const next = {
        ...existing,
        categoryId: opts.categoryId,
        updatedAt: new Date().toISOString()
      }
      await writeDatasetSidecar(folderPath, next)
      registerDatasetFolder(next.id, next.folderPath)
      return next
    }
    registerDatasetFolder(existing.id, existing.folderPath)
    return existing
  }
  const now = new Date().toISOString()
  const settings = await loadSettings()
  const rememberedPrompt = settings.lastValidationPrompt.trim()
  // Don't scan every image at discovery time — stats refresh on open / enrich.
  const record = DatasetRecordSchema.parse({
    id: nanoid(),
    name: opts.name?.trim() || basename(folderPath),
    folderPath,
    categoryId: opts.categoryId,
    trigger: '',
    captionExt: 'txt',
    notes: '',
    ready: false,
    trained: false,
    validated: false,
    validationSets: [
      defaultValidationSetConfig(rememberedPrompt ? { prompt: rememberedPrompt } : {})
    ],
    createdAt: now,
    updatedAt: now,
    stats: { images: 0, captions: 0, stemCollisions: [] }
  })
  await writeDatasetSidecar(folderPath, record)
  registerDatasetFolder(record.id, record.folderPath)
  return record
}

/** Unlink dataset.json only — never delete the dataset folder. */
async function removeDatasetRecordFile(id: string): Promise<void> {
  unregisterDatasetFolder(id)
  try {
    const all = await listAllDatasetRecordsFromLibrary()
    const found = all.find((r) => r.id === id)
    if (!found) return
    await unlink(datasetSidecarPath(found.folderPath))
  } catch {
    /* already gone */
  }
}

/** Prefer earliest createdAt, then stable id — used when collapsing path duplicates. */
function preferDatasetRecord(a: DatasetRecord, b: DatasetRecord): DatasetRecord {
  const byCreated = a.createdAt.localeCompare(b.createdAt)
  if (byCreated !== 0) return byCreated < 0 ? a : b
  return a.id.localeCompare(b.id) <= 0 ? a : b
}

/**
 * Collapse multiple library JSON records that point at the same folder path.
 * Keeps one (oldest), deletes the rest. Heals races from concurrent syncs.
 */
async function dedupeRecordsByFolderPath(
  records: DatasetRecord[]
): Promise<{ records: DatasetRecord[]; pruned: number }> {
  const groups = new Map<string, DatasetRecord[]>()
  for (const r of records) {
    const key = normFolderKey(r.folderPath)
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  let pruned = 0
  const keep: DatasetRecord[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      keep.push(group[0]!)
      continue
    }
    const winner = group.reduce(preferDatasetRecord)
    keep.push(winner)
    for (const loser of group) {
      if (loser.id === winner.id) continue
      await removeDatasetRecordFile(loser.id)
      pruned++
      logger.info(
        { keepId: winner.id, removeId: loser.id, folderPath: winner.folderPath },
        'removed duplicate dataset record for same folder'
      )
    }
  }
  return { records: keep, pruned }
}

/**
 * Two folders must never share a `dataset.json` id — the explorer selects by id,
 * so a cloned folder that kept the source id lights up both tiles.
 * Keep the oldest record; assign fresh ids to the rest.
 */
async function healDuplicateDatasetIds(
  records: DatasetRecord[]
): Promise<{ records: DatasetRecord[]; healed: number }> {
  const groups = new Map<string, DatasetRecord[]>()
  for (const r of records) {
    const list = groups.get(r.id)
    if (list) list.push(r)
    else groups.set(r.id, [r])
  }

  let healed = 0
  const out: DatasetRecord[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!)
      continue
    }
    const sorted = [...group].sort((a, b) => {
      const byCreated = a.createdAt.localeCompare(b.createdAt)
      if (byCreated !== 0) return byCreated
      return normFolderKey(a.folderPath).localeCompare(normFolderKey(b.folderPath))
    })
    const winner = sorted[0]!
    out.push(winner)
    registerDatasetFolder(winner.id, winner.folderPath)
    for (const loser of sorted.slice(1)) {
      const nextId = nanoid()
      const next: DatasetRecord = {
        ...loser,
        id: nextId,
        updatedAt: new Date().toISOString()
      }
      await writeDatasetSidecar(loser.folderPath, next)
      registerDatasetFolder(nextId, next.folderPath)
      out.push(next)
      healed++
      logger.info(
        {
          oldId: loser.id,
          newId: nextId,
          folderPath: loser.folderPath,
          keptId: winner.id,
          keptFolder: winner.folderPath
        },
        'reassigned duplicate dataset id (clone/copy kept source sidecar id)'
      )
    }
  }
  return { records: out, healed }
}

async function findRecordByFolderPath(
  folderPath: string,
  records?: DatasetRecord[]
): Promise<DatasetRecord | null> {
  const key = normFolderKey(folderPath)
  const list = records ?? (await listDatasetRecords())
  return list.find((r) => normFolderKey(r.folderPath) === key) ?? null
}

/** Discover/prune datasets for one category (or all folder-backed categories). */
async function syncCategoryFolderDatasetsImpl(
  categoryId?: string,
  onProgress?: SyncProgressCallback,
  opts?: { quiet?: boolean }
): Promise<{
  upserted: number
  pruned: number
}> {
  const cats = await listCategories()
  const targets = cats.filter((c) => {
    if (!c.folderPath?.trim()) return false
    if (categoryId && c.id !== categoryId) return false
    return true
  })

  let upserted = 0
  let pruned = 0
  let records = await listDatasetRecords()

  // Heal path duplicates and shared-id clones before discovering new folders.
  {
    const deduped = await dedupeRecordsByFolderPath(records)
    pruned += deduped.pruned
    records = deduped.records
    const rekeyed = await healDuplicateDatasetIds(records)
    pruned += rekeyed.healed
    records = rekeyed.records
  }

  const totalCats = Math.max(1, targets.length)
  for (let ci = 0; ci < targets.length; ci++) {
    const cat = targets[ci]!
    onProgress?.({
      phase: 'sync',
      done: ci,
      total: totalCats,
      categoryName: cat.name,
      message: `Discovering datasets · ${cat.name}`
    })
    const result = await syncOneCategory(cat, records, (folderDone, folderTotal) => {
      onProgress?.({
        phase: 'sync',
        done: ci,
        total: totalCats,
        categoryName: cat.name,
        message:
          folderTotal > 0
            ? `Discovering · ${cat.name} · ${folderDone}/${folderTotal} folders`
            : `Discovering datasets · ${cat.name}`
      })
    })
    upserted += result.upserted
    pruned += result.pruned
    if (result.upserted || result.pruned) {
      records = await listDatasetRecords()
    }
  }

  if (targets.length > 0) {
    onProgress?.({
      phase: 'sync',
      done: totalCats,
      total: totalCats,
      categoryName: null,
      message: 'Discovery complete'
    })
  }

  // Disk walk no longer lists deleted folders, so the per-category prune above
  // often sees nothing. Diff against the previous sync + media registrations
  // so vanished folders still unregister and refresh the UI.
  const afterRecords = await listDatasetRecords()
  const afterIds = new Set(afterRecords.map((r) => r.id))
  let vanished = 0
  for (const id of lastKnownDatasetIds) {
    if (afterIds.has(id)) continue
    unregisterDatasetFolder(id)
    vanished++
  }
  for (const id of listRegisteredDatasetIds()) {
    if (afterIds.has(id)) continue
    unregisterDatasetFolder(id)
    vanished++
  }
  pruned += vanished

  const membershipChanged =
    afterIds.size !== lastKnownDatasetIds.size ||
    [...afterIds].some((id) => !lastKnownDatasetIds.has(id)) ||
    [...lastKnownDatasetIds].some((id) => !afterIds.has(id))

  lastKnownDatasetIds = afterIds

  if (!opts?.quiet && (upserted > 0 || pruned > 0 || membershipChanged)) {
    broadcast({
      type: 'category-datasets-changed',
      payload: { categoryId: categoryId ?? null }
    })
  }

  return { upserted, pruned }
}

/** Serialize syncs so watch + listDatasets cannot race-create duplicate records. */
let syncChain: Promise<unknown> = Promise.resolve()

export async function syncCategoryFolderDatasets(
  categoryId?: string,
  onProgress?: SyncProgressCallback,
  opts?: { quiet?: boolean }
): Promise<{
  upserted: number
  pruned: number
}> {
  const run = syncChain.then(
    () => syncCategoryFolderDatasetsImpl(categoryId, onProgress, opts),
    () => syncCategoryFolderDatasetsImpl(categoryId, onProgress, opts)
  )
  syncChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function syncOneCategory(
  cat: CategoryRecord,
  records: DatasetRecord[],
  onFolderProgress?: (done: number, total: number) => void
): Promise<{ upserted: number; pruned: number }> {
  let root: string
  try {
    root = assertAbsolutePath(cat.folderPath.trim())
  } catch {
    return { upserted: 0, pruned: 0 }
  }

  try {
    await access(root, constants.F_OK)
  } catch {
    return { upserted: 0, pruned: 0 }
  }

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    logger.warn({ err, root }, 'category folder readdir failed')
    return { upserted: 0, pruned: 0 }
  }

  // Immediate children only — never recurse. A dataset.json means stop: there
  // are never datasets nested inside another dataset.
  const childDirs = entries.filter(
    (e) => e.isDirectory() && isDiscoverableDatasetDirName(e.name)
  )
  const discovered = new Map<string, string>()
  let probed = 0
  const totalProbe = childDirs.length
  onFolderProgress?.(0, totalProbe)

  await mapWithConcurrency(childDirs, DISCOVERY_CONCURRENCY, async (e) => {
    const full = join(root, e.name)
    const ok = await folderIsDiscoverableDataset(full)
    probed++
    if (probed === totalProbe || probed % 4 === 0) {
      onFolderProgress?.(probed, totalProbe)
    }
    if (ok) {
      discovered.set(normFolderKey(full), resolve(full))
    }
  })
  onFolderProgress?.(totalProbe, totalProbe)

  let upserted = 0
  const byPath = new Map<string, DatasetRecord>()
  for (const r of records) {
    byPath.set(normFolderKey(r.folderPath), r)
  }

  for (const [key, folderPath] of discovered) {
    const existing = byPath.get(key)
    if (existing) {
      const folderName = basename(folderPath)
      let next = existing
      let dirty = false
      if (existing.categoryId !== cat.id) {
        next = { ...next, categoryId: cat.id }
        dirty = true
      }
      // External File Explorer renames move the folder + sidecar; heal display name.
      if (existing.name !== folderName) {
        next = { ...next, name: folderName }
        dirty = true
      }
      if (dirty) {
        next = { ...next, folderPath, updatedAt: new Date().toISOString() }
        await writeDatasetSidecar(folderPath, next)
        byPath.set(key, next)
        upserted++
      }
      registerDatasetFolder(next.id, folderPath)
      continue
    }
    const created = await writeNewDiscoveredDataset({ folderPath, categoryId: cat.id })
    byPath.set(key, created)
    upserted++
  }

  let pruned = 0
  for (const r of records) {
    if (r.categoryId !== cat.id) continue
    // Folder-backed categories only keep immediate child folders that still exist.
    // Pre-folder / out-of-tree / missing paths are removed from the library (JSON only).
    if (isImmediateChildOf(root, r.folderPath)) {
      try {
        await access(r.folderPath, constants.F_OK)
      } catch {
        await removeDatasetRecordFile(r.id)
        pruned++
      }
      continue
    }
    await removeDatasetRecordFile(r.id)
    pruned++
  }

  return { upserted, pruned }
}

/** Create an empty dataset subfolder under a folder-backed category. */
export async function createDatasetInCategory(input: {
  name: string
  categoryId: string
}): Promise<DatasetRecord> {
  const cats = await listCategories()
  const cat = cats.find((c) => c.id === input.categoryId)
  if (!cat) {
    throw appError('not-found', `Category not found: ${input.categoryId}`)
  }
  const root = cat.folderPath?.trim()
  if (!root) {
    throw appError('validation', 'This category has no folder — pick a folder first', {
      remediation: 'Open Categories… and set a folder, or pick a folder-backed category.'
    })
  }
  const folderName = sanitizeDatasetFolderName(input.name.trim() || 'dataset')
  const folderPath = assertAbsolutePath(join(assertAbsolutePath(root), folderName))
  try {
    await access(folderPath, constants.F_OK)
    throw appError('validation', `A folder already exists at: ${folderPath}`, {
      remediation: 'Choose a different dataset name.'
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'validation') {
      throw err
    }
  }
  await mkdir(folderPath, { recursive: true })
  return writeNewDiscoveredDataset({
    folderPath,
    categoryId: cat.id,
    name: folderName
  })
}

const watchers = new Map<string, FSWatcher>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function stopCategoryFolderWatches(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  for (const w of watchers.values()) {
    try {
      w.close()
    } catch {
      /* noop */
    }
  }
  watchers.clear()
}

function scheduleFullSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    // Quiet: membership-only refresh is driven by the non-quiet callers
    // (create category, rename, etc.). Watch noise must not broadcast
    // category-datasets-changed → refreshAll → full badge enrich.
    void syncCategoryFolderDatasets(undefined, undefined, { quiet: true })
      .then(() => undefined)
      .catch((err) => logger.warn({ err }, 'category folder sync failed'))
  }, 500)
}

export async function watchCategoryFolders(): Promise<void> {
  const cats = await listCategories()
  const wanted = new Set(
    cats.filter((c) => c.folderPath?.trim()).map((c) => normFolderKey(c.folderPath))
  )

  for (const [key, w] of [...watchers.entries()]) {
    if (!wanted.has(key)) {
      try {
        w.close()
      } catch {
        /* noop */
      }
      watchers.delete(key)
    }
  }

  for (const cat of cats) {
    const raw = cat.folderPath?.trim()
    if (!raw) continue
    let root: string
    try {
      root = assertAbsolutePath(raw)
    } catch {
      continue
    }
    const key = normFolderKey(root)
    if (watchers.has(key)) continue
    try {
      await access(root, constants.F_OK)
      // Immediate children only. Nested writes (output/Set N/*.jpg during
      // validation) must not schedule a library sync.
      const w = watch(root, { persistent: true, recursive: false }, (_eventType, filename) => {
        if (filename != null) {
          const name = String(filename)
          if (name.includes('/') || name.includes('\\')) return
        }
        scheduleFullSync()
      })
      w.on('error', (err) => {
        logger.warn({ err, root }, 'category folder watch error')
        watchers.delete(key)
        try {
          w.close()
        } catch {
          /* noop */
        }
      })
      watchers.set(key, w)
    } catch (err) {
      logger.warn({ err, root }, 'failed to watch category folder')
    }
  }
}
