/**
 * IN-PLACE migration: move Create-New-Dataset source flags from `{file}.spawned`
 * sibling markers into `dataset.json` → `spawnedFromImages`, then delete the
 * marker files.
 *
 * Also ensures every sidecar has `spawnedFromImages` (defaults to `[]`).
 * Idempotent. Only lists dataset-folder dirents for `*.spawned` markers — does
 * not open image bytes.
 *
 * Usage: npm run migrate:spawned-from-images
 *    or: npx tsx scripts/migrate-spawned-from-images.ts [--dry-run]
 */
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DATASET_SIDECAR, isDiscoverableDatasetDirName } from '../src/shared/library-paths'
import { DatasetRecordSchema } from '../src/shared/schemas/dataset'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')
const SPAWNED_SUFFIX = '.spawned'

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

/** Collect image file names that have a `{fileName}.spawned` sibling. */
async function collectSpawnedMarkers(
  datasetDir: string
): Promise<{ fileNames: string[]; markerPaths: string[] }> {
  const fileNames: string[] = []
  const markerPaths: string[] = []
  let names: string[]
  try {
    names = await readdir(datasetDir)
  } catch {
    return { fileNames, markerPaths }
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(SPAWNED_SUFFIX)) continue
    const imageName = name.slice(0, -SPAWNED_SUFFIX.length)
    if (!imageName) continue
    markerPaths.push(join(datasetDir, name))
    fileNames.push(imageName)
  }
  return { fileNames, markerPaths }
}

function mergeSpawned(existing: unknown, fromMarkers: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string): void => {
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    out.push(name)
  }
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string') push(item)
    }
  }
  for (const name of fromMarkers) push(name)
  return out
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  console.log('Library root:', root)
  console.log('Dry run:     ', DRY_RUN)

  const sidecars: string[] = []
  await findDatasetSidecars(root, sidecars)
  console.log(`Found ${sidecars.length} dataset.json sidecar(s).`)

  let updated = 0
  let skipped = 0
  let markersRemoved = 0
  let failed = 0

  for (const sidecar of sidecars) {
    try {
      const datasetDir = dirname(sidecar)
      const raw = JSON.parse(await readFile(sidecar, 'utf8')) as Record<string, unknown>
      const { fileNames: fromMarkers, markerPaths } = await collectSpawnedMarkers(datasetDir)
      if (fromMarkers.length === 0 && markerPaths.length === 0) {
        // Zod defaults missing `spawnedFromImages` to [] — no need to rewrite.
        skipped++
        continue
      }

      const merged = mergeSpawned(raw.spawnedFromImages, fromMarkers)
      const hadField = Array.isArray(raw.spawnedFromImages)
      const sameList =
        hadField &&
        merged.length === (raw.spawnedFromImages as unknown[]).length &&
        merged.every(
          (n, i) =>
            typeof (raw.spawnedFromImages as unknown[])[i] === 'string' &&
            ((raw.spawnedFromImages as string[])[i] ?? '').toLowerCase() === n.toLowerCase()
        )

      if (sameList && markerPaths.length === 0) {
        skipped++
        continue
      }

      const parsed = DatasetRecordSchema.parse({
        ...raw,
        folderPath: typeof raw.folderPath === 'string' ? raw.folderPath : '',
        spawnedFromImages: merged
      })
      const { folderPath: _omit, ...rest } = parsed
      const next = { version: 1, ...rest }
      console.log(
        `[update] ${sidecar} (spawnedFromImages=${merged.length}, markers=${markerPaths.length})`
      )
      if (!DRY_RUN) {
        await writeFile(sidecar, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
        for (const marker of markerPaths) {
          await unlink(marker).catch(() => undefined)
          markersRemoved++
        }
      } else {
        markersRemoved += markerPaths.length
      }
      updated++
    } catch (err) {
      failed++
      console.error(`[error] ${sidecar}:`, err)
    }
  }

  console.log('Done.', { updated, skipped, markersRemoved, failed, dryRun: DRY_RUN })
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
