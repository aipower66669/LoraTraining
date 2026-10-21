/**
 * IN-PLACE migration: set sticky `trained: true` on dataset.json sidecars when:
 * - any job for that dataset has status `complete`, or
 * - the dataset is already `validated` (implies training output existed).
 *
 * Does not scan `output/` trees. Idempotent.
 *
 * Usage: npm run migrate:dataset-trained
 *    or: npx tsx scripts/migrate-dataset-trained.ts [--dry-run]
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DATASET_SIDECAR,
  JOBS_DIR,
  isDiscoverableDatasetDirName
} from '../src/shared/library-paths'
import { DatasetRecordSchema } from '../src/shared/schemas/dataset'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

async function findDatasetSidecars(dir: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isDiscoverableDatasetDirName(entry.name)) continue
    const full = join(dir, entry.name)
    const sidecar = join(full, DATASET_SIDECAR)
    try {
      await stat(sidecar)
      out.push(sidecar)
    } catch {
      /* keep walking */
    }
    await findDatasetSidecars(full, out)
  }
}

async function datasetIdsWithCompleteJobs(libraryRoot: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const jobsRoot = join(libraryRoot, JOBS_DIR)
  let dirs: Awaited<ReturnType<typeof readdir>>
  try {
    dirs = await readdir(jobsRoot, { withFileTypes: true })
  } catch {
    return ids
  }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    const jobPath = join(jobsRoot, entry.name, 'job.json')
    try {
      const raw = JSON.parse(await readFile(jobPath, 'utf8')) as {
        status?: string
        datasetId?: string
      }
      if (raw.status === 'complete' && typeof raw.datasetId === 'string' && raw.datasetId) {
        ids.add(raw.datasetId)
      }
    } catch {
      /* skip bad job */
    }
  }
  return ids
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  console.log('Library root:', root)
  console.log('Dry run:     ', DRY_RUN)

  const completeDatasetIds = await datasetIdsWithCompleteJobs(root)
  console.log(`Datasets with complete job(s): ${completeDatasetIds.size}`)

  const sidecars: string[] = []
  await findDatasetSidecars(root, sidecars)
  console.log(`Found ${sidecars.length} dataset.json sidecar(s).`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const sidecar of sidecars) {
    try {
      const raw = JSON.parse(await readFile(sidecar, 'utf8')) as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id : ''
      const already = raw.trained === true
      const fromJob = id !== '' && completeDatasetIds.has(id)
      const fromValidated = raw.validated === true
      if (already || (!fromJob && !fromValidated)) {
        skipped++
        continue
      }
      const parsed = DatasetRecordSchema.parse({
        ...raw,
        folderPath: typeof raw.folderPath === 'string' ? raw.folderPath : '',
        trained: true
      })
      const { folderPath: _omit, ...rest } = parsed
      const next = { version: 1, ...rest, trained: true }
      console.log(
        `[update] ${sidecar}${fromJob ? ' (complete job)' : ''}${fromValidated && !fromJob ? ' (validated)' : ''}`
      )
      if (!DRY_RUN) {
        await writeFile(sidecar, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      }
      updated++
    } catch (err) {
      failed++
      console.error(`[error] ${sidecar}:`, err)
    }
  }

  console.log('Done.', { updated, skipped, failed, dryRun: DRY_RUN })
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
