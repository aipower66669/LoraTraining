import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { thumbnailsDir } from '@shared/library-paths'
import { atomicWriteJson } from '../security/atomic-write'
import { logger } from '../logging'

/** UI thumbnail: shortest edge → 200px, then center-crop to 200×200. */
export const THUMB_EDGE = 200

type ThumbMeta = {
  sourceName: string
  size: number
  mtimeMs: number
  /** Tip ADS cache key — changes when VER_* tip updates without $DATA mtime change. */
  tipKey?: string
}

async function setHiddenWindows(dir: string): Promise<void> {
  if (process.platform !== 'win32') return
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    await execFileAsync('attrib', ['+H', dir])
  } catch {
    /* best-effort */
  }
}

function thumbsRoot(datasetFolder: string): string {
  return thumbnailsDir(datasetFolder)
}

function thumbKey(fileName: string): string {
  return createHash('sha1').update(fileName).digest('hex').slice(0, 20)
}

function thumbPaths(
  datasetFolder: string,
  fileName: string
): { jpg: string; meta: string; dir: string } {
  const key = thumbKey(fileName)
  const dir = thumbsRoot(datasetFolder)
  return {
    dir,
    jpg: join(dir, `${key}.jpg`),
    meta: join(dir, `${key}.json`)
  }
}

/** Parse thumb sidecar JSON (exported for tests). */
export function parseThumbMeta(raw: unknown): ThumbMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<ThumbMeta>
  if (
    typeof o.sourceName !== 'string' ||
    typeof o.size !== 'number' ||
    typeof o.mtimeMs !== 'number'
  ) {
    return null
  }
  return {
    sourceName: o.sourceName,
    size: o.size,
    mtimeMs: o.mtimeMs,
    tipKey: typeof o.tipKey === 'string' ? o.tipKey : undefined
  }
}

async function readMeta(metaPath: string): Promise<ThumbMeta | null> {
  try {
    return parseThumbMeta(JSON.parse(await readFile(metaPath, 'utf8')))
  } catch {
    /* missing / corrupt */
  }
  return null
}

async function generateThumbJpeg(sourcePath: string): Promise<Buffer> {
  const input = await readFile(sourcePath)
  return sharp(input, { failOn: 'none', limitInputPixels: false })
    .rotate()
    .resize({
      width: THUMB_EDGE,
      height: THUMB_EDGE,
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false
    })
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer()
}

async function ensureThumbDir(datasetFolder: string): Promise<string> {
  const dir = thumbsRoot(datasetFolder)
  await mkdir(dir, { recursive: true })
  await setHiddenWindows(dir)
  return dir
}

/**
 * Ensure a 200×200 center-cropped thumb exists and matches the source size/mtime.
 * Returns JPEG bytes ready to serve.
 * `opts.cacheKey` includes tip ADS identity so edits invalidate without $DATA mtime change.
 */
export async function ensureDatasetThumb(
  datasetId: string,
  sourcePath: string,
  fileName: string,
  datasetFolder: string,
  opts?: { cacheKey?: string }
): Promise<Buffer> {
  void datasetId
  const tipKey = opts?.cacheKey ?? ''
  const st = await stat(sourcePath)
  const { jpg, meta } = thumbPaths(datasetFolder, fileName)
  const existing = await readMeta(meta)
  if (
    existing &&
    existing.sourceName === fileName &&
    existing.size === st.size &&
    existing.mtimeMs === st.mtimeMs &&
    (existing.tipKey ?? '') === tipKey
  ) {
    try {
      return await readFile(jpg)
    } catch {
      /* regenerate */
    }
  }

  await ensureThumbDir(datasetFolder)
  const data = await generateThumbJpeg(sourcePath)
  await writeFile(jpg, data)
  await atomicWriteJson(meta, {
    sourceName: fileName,
    size: st.size,
    mtimeMs: st.mtimeMs,
    tipKey: tipKey || undefined
  } satisfies ThumbMeta)
  return data
}

export async function invalidateDatasetThumb(
  datasetId: string,
  fileName: string,
  datasetFolder: string
): Promise<void> {
  void datasetId
  const { jpg, meta } = thumbPaths(datasetFolder, fileName)
  await unlink(jpg).catch(() => undefined)
  await unlink(meta).catch(() => undefined)
}

export async function invalidateAllDatasetThumbs(
  datasetId: string,
  datasetFolder: string
): Promise<void> {
  void datasetId
  await rm(thumbsRoot(datasetFolder), { recursive: true, force: true }).catch(() => undefined)
}

/** Best-effort background warm so scrolling a large grid feels instant. Uses tip ADS when present. */
export function warmDatasetThumbs(
  datasetId: string,
  folderPath: string,
  fileNames: string[],
  concurrency = 4
): void {
  let i = 0
  let active = 0
  const next = (): void => {
    while (active < concurrency && i < fileNames.length) {
      const fileName = fileNames[i++]!
      active++
      const hostPath = join(folderPath, fileName)
      void (async () => {
        try {
          const { resolveImageAdsStream } = await import('../images/imageEdit')
          const resolved = await resolveImageAdsStream(hostPath, undefined)
          await ensureDatasetThumb(datasetId, resolved.openPath, fileName, folderPath, {
            cacheKey: resolved.cacheKey
          })
        } catch (err) {
          logger.warn({ err, fileName, datasetId }, 'thumb warm failed')
        } finally {
          active--
          next()
        }
      })()
    }
  }
  next()
}
