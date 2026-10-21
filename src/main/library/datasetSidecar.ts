import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatasetRecordSchema, type DatasetRecord } from '@shared/schemas/dataset'
import { datasetSidecarPath, isDiscoverableDatasetDirName } from '@shared/library-paths'
import { atomicWriteJson } from '../security/atomic-write'
import { listCategories } from '../categories/store'
import { mapWithConcurrency } from '../util/concurrency'

/** Bounded so a library with hundreds of datasets doesn't open that many fds/network handles at once. */
const SIDECAR_READ_CONCURRENCY = 12

/** Persist dataset sidecar (folderPath is derived from location — not written). */
export async function writeDatasetSidecar(
  datasetFolder: string,
  record: DatasetRecord
): Promise<void> {
  try {
    const { muteDatasetFolderWatch } = await import('../datasets/folderWatch')
    muteDatasetFolderWatch(2000)
  } catch {
    /* optional */
  }
  const { folderPath: _omit, ...rest } = record
  await atomicWriteJson(datasetSidecarPath(datasetFolder), {
    version: 1,
    ...rest
  })
}

export async function readDatasetSidecar(datasetFolder: string): Promise<DatasetRecord> {
  const raw = JSON.parse(await readFile(datasetSidecarPath(datasetFolder), 'utf8'))
  return DatasetRecordSchema.parse({
    ...raw,
    folderPath: datasetFolder
  })
}

/**
 * Reads every `dataset.json` sidecar across the whole library. Used for listing
 * and as a fallback when a dataset id is not yet registered in the folder map.
 * Prefer `getRegisteredFolder` + `readDatasetSidecar` on hot single-dataset paths.
 */
export async function listAllDatasetRecordsFromLibrary(): Promise<DatasetRecord[]> {
  const cats = await listCategories()
  const perCategory = await mapWithConcurrency(cats, SIDECAR_READ_CONCURRENCY, async (cat) => {
    if (!cat.folderPath) return []
    let entries: string[] = []
    try {
      entries = await readdir(cat.folderPath)
    } catch {
      return []
    }
    const names = entries.filter(isDiscoverableDatasetDirName)
    const records = await mapWithConcurrency(names, SIDECAR_READ_CONCURRENCY, async (name) => {
      const folder = join(cat.folderPath, name)
      try {
        const record = await readDatasetSidecar(folder)
        return { ...record, folderPath: folder, categoryId: cat.id }
      } catch {
        // no sidecar yet — discovery will create
        return null
      }
    })
    return records.filter((r): r is DatasetRecord => r !== null)
  })
  return perCategory.flat()
}

export async function findDatasetRecordById(id: string): Promise<DatasetRecord | null> {
  const all = await listAllDatasetRecordsFromLibrary()
  return all.find((r) => r.id === id) ?? null
}
