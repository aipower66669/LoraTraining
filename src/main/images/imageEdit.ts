/**
 * In-app image edit / upscale version history — MyFileExplorer D27 ADS contract.
 * NTFS: `$DATA` = pristine; `VER_1…VER_4` + `VER_COUNT` = tip edits.
 * Non-NTFS: overwrite `$DATA` in place.
 */
import {
  access,
  constants,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { appError } from '@shared/errors'
import {
  IMAGE_VER_COUNT_STREAM,
  IMAGE_VER_MAX,
  imageExt,
  isEditableImagePath,
  isImageVersionStreamName,
  isSaveAsImagePath,
  originalSiblingFileName,
  parseVerCount,
  renumberAfterDrop,
  renumberAfterShiftOldest,
  sharpFormatForExt,
  shouldUseImageVersions,
  tipVersionFromStreamNames,
  verStreamName
} from '@shared/imageEdit'
import { IMAGE_EXTENSIONS } from '@shared/schemas/dataset'
import { buildStreamPath } from '@shared/ads/paths'
import {
  copyStreams,
  deleteStream,
  listStreamNames,
  listStreams,
  readStreamBytes,
  readStreamText,
  streamExists,
  writeStreamBytes
} from '../fs/adsWin32'
import { pathIsNtfs } from '../fs/ntfs'
import { getDatasetRecord } from '../datasets/store'
import { muteDatasetFolderWatch } from '../datasets/folderWatch'
import { broadcast } from '../events/bus'
import { assertInsideRoot } from '../security/path-guards'
import { mapWithConcurrency } from '../util/concurrency'
import { logger } from '../logging'

export type ImageEditState = {
  versionCount: number
  tipVer: number
  hasVersions: boolean
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function assertValidImageFileName(fileName: string): string {
  const base = basename(fileName)
  if (
    base !== fileName ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    throw appError('validation', 'Invalid image file name')
  }
  const ext = extname(base).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw appError('validation', `Not an image file: ${base}`)
  }
  return base
}

function stripDataUrl(dataBase64: string): Buffer {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataBase64)
  if (m) return Buffer.from(m[2]!, 'base64')
  return Buffer.from(dataBase64, 'base64')
}

function mimeForImagePath(file: string): string {
  const ext = imageExt(file)
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif' || ext === 'bmp') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff'
  return 'application/octet-stream'
}

export function pathSupportsImageVersions(absPath: string): boolean {
  return pathIsNtfs(absPath)
}

export async function readVerCount(file: string): Promise<number> {
  if (process.platform !== 'win32') return 0
  try {
    if (!streamExists(file, IMAGE_VER_COUNT_STREAM)) return 0
    const text = await readStreamText(file, IMAGE_VER_COUNT_STREAM)
    return parseVerCount(text)
  } catch {
    return 0
  }
}

async function writeVerCount(file: string, count: number): Promise<void> {
  if (count <= 0) {
    if (streamExists(file, IMAGE_VER_COUNT_STREAM)) deleteStream(file, IMAGE_VER_COUNT_STREAM)
    return
  }
  await writeStreamBytes(file, IMAGE_VER_COUNT_STREAM, Buffer.from(String(count), 'utf8'))
}

async function deleteAllVersionStreams(file: string): Promise<void> {
  const count = await readVerCount(file)
  for (let i = 1; i <= Math.max(count, IMAGE_VER_MAX); i++) {
    const name = verStreamName(i)
    if (streamExists(file, name)) {
      try {
        deleteStream(file, name)
      } catch {
        /* continue */
      }
    }
  }
  try {
    for (const s of listStreams(file)) {
      if (isImageVersionStreamName(s.name) && streamExists(file, s.name)) {
        try {
          deleteStream(file, s.name)
        } catch {
          /* continue */
        }
      }
    }
  } catch {
    /* soft */
  }
  if (streamExists(file, IMAGE_VER_COUNT_STREAM)) {
    try {
      deleteStream(file, IMAGE_VER_COUNT_STREAM)
    } catch {
      /* soft */
    }
  }
}

