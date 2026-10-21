import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { appError } from '@shared/errors'
import type { BulkTransformResult } from '@shared/ipc/contract'
import { jpgTargetFileName, needsConvertToJpg } from '@shared/image-convert'
import { broadcast } from '../events/bus'
import { assertInsideRoot } from '../security/path-guards'
import { getDatasetRecord, rescanDataset, scanFolder, updateDataset } from './store'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isBusyError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true
  const msg = err instanceof Error ? err.message : String(err)
  return /busy|locked|EPERM|EACCES|EBUSY/i.test(msg)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Windows often keeps dataset thumbs/previews locked briefly (EBUSY).
 * Prefer rename-away then unlink; retry a few times.
 */
async function removeSourceFile(srcPath: string): Promise<void> {
  const trashPath = `${srcPath}.__converting__`
  let lastErr: unknown

  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await sleep(40 * attempt * attempt)

    try {
      await unlink(srcPath)
      return
    } catch (err) {
      lastErr = err
      if (!isBusyError(err)) throw err
    }

    try {
      // Rename often succeeds while a delete is denied on Windows.
      if (!(await pathExists(trashPath))) {
        await rename(srcPath, trashPath)
      }
      try {
        await unlink(trashPath)
        return
      } catch (err) {
        lastErr = err
        if (!isBusyError(err)) throw err
      }
    } catch (err) {
      lastErr = err
      if (!isBusyError(err)) throw err
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'Could not remove source file'))
}

/**
 * Convert images that are not already .png/.jpg/.jpeg to .jpg (notably .webp, .bmp).
 * Captions stay on the same stem (.txt). Skips when the target .jpg already exists.
 */
export async function convertImagesToJpg(input: {
  datasetId: string
  dryRun?: boolean
  quality?: number
  /** When set, only convert these basenames (others are ignored). */
  fileNames?: string[]
}): Promise<BulkTransformResult> {
  const dryRun = Boolean(input.dryRun)
  const quality = Math.min(100, Math.max(1, input.quality ?? 92))
  const runId = `convert-jpg-${input.datasetId}`
  const ds = await getDatasetRecord(input.datasetId)
  const { images } = await scanFolder(ds.folderPath, ds.captionExt)
  const onlyNames =
    input.fileNames && input.fileNames.length > 0
      ? new Set(input.fileNames.map((n) => n.toLowerCase()))
      : null

  type WorkItem = { srcName: string; destName: string; srcPath: string; destPath: string }
  const work: WorkItem[] = []
  let skipped = 0
  const samples: BulkTransformResult['samples'] = []
  let coverFileName = ds.coverFileName ?? null

  for (const img of images) {
    if (onlyNames && !onlyNames.has(img.fileName.toLowerCase())) {
      continue
    }
    if (!needsConvertToJpg(img.fileName)) {
      skipped++
      continue
    }

    const srcName = img.fileName
    const destName = jpgTargetFileName(srcName)
    const srcPath = assertInsideRoot(ds.folderPath, join(ds.folderPath, srcName))
    const destPath = assertInsideRoot(ds.folderPath, join(ds.folderPath, destName))

    if (await pathExists(destPath)) {
      skipped++
      if (samples.length < 8) {
        samples.push({
          fileName: srcName,
          before: srcName,
          after: `${destName} (exists — skipped)`
        })
      }
      continue
    }

    if (samples.length < 8) {
      samples.push({
        fileName: srcName,
        before: srcName,
        after: destName
      })
    }
    work.push({ srcName, destName, srcPath, destPath })
  }

  if (dryRun) {
    return { changed: work.length, skipped, dryRun, samples }
  }

  if (work.length > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: `Converting 0/${work.length} to JPG…`
      }
    })
  }

  let changed = 0
  for (const item of work) {
    changed++
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: `Converting ${changed}/${work.length}: ${item.srcName}`
      }
    })
    try {
      // Read fully first so sharp does not keep a long-lived path handle.
      const inputBuf = await readFile(item.srcPath)
      const jpeg = await sharp(inputBuf)
        .rotate()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      await writeFile(item.destPath, jpeg)
      await removeSourceFile(item.srcPath)
      if (coverFileName && coverFileName.toLowerCase() === item.srcName.toLowerCase()) {
        coverFileName = item.destName
      }
    } catch (err) {
      try {
        if (await pathExists(item.destPath)) await unlink(item.destPath)
      } catch {
        /* ignore */
      }
      const busy = isBusyError(err)
      broadcast({
        type: 'tool-run-updated',
        payload: {
          runId,
          status: 'failed',
          message: `Failed on ${item.srcName}`
        }
      })
      throw appError(
        busy ? 'busy' : 'process-failed',
        `Failed to convert ${item.srcName}: ${err instanceof Error ? err.message : String(err)}`,
        {
          remediation: busy
            ? 'Close any Explorer preview of the file, deselect the image in the app, then retry.'
            : 'Check the file is a valid image, then retry.'
        }
      )
    }
  }

  if (changed > 0) {
    if (coverFileName !== (ds.coverFileName ?? null)) {
      await updateDataset({ id: input.datasetId, coverFileName })
    } else {
      await rescanDataset(input.datasetId)
    }
    const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
    await invalidateAllDatasetThumbs(input.datasetId, ds.folderPath)
  }

  broadcast({
    type: 'tool-run-updated',
    payload: {
      runId,
      status: 'complete',
      message:
        changed > 0
          ? `Converted ${changed} image(s) to JPG`
          : `No images needed conversion (${skipped} skipped)`
    }
  })

  return { changed, skipped, dryRun, samples }
}
