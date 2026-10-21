import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname, join } from 'node:path'
import sharp, { type FormatEnum, type Sharp } from 'sharp'
import { appError } from '@shared/errors'
import type { BulkTransformResult } from '@shared/ipc/contract'
import {
  formatShrinkSample,
  shrinkTargetSize,
  SHRINK_MIN_EDGE
} from '@shared/image-shrink'
import { broadcast } from '../events/bus'
import { assertInsideRoot } from '../security/path-guards'
import { getDatasetRecord, rescanDataset, scanFolder } from './store'

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

async function replaceFile(destPath: string, data: Buffer): Promise<void> {
  const tmpPath = `${destPath}.__shrinking__`
  await writeFile(tmpPath, data)
  let lastErr: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await sleep(40 * attempt * attempt)
    try {
      // Windows: replace in place via unlink+rename when rename-over fails.
      try {
        await rename(tmpPath, destPath)
        return
      } catch {
        if (await pathExists(destPath)) await unlink(destPath)
        await rename(tmpPath, destPath)
        return
      }
    } catch (err) {
      lastErr = err
      if (!isBusyError(err)) break
    }
  }
  try {
    await unlink(tmpPath)
  } catch {
    /* ignore */
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'Could not replace resized image'))
}

/**
 * Encode resized pixels at the highest practical quality for the source format.
 * Lanczos3 + linear light is used for the resize step (see call site).
 */
function encodeHighQuality(
  pipeline: Sharp,
  format: string | undefined,
  ext: string
): Sharp {
  const kind = (format ?? ext.replace(/^\./, '')).toLowerCase()
  if (kind === 'jpeg' || kind === 'jpg' || ext === '.jpg' || ext === '.jpeg') {
    return pipeline.jpeg({
      quality: 98,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
      trellisQuantisation: true,
      overshootDeringing: true,
      optimiseScans: true
    })
  }
  if (kind === 'png' || ext === '.png') {
    return pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false
    })
  }
  if (kind === 'webp' || ext === '.webp') {
    return pipeline.webp({
      quality: 98,
      alphaQuality: 100,
      smartSubsample: false,
      effort: 6
    })
  }
  if (kind === 'tiff' || kind === 'tif' || ext === '.tif' || ext === '.tiff') {
    return pipeline.tiff({ quality: 98, compression: 'lzw' })
  }
  // Fall back to original format with max quality where supported.
  return pipeline.toFormat(kind as keyof FormatEnum, { quality: 98 })
}

function formatCountProgress(verb: string, done: number, total: number): string {
  if (total <= 0) return `${verb}…`
  const pct = Math.min(100, Math.round((done / total) * 100))
  return `${verb} ${done}/${total} (${pct}%)`
}

/** Let the renderer paint status updates between heavy sharp work. */
async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Shrink dataset images so the shortest edge is exactly {@link SHRINK_MIN_EDGE}.
 * Does not enlarge. Preserves aspect ratio (longer side stays ≥ 1024) and file name/format.
 */