async function shiftVersionsDown(file: string, count: number): Promise<void> {
  const { map, newCount } = renumberAfterShiftOldest(count)
  const buffers = new Map<number, Buffer>()
  for (const [oldVer, newVer] of map) {
    const buf = await readStreamBytes(file, verStreamName(oldVer))
    if (buf) buffers.set(newVer, buf)
  }
  for (let i = 1; i <= count; i++) {
    const name = verStreamName(i)
    if (streamExists(file, name)) {
      try {
        deleteStream(file, name)
      } catch {
        /* continue */
      }
    }
  }
  for (const [newVer, buf] of buffers) {
    await writeStreamBytes(file, verStreamName(newVer), buf)
  }
  await writeVerCount(file, newCount)
}

async function encodeRawImageBuffer(destFile: string, bytes: Buffer): Promise<Buffer> {
  if (bytes.length === 0) throw appError('validation', 'Empty image data')
  const ext = imageExt(destFile)
  const format = sharpFormatForExt(ext)
  if (!format) {
    throw appError('validation', `Unsupported image format: .${ext || '?'}`)
  }
  const { default: sharp } = await import('sharp')
  try {
    let pipeline = sharp(bytes, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 })
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true })
    else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8 })
    else if (format === 'webp') pipeline = pipeline.webp({ quality: 90 })
    else if (format === 'tiff') pipeline = pipeline.tiff()
    else if (format === 'gif') pipeline = pipeline.gif()
    else if (format === 'avif') pipeline = pipeline.avif({ quality: 80 })
    else pipeline = pipeline.toFormat(format)
    return await pipeline.toBuffer()
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) throw e
    throw appError(
      'process-failed',
      e instanceof Error ? e.message : 'Failed to encode edited image'
    )
  }
}

async function encodeEditedBuffer(destFile: string, dataBase64: string): Promise<Buffer> {
  return encodeRawImageBuffer(destFile, stripDataUrl(dataBase64))
}

/**
 * Write tip ADS only when the opt-in is enabled and the file is on NTFS.
 * Otherwise overwrite the image body and clear any old version streams.
 * Also used by Upscale for result swap-in.
 */
export async function writeEncodedImageBytes(
  file: string,
  encoded: Buffer,
  imageVersionsEnabled: boolean
): Promise<{ path: string; preservedOriginal: boolean; versionCount: number }> {
  const useAds = shouldUseImageVersions(imageVersionsEnabled, pathSupportsImageVersions(file))
  muteDatasetFolderWatch(2000)

  if (!useAds) {
    const tmp = `${file}.lt-edit.tmp`
    try {
      await writeFile(tmp, encoded)
      await rename(tmp, file)
      await deleteAllVersionStreams(file)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      if (e && typeof e === 'object' && 'code' in e) throw e
      throw appError(
        'process-failed',
        e instanceof Error ? e.message : 'Failed to save edited image'
      )
    }
    return { path: file, preservedOriginal: false, versionCount: 0 }
  }

  let count = await readVerCount(file)
  const preservedOriginal = count === 0

  try {
    if (count >= IMAGE_VER_MAX) {
      await shiftVersionsDown(file, count)
      count = IMAGE_VER_MAX - 1
    }
    const next = count + 1
    await writeStreamBytes(file, verStreamName(next), encoded)
    await writeVerCount(file, next)
    return { path: file, preservedOriginal, versionCount: next }
  } catch {
    const tmp = `${file}.lt-edit.tmp`
    try {
      await writeFile(tmp, encoded)
      await rename(tmp, file)
      await deleteAllVersionStreams(file)
      return { path: file, preservedOriginal: false, versionCount: 0 }
    } catch (e2) {
      await unlink(tmp).catch(() => undefined)
      if (e2 && typeof e2 === 'object' && 'code' in e2) throw e2
      throw appError(
        'process-failed',
        e2 instanceof Error ? e2.message : 'Failed to save edited image'
      )
    }
  }
}

