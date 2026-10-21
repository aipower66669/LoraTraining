/**
 * Library-wide `{file}.original` → ADS migration + settings stamp.
 * Called best-effort from app.whenReady (non-blocking).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DATASET_SIDECAR, isDiscoverableDatasetDirName } from '@shared/library-paths'
import { access, constants } from 'node:fs/promises'
import { listCategories } from '../categories/store'
import { loadSettings, patchSettings } from '../settings/store'
import { migrateOriginalSiblingsToAds } from '../images/imageEdit'
import { logger } from '../logging'

async function findDatasetFoldersUnder(dir: string, out: string[]): Promise<void> {
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
      /* keep walking nested category folders */
    }
    await findDatasetFoldersUnder(full, out)
  }
}

/**
 * Walk all category roots; migrate `.original` siblings → VER_* ADS.
 * Sets `imageVersionsAdsMigratedAt` when the pass completes with zero failures.
 */
export async function migrateLibraryOriginalsToAds(): Promise<{
  migrated: number
  skipped: number
  failed: number
}> {
  const settings = await loadSettings()
  if (!settings.imageVersionsEnabled) {
    return { migrated: 0, skipped: 0, failed: 0 }
  }
  if (settings.imageVersionsAdsMigratedAt) {
    return { migrated: 0, skipped: 0, failed: 0 }
  }

  const cats = await listCategories()
  const folders: string[] = []
  for (const cat of cats) {
    if (!cat.folderPath?.trim()) continue
    await findDatasetFoldersUnder(cat.folderPath, folders)
  }

  let migrated = 0
  let skipped = 0
  let failed = 0
  for (const folder of folders) {
    const result = await migrateOriginalSiblingsToAds(folder)
    migrated += result.migrated
    skipped += result.skipped
    failed += result.failed
  }

  if (failed === 0) {
    await patchSettings({
      imageVersionsAdsMigratedAt: new Date().toISOString()
    }).catch((err) => {
      logger.warn({ err }, 'failed to stamp imageVersionsAdsMigratedAt')
    })
  }

  logger.info(
    { migrated, skipped, failed, folders: folders.length },
    'image .original → ADS migration pass'
  )
  return { migrated, skipped, failed }
}
