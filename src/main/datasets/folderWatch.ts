import { watch, type FSWatcher } from 'node:fs'
import { extname } from 'node:path'
import { IMAGE_EXTENSIONS } from '@shared/schemas/dataset'
import { broadcast } from '../events/bus'
import { logger } from '../logging'

let watcher: FSWatcher | null = null
let watchedDatasetId: string | null = null
let watchedFolder: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let rescanInFlight = false
let pendingRescan = false
/** Ignore FS events briefly after programmatic deletes/writes so we don't fight ourselves. */
let muteUntilMs = 0

/** Suppress folder-watch rescans for a short window (e.g. after deleting an image or writing sidecars). */
export function muteDatasetFolderWatch(ms = 1200): void {
  muteUntilMs = Date.now() + ms
}

/**
 * Ignore our own sidecar / caption / temp writes. We never expect the user to
 * hand-edit dataset.json; only image add/remove should matter.
 */
function shouldIgnoreWatchFile(filename: string | null): boolean {
  if (!filename) return false
  const base = filename.replace(/^.*[/\\]/, '')
  if (!base || base.startsWith('.') || base.startsWith('!')) return true
  if (base === 'dataset.json' || base === 'category.json') return true
  const lower = base.toLowerCase()
  if (lower.endsWith('.tmp') || lower.endsWith('.upscale.json')) return true
  if (lower.endsWith('.txt')) return true
  const ext = extname(lower)
  if (IMAGE_EXTENSIONS.has(ext)) return false
  return true
}

export function stopDatasetFolderWatch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* noop */
    }
    watcher = null
  }
  watchedDatasetId = null
  watchedFolder = null
  pendingRescan = false
}

async function emitFolderChanged(datasetId: string): Promise<void> {
  if (Date.now() < muteUntilMs) return
  if (rescanInFlight) {
    pendingRescan = true
    return
  }
  rescanInFlight = true
  try {
    const { rescanDatasetIfImagesChanged } = await import('./store')
    do {
      pendingRescan = false
      if (Date.now() < muteUntilMs) break
      try {
        const result = await rescanDatasetIfImagesChanged(datasetId)
        // No UI reload unless images actually changed.
        if (!result.changed) break
      } catch (err) {
        logger.warn({ err, datasetId }, 'dataset folder rescan failed')
        break
      }
      if (Date.now() < muteUntilMs) break
      broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
    } while (pendingRescan && watchedDatasetId === datasetId)
  } finally {
    rescanInFlight = false
  }
}

function scheduleRescan(datasetId: string): void {
  if (watchedDatasetId !== datasetId) return
  if (Date.now() < muteUntilMs) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (Date.now() < muteUntilMs) return
    void emitFolderChanged(datasetId)
  }, 450)
}

/** Watch the open dataset folder for image add/remove (not dataset.json edits). */
export async function watchDatasetFolder(datasetId: string): Promise<void> {
  const { getDatasetRecord } = await import('./store')
  const r = await getDatasetRecord(datasetId)
  const folder = r.folderPath.replace(/[/\\]+$/, '')
  if (watchedDatasetId === datasetId && watchedFolder === folder && watcher) {
    return
  }

  stopDatasetFolderWatch()
  watchedDatasetId = datasetId
  watchedFolder = folder

  try {
    watcher = watch(folder, { persistent: true }, (_eventType, filename) => {
      if (shouldIgnoreWatchFile(filename != null ? String(filename) : null)) return
      if (watchedDatasetId) scheduleRescan(watchedDatasetId)
    })
    watcher.on('error', (err) => {
      logger.warn({ err, folder }, 'dataset folder watch error')
      stopDatasetFolderWatch()
    })
  } catch (err) {
    logger.warn({ err, folder }, 'failed to watch dataset folder')
    stopDatasetFolderWatch()
  }
}
