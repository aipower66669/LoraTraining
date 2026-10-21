/**
 * IN-PLACE migration: `{file}.original` siblings → NTFS version ADS
 * (`$DATA` = pristine, `VER_1` = previous live bytes, `VER_COUNT=1`).
 *
 * Idempotent. Skips non-NTFS volumes. Soft-fails per file.
 *
 * Usage: npm run migrate:originals-to-ads
 *    or: npx tsx scripts/migrate-originals-to-ads.ts [--dry-run]
 *
 * Note: this migration intentionally rewrites image bytes / ADS (exception to
 * the usual “JSON sidecars only” rule) — required so Edit Image can read older originals.
 */
import { access, constants, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { DATASET_SIDECAR, isDiscoverableDatasetDirName } from '../src/shared/library-paths'
import { IMAGE_EXTENSIONS } from '../src/shared/schemas/dataset'
import {
  IMAGE_VER_COUNT_STREAM,
  originalSiblingFileName,
  verStreamName
} from '../src/shared/imageEdit'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

async function findDatasetFolders(dir: string, out: string[]): Promise<void> {
  let entries
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
      await access(sidecar, constants.F_OK)
      out.push(full)
    } catch {
      /* keep walking */
    }
    await findDatasetFolders(full, out)
  }
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  if (!root) {
    console.error('No libraryRoot — set AppData app-config.json or LORA_LIBRARY_ROOT')
    process.exit(1)
  }

  // Avoid importing electron-bound imageEdit — use ADS primitives directly.
  const { pathIsNtfs } = await import('../src/main/fs/ntfs')
  const { writeStreamBytes, streamExists, readStreamText } = await import(
    '../src/main/fs/adsWin32'
  )
  const { parseVerCount } = await import('../src/shared/imageEdit')

  async function readVerCount(file: string): Promise<number> {
    if (process.platform !== 'win32') return 0
    try {
      if (!streamExists(file, IMAGE_VER_COUNT_STREAM)) return 0
      return parseVerCount(await readStreamText(file, IMAGE_VER_COUNT_STREAM))
    } catch {
      return 0
    }
  }

  const folders: string[] = []
  await findDatasetFolders(root, folders)

  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const folder of folders) {
    let entries: string[]
    try {
      entries = await readdir(folder)
    } catch {
      continue
    }
    const originals = entries.filter((n) => n.toLowerCase().endsWith('.original'))
    for (const origName of originals) {
      const liveName = origName.slice(0, -'.original'.length)
      if (!liveName || !IMAGE_EXTENSIONS.has(extname(liveName).toLowerCase())) {
        skipped += 1
        continue
      }
      const live = join(folder, liveName)
      const sib = join(folder, origName)
      try {
        await access(live, constants.F_OK)
        await access(sib, constants.F_OK)
      } catch {
        skipped += 1
        continue
      }

      if (!pathIsNtfs(live)) {
        if (DRY_RUN) console.log(`[dry-run] skip non-NTFS ${live}`)
        skipped += 1
        continue
      }

      try {
        const existing = await readVerCount(live)
        if (existing >= 1) {
          if (!DRY_RUN) await unlink(sib).catch(() => undefined)
          skipped += 1
          continue
        }

        if (DRY_RUN) {
          console.log(`[dry-run] would migrate ${live} ← ${originalSiblingFileName(liveName)}`)
          migrated += 1
          continue
        }

        const liveBytes = await readFile(live)
        const originalBytes = await readFile(sib)
        const tmp = `${live}.lt-migrate.tmp`
        await writeFile(tmp, originalBytes)
        await rename(tmp, live)
        await writeStreamBytes(live, verStreamName(1), liveBytes)
        await writeStreamBytes(live, IMAGE_VER_COUNT_STREAM, Buffer.from('1', 'utf8'))
        await unlink(sib).catch(() => undefined)
        migrated += 1
      } catch (e) {
        failed += 1
        console.error(`failed ${live}:`, e instanceof Error ? e.message : e)
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        libraryRoot: root,
        datasetFolders: folders.length,
        migrated,
        skipped,
        failed
      },
      null,
      2
    )
  )

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