async function resolveDatasetImage(
  datasetId: string,
  fileName: string
): Promise<{ file: string; folderPath: string; fileName: string }> {
  const base = assertValidImageFileName(fileName)
  const ds = await getDatasetRecord(datasetId)
  const file = assertInsideRoot(ds.folderPath, join(ds.folderPath, base))
  if (!(await fileExists(file))) {
    throw appError('not-found', `Image not found: ${base}`)
  }
  if (!isEditableImagePath(file)) {
    throw appError('validation', 'This image type cannot be edited in-app')
  }
  return { file, folderPath: ds.folderPath, fileName: base }
}

/**
 * Resolve which bytes to show/edit.
 * - `ads === undefined` → tip (`VER_{count}`) or `$DATA` when count=0
 * - `ads === null` → `$DATA` (original)
 * - `ads === 'VER_k'` → that version stream
 */
export async function resolveImageAdsStream(
  absFile: string,
  ads?: string | null
): Promise<{
  file: string
  openPath: string
  ads: string | null
  versionCount: number
  cacheKey: string
}> {
  let st
  try {
    st = await stat(absFile)
  } catch {
    throw appError('not-found', 'File not found')
  }
  if (!st.isFile()) throw appError('validation', 'Not a file')

  const versionCount = await readVerCount(absFile)
  let resolved: string | null
  if (ads === null) {
    resolved = null
  } else if (typeof ads === 'string') {
    const name = ads.trim()
    if (!name || name.toUpperCase() === '$DATA') resolved = null
    else resolved = name
  } else if (versionCount >= 1) {
    resolved = verStreamName(versionCount)
  } else {
    resolved = null
  }

  let openPath = absFile
  let streamSize = st.size
  if (resolved) {
    openPath = buildStreamPath(absFile, resolved)
    try {
      const sst = await stat(openPath)
      streamSize = sst.size
    } catch {
      /* cache key fallback */
    }
  }

  return {
    file: absFile,
    openPath,
    ads: resolved,
    versionCount,
    cacheKey: `${st.mtimeMs}-${st.size}-v${versionCount}-${resolved ?? 'data'}-${streamSize}`
  }
}

/** Tip bytes when VER_COUNT ≥ 1, else null. */
export async function readImageTipBytes(absFile: string): Promise<Buffer | null> {
  const count = await readVerCount(absFile)
  if (count < 1) return null
  return readStreamBytes(absFile, verStreamName(count))
}

/**
 * Path Comfy/Python can open for the tip. Prefers ADS open path; otherwise
 * stages tip bytes next to the file and returns that path (caller must cleanup).
 */
export async function resolveTipOpenPath(
  absFile: string
): Promise<{ openPath: string; stagedPath: string | null; versionCount: number }> {
  const resolved = await resolveImageAdsStream(absFile, undefined)
  if (!resolved.ads) {
    return { openPath: absFile, stagedPath: null, versionCount: 0 }
  }
  try {
    await access(resolved.openPath, constants.R_OK)
    return {
      openPath: resolved.openPath,
      stagedPath: null,
      versionCount: resolved.versionCount
    }
  } catch {
    const tip = await readImageTipBytes(absFile)
    if (!tip) {
      return { openPath: absFile, stagedPath: null, versionCount: 0 }
    }
    const staged = `${absFile}.lt-tip-stage.tmp`
    await writeFile(staged, tip)
    return { openPath: staged, stagedPath: staged, versionCount: resolved.versionCount }
  }
}

export async function cleanupTipStage(stagedPath: string | null): Promise<void> {
  if (!stagedPath) return
  await unlink(stagedPath).catch(() => undefined)
}

export async function getImageEditState(
  datasetId: string,
  fileName: string
): Promise<ImageEditState> {
  const { file } = await resolveDatasetImage(datasetId, fileName)
  const versionCount = await readVerCount(file)
  return {
    versionCount,
    tipVer: versionCount,
    hasVersions: versionCount >= 1
  }
}

/** Absolute-path variant for scanFolder / migration. */
export async function getImageEditStateAtPath(absFile: string): Promise<ImageEditState> {
  const versionCount = await readVerCount(absFile)
  return {
    versionCount,
    tipVer: versionCount,
    hasVersions: versionCount >= 1
  }
}

