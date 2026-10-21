/**
 * IN-PLACE migration: strip the now-obsolete `upscaleConfig` field from every
 * `dataset.json` sidecar under the library. Upscale field values now live in
 * library `settings.json` → `lastUpscaleConfig` (D16), not on the dataset.
 *
 * Idempotent: only rewrites sidecars that still have `upscaleConfig`.
 *
 * Usage: npm run migrate:remove-dataset-upscale-config
 *    or: npx tsx scripts/migrate-remove-dataset-upscale-config.ts [--dry-run]
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATASET_SIDECAR, isDiscoverableDatasetDirName } from '../src/shared/library-paths'
import { DatasetRecordSchema } from '../src/shared/schemas/dataset'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

/** Recursively find every dataset.json under root, skipping hidden/`!` dirs. */
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
      /* not a dataset folder itself — keep walking for nested category groups */
    }
    await findDatasetSidecars(full, out)
  }
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
  let failed = 0

  for (const sidecar of sidecars) {
    try {
      const raw = JSON.parse(await readFile(sidecar, 'utf8')) as Record<string, unknown>
      if (raw.upscaleConfig === undefined) {
        skipped++
        continue
      }
      // Current schema no longer has `upscaleConfig`, so parsing already drops it.
      const parsed = DatasetRecordSchema.parse({ ...raw, folderPath: '' })
      const { folderPath: _omit, ...rest } = parsed
      const next = { version: 1, ...rest }
      console.log(`[update] ${sidecar}`)
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
  console.error('Migration failed:', err)
  process.exit(1)
})