export async function shrinkImagesToMax(input: {
  datasetId: string
  dryRun?: boolean
  minEdge?: number
}): Promise<BulkTransformResult> {
  const dryRun = Boolean(input.dryRun)
  const minEdge = input.minEdge ?? SHRINK_MIN_EDGE
  const runId = `shrink-${input.datasetId}`
  const ds = await getDatasetRecord(input.datasetId)
  const { images } = await scanFolder(ds.folderPath, ds.captionExt)

  type WorkItem = {
    fileName: string
    srcPath: string
    ext: string
    inputBuf: Buffer
    format: string | undefined
    width: number
    height: number
    target: { width: number; height: number }
  }

  const work: WorkItem[] = []
  let skipped = 0
  const samples: BulkTransformResult['samples'] = []
  const totalScan = images.length

  if (!dryRun && totalScan > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: formatCountProgress('Checking', 0, totalScan)
      }
    })
    await yieldToUi()
  }

  let scanned = 0
  for (const img of images) {
    scanned++
    if (!dryRun && (scanned === 1 || scanned === totalScan || scanned % 5 === 0)) {
      broadcast({
        type: 'tool-run-updated',
        payload: {
          runId,
          status: 'running',
          message: formatCountProgress('Checking', scanned, totalScan)
        }
      })
      await yieldToUi()
    }

    const fileName = img.fileName
    const srcPath = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
    const ext = extname(fileName).toLowerCase()

    let inputBuf: Buffer
    let width = 0
    let height = 0
    let format: string | undefined
    try {
      inputBuf = await readFile(srcPath)
      // rotate() applies EXIF orientation so width/height match display pixels.
      const meta = await sharp(inputBuf).rotate().metadata()
      width = meta.width ?? 0
      height = meta.height ?? 0
      format = meta.format
    } catch (err) {
      throw appError(
        'process-failed',
        `Failed to read ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
        { remediation: 'Check the file is a valid image, then retry.' }
      )
    }

    const target = shrinkTargetSize(width, height, minEdge)
    if (!target) {
      skipped++
      continue
    }

    if (samples.length < 8) {
      const sample = formatShrinkSample({ width, height }, target)
      samples.push({
        fileName,
        before: sample.before,
        after: sample.after
      })
    }

    work.push({ fileName, srcPath, ext, inputBuf, format, width, height, target })
  }

  if (dryRun) {
    return { changed: work.length, skipped, dryRun, samples }
  }

  const totalWork = work.length
  if (totalWork > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: formatCountProgress('Shrinking', 0, totalWork)
      }
    })
    await yieldToUi()
  }

  let changed = 0
  for (const item of work) {
    changed++
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: formatCountProgress('Shrinking', changed, totalWork)
      }
    })
    await yieldToUi()
    try {
      let pipeline = sharp(item.inputBuf, {
        failOn: 'none',
        // Full-precision pipeline for best downsample quality.
        limitInputPixels: false
      })
        .rotate()
        .resize({
          width: item.target.width,
          height: item.target.height,
          fit: 'fill',
          // Lanczos3 is the highest-quality kernel sharp offers for downscaling.
          kernel: sharp.kernel.lanczos3,
          // Avoid JPEG shrink-on-load shortcuts that reduce resize quality.
          fastShrinkOnLoad: false
        })
        .toColourspace('srgb')

      pipeline = encodeHighQuality(pipeline, item.format, item.ext)
      const out = await pipeline.toBuffer()
      await replaceFile(item.srcPath, out)
    } catch (err) {
      const busy = isBusyError(err)
      broadcast({
        type: 'tool-run-updated',
        payload: {
          runId,
          status: 'failed',
          message: `Failed on ${item.fileName}`
        }
      })
      throw appError(
        busy ? 'busy' : 'process-failed',
        `Failed to shrink ${item.fileName}: ${err instanceof Error ? err.message : String(err)}`,
        {
          remediation: busy
            ? 'Close any Explorer preview of the file, deselect the image in the app, then retry.'
            : 'Check the file is a valid image, then retry.'
        }
      )
    }
  }

  if (changed > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: `Shrunk ${changed}/${totalWork} (100%) — refreshing…`
      }
    })
    await yieldToUi()
    const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
    const dsForThumbs = await getDatasetRecord(input.datasetId)
    await invalidateAllDatasetThumbs(input.datasetId, dsForThumbs.folderPath)
    await rescanDataset(input.datasetId)
  }

  broadcast({
    type: 'tool-run-updated',
    payload: {
      runId,
      status: 'complete',
      message:
        changed > 0
          ? `Shrunk ${changed}/${totalWork} (100%) · ${skipped} skipped`
          : `No images needed shrinking (${skipped} already ≤ 1024px short edge)`
    }
  })

  return { changed, skipped, dryRun, samples }
}