export async function saveEditedImage(
  datasetId: string,
  fileName: string,
  dataBase64: string
): Promise<{ fileName: string; preservedOriginal: boolean; versionCount: number }> {
  const { file, folderPath, fileName: base } = await resolveDatasetImage(datasetId, fileName)
  const encoded = await encodeEditedBuffer(file, dataBase64)
  const { loadSettings } = await import('../settings/store')
  const settings = await loadSettings()
  const result = await writeEncodedImageBytes(file, encoded, settings.imageVersionsEnabled)

  const { invalidateDatasetThumb } = await import('../media/thumbs')
  await invalidateDatasetThumb(datasetId, base, folderPath)
  broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
  return {
    fileName: base,
    preservedOriginal: result.preservedOriginal,
    versionCount: result.versionCount
  }
}

/** Write edited bytes to an arbitrary path — no version history (Save As). */
export async function writeEditedImageToPath(
  destPath: string,
  dataBase64: string
): Promise<{ path: string }> {
  if (!destPath || typeof destPath !== 'string') {
    throw appError('validation', 'Invalid destination path')
  }
  if (!isSaveAsImagePath(destPath)) {
    throw appError(
      'validation',
      'Choose a supported image extension (png, jpg, webp, gif, tiff, …)'
    )
  }
  const encoded = await encodeEditedBuffer(destPath, dataBase64)
  const tmp = `${destPath}.lt-edit.tmp`
  try {
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(tmp, encoded)
    await rename(tmp, destPath)
  } catch (e) {
    await unlink(tmp).catch(() => undefined)
    if (e && typeof e === 'object' && 'code' in e) throw e
    throw appError(
      'process-failed',
      e instanceof Error ? e.message : 'Failed to save edited image'
    )
  }
  return { path: destPath }
}

export async function saveEditedImageAs(
  dataBase64: string,
  defaultPath: string
): Promise<{ path: string | null; cancelled: boolean }> {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'Save image as',
    defaultPath,
    filters: [
      { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
      { name: 'PNG', extensions: ['png'] },
      { name: 'WebP', extensions: ['webp'] },
      { name: 'GIF', extensions: ['gif'] },
      { name: 'TIFF', extensions: ['tif', 'tiff'] },
      {
        name: 'All supported',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp']
      }
    ]
  }
  const result = win
    ? await dialog.showSaveDialog(win, opts)
    : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) {
    return { path: null, cancelled: true }
  }
  const written = await writeEditedImageToPath(result.filePath, dataBase64)
  return { path: written.path, cancelled: false }
}

/** Read tip (or $DATA) for the in-app editor. */
export async function readImageForEdit(
  datasetId: string,
  fileName: string
): Promise<{ dataBase64: string; mime: string }> {
  const { file } = await resolveDatasetImage(datasetId, fileName)
  const resolved = await resolveImageAdsStream(file, undefined)
  const st = await stat(resolved.openPath)
  if (!st.isFile() && st.size === undefined) {
    /* ADS streams still report size via stat on win32 */
  }
  if (st.size > 96 * 1024 * 1024) {
    throw appError('validation', 'Image is too large to edit in-app')
  }
  const buf = await readFile(resolved.openPath)
  return { dataBase64: buf.toString('base64'), mime: mimeForImagePath(file) }
}

/** Delete all VER_* / VER_COUNT — leave $DATA untouched. */
export async function revertImageOriginal(
  datasetId: string,
  fileName: string
): Promise<{ fileName: string; reverted: boolean }> {
  const { file, folderPath, fileName: base } = await resolveDatasetImage(datasetId, fileName)
  const count = await readVerCount(file)
  if (count < 1) {
    throw appError('not-found', 'No version history for this image')
  }
  muteDatasetFolderWatch(1500)
  await deleteAllVersionStreams(file)
  const { invalidateDatasetThumb } = await import('../media/thumbs')
  await invalidateDatasetThumb(datasetId, base, folderPath)
  broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
  return { fileName: base, reverted: true }
}

/** Absolute-path full revert (upscale queue / migration helpers). */
export async function revertImageOriginalAtPath(absFile: string): Promise<void> {
  const count = await readVerCount(absFile)
  if (count < 1) {
    throw appError('not-found', 'No version history for this image')
  }
  muteDatasetFolderWatch(1500)
  await deleteAllVersionStreams(absFile)
}

/** Drop one version and renumber; typically tip = undo last edit. */
export async function dropImageVersion(
  datasetId: string,
  fileName: string,
  ver: number
): Promise<{ fileName: string; versionCount: number }> {
  const { file, folderPath, fileName: base } = await resolveDatasetImage(datasetId, fileName)
  const count = await readVerCount(file)
  if (count < 1) {
    throw appError('not-found', 'No version history for this image')
  }
  if (!Number.isInteger(ver) || ver < 1 || ver > count) {
    throw appError('validation', `Version must be between 1 and ${count}`)
  }

  const { newCount, map } = renumberAfterDrop(count, ver)
  muteDatasetFolderWatch(2000)

  const buffers = new Map<number, Buffer>()
  for (const [oldVer, newVer] of map) {
    const buf = await readStreamBytes(file, verStreamName(oldVer))
    if (buf) buffers.set(newVer, buf)
  }
  for (let i = 1; i <= count; i++) {
    const name = verStreamName(i)
    if (streamExists(file, name)) {
      try {
        deleteStream(file, name)
      } catch {
        /* continue */
      }
    }
  }
  for (const [newVer, buf] of buffers) {
    await writeStreamBytes(file, verStreamName(newVer), buf)
  }
  await writeVerCount(file, newCount)

  const { invalidateDatasetThumb } = await import('../media/thumbs')
  await invalidateDatasetThumb(datasetId, base, folderPath)
  broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
  return { fileName: base, versionCount: newCount }
}

/** Undo last edit = drop tip. */
export async function undoLastImageVersion(
  datasetId: string,
  fileName: string
): Promise<{ fileName: string; versionCount: number }> {
  const state = await getImageEditState(datasetId, fileName)
  if (!state.hasVersions) {
    throw appError('not-found', 'No version history for this image')
  }
  return dropImageVersion(datasetId, fileName, state.tipVer)
}

/**
 * Collapse tip into `$DATA`, drop version streams (MFE commitImageVersion).
 * Uses `VER_COUNT` when readable; otherwise falls back to the highest `VER_n` stream.
 */
export async function commitImageVersion(absFile: string): Promise<{ committed: boolean }> {
  let tipN = await readVerCount(absFile)
  if (tipN < 1) {
    tipN = tipVersionFromStreamNames(listStreamNames(absFile))
  }
  if (tipN < 1) {
    return { committed: false }
  }
  const tipName = verStreamName(tipN)
  const tip = await readStreamBytes(absFile, tipName)
  if (!tip) {
    throw appError('not-found', `Missing tip stream ${tipName}`)
  }

  const temp = `${absFile}._tmp`
  muteDatasetFolderWatch(2500)

  try {
    await writeFile(temp, tip)
    await copyStreams(absFile, temp, undefined, isImageVersionStreamName)
    await unlink(absFile)
    await rename(temp, absFile)

    // Commit must leave no version history — otherwise trainers still see a tip/original split.
    const leftoverCount = await readVerCount(absFile)
    const leftoverTip = tipVersionFromStreamNames(listStreamNames(absFile))
    if (leftoverCount >= 1 || leftoverTip >= 1) {
      throw appError(
        'process-failed',
        `Commit left version streams on ${basename(absFile)} (VER_COUNT=${leftoverCount}, tip=VER_${leftoverTip})`
      )
    }
    return { committed: true }
  } catch (e) {
    await unlink(temp).catch(() => undefined)
    if (e && typeof e === 'object' && 'code' in e) throw e
    throw appError(
      'process-failed',
      e instanceof Error ? e.message : 'Failed to commit image version'
    )
  }
}

const COMMIT_CONCURRENCY = 4

/**
 * Commit every image in a dataset folder that still has VER_* history.
 * Fails the batch if any commit throws (partial commits may remain — retry is idempotent).
 */
export async function commitDatasetImageVersions(
  folderPath: string
): Promise<{ committed: number; skipped: number }> {
  let entries: string[]
  try {
    entries = await readdir(folderPath)
  } catch (e) {
    throw appError(
      'process-failed',
      `Cannot read dataset folder to commit image tips:\n${folderPath}\n${
        e instanceof Error ? e.message : String(e)
      }`,
      { remediation: 'Check the dataset folder path and disk permissions, then retry.' }
    )
  }

  const images = entries.filter((name) => {
    const ext = extname(name).toLowerCase()
    return IMAGE_EXTENSIONS.has(ext) && isEditableImagePath(name)
  })

  let committed = 0
  let skipped = 0
  const errors: string[] = []

  await mapWithConcurrency(images, COMMIT_CONCURRENCY, async (name) => {
    const file = join(folderPath, name)
    try {
      const count = await readVerCount(file)
      const orphanTip =
        count < 1 ? tipVersionFromStreamNames(listStreamNames(file)) : 0
      if (count < 1 && orphanTip < 1) {
        skipped += 1
        return
      }
      await commitImageVersion(file)
      committed += 1
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  if (errors.length > 0) {
    throw appError(
      'process-failed',
      `Failed to commit image versions (${errors.length}): ${errors.slice(0, 3).join('; ')}`,
      { remediation: 'Fix disk/ADS access and retry caption or training.' }
    )
  }

  return { committed, skipped }
}

/**
 * When copying a versioned NTFS image onto a non-ADS volume, return tip bytes
 * for the destination body. Otherwise null → normal copy.
 */
export async function tipBytesForNonAdsDest(
  sourcePath: string,
  destPath: string
): Promise<Buffer | null> {
  if (!isEditableImagePath(sourcePath)) return null
  if (pathSupportsImageVersions(destPath)) return null
  return readImageTipBytes(sourcePath)
}

/**
 * One-shot: `{file}.original` siblings → ADS (`$DATA`=pristine, `VER_1`=edit).
 */
export async function migrateOriginalSiblingsToAds(
  folderPath: string
): Promise<{ migrated: number; skipped: number; failed: number }> {
  let migrated = 0
  let skipped = 0
  let failed = 0

  let entries: string[]
  try {
    entries = await readdir(folderPath)
  } catch {
    return { migrated, skipped, failed }
  }

  const originals = entries.filter((n) => n.toLowerCase().endsWith('.original'))
  for (const origName of originals) {
    const liveName = origName.slice(0, -'.original'.length)
    if (!liveName || !IMAGE_EXTENSIONS.has(extname(liveName).toLowerCase())) {
      skipped += 1
      continue
    }
    const live = join(folderPath, liveName)
    const sib = join(folderPath, origName)
    try {
      await access(live)
      await access(sib)
    } catch {
      skipped += 1
      continue
    }

    try {
      const existing = await readVerCount(live)
      if (existing >= 1) {
        await unlink(sib).catch(() => undefined)
        skipped += 1
        continue
      }

      if (!pathSupportsImageVersions(live)) {
        skipped += 1
        continue
      }

      const liveBytes = await readFile(live)
      const originalBytes = await readFile(sib)
      muteDatasetFolderWatch(2000)
      const tmp = `${live}.lt-migrate.tmp`
      await writeFile(tmp, originalBytes)
      await rename(tmp, live)
      await writeStreamBytes(live, verStreamName(1), liveBytes)
      await writeVerCount(live, 1)
      await unlink(sib).catch(() => undefined)
      migrated += 1
    } catch (e) {
      failed += 1
      logger.warn({ err: e, live, sib }, 'migrate .original → ADS failed')
    }
  }

  return { migrated, skipped, failed }
}

/** @deprecated Prefer originalSiblingFileName from @shared/imageEdit */
export { originalSiblingFileName }
