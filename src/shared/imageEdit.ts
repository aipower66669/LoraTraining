import { IMAGE_EXTENSIONS } from './schemas/dataset'

/** Raster formats we can edit in-place via Sharp re-encode (dataset images). */
export function imageExt(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function isEditableImagePath(filePath: string): boolean {
  const ext = imageExt(filePath)
  return ext.length > 0 && IMAGE_EXTENSIONS.has(`.${ext}`)
}

/** Sharp output format id for a file extension (bmp → jpeg). */
export function sharpFormatForExt(
  ext: string
): 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'tiff' | null {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
    case 'jfif':
    case 'bmp':
      return 'jpeg'
    case 'webp':
      return 'webp'
    case 'gif':
      return 'gif'
    case 'avif':
      return 'avif'
    case 'tiff':
    case 'tif':
      return 'tiff'
    default:
      return null
  }
}

/** True when Save As can write this extension (slightly broader than dataset IMAGE_EXTENSIONS). */
export function isSaveAsImagePath(filePath: string): boolean {
  return sharpFormatForExt(imageExt(filePath)) != null
}

/** Max stacked in-app edit versions (VER_1…VER_N) on the file as ADS — MyFileExplorer D27. */
export const IMAGE_VER_MAX = 4

/** ADS stream holding the decimal version count. */
export const IMAGE_VER_COUNT_STREAM = 'VER_COUNT'

/** Version history is opt-in and requires an NTFS volume with ADS support. */
export function shouldUseImageVersions(enabled: boolean, pathIsOnNtfs: boolean): boolean {
  return enabled && pathIsOnNtfs
}

const VER_NAME_RE = /^VER_(\d+)$/i

/** ADS name for edit version `n` (1-based), e.g. `VER_2`. */
export function verStreamName(n: number): string {
  return `VER_${n}`
}

/** Highest `VER_n` index present in an ADS name list, or 0. Ignores `VER_COUNT`. */
export function tipVersionFromStreamNames(names: string[]): number {
  let max = 0
  for (const name of names) {
    const m = VER_NAME_RE.exec(name)
    if (!m) continue
    const n = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/** True for `VER_COUNT` or `VER_{digits}` (image edit version streams). */
export function isImageVersionStreamName(name: string): boolean {
  if (name.toUpperCase() === IMAGE_VER_COUNT_STREAM) return true
  return VER_NAME_RE.test(name)
}

/** Parse `VER_COUNT` text → clamped int, or 0 if invalid. */
export function parseVerCount(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(IMAGE_VER_MAX, Math.floor(n))
}

/**
 * After dropping `dropVer` (1-based), map old version index → new index.
 * Survivors renumber densely from 1.
 */
export function renumberAfterDrop(
  count: number,
  dropVer: number
): { newCount: number; map: Map<number, number> } {
  const map = new Map<number, number>()
  if (count < 1 || dropVer < 1 || dropVer > count) {
    for (let i = 1; i <= count; i++) map.set(i, i)
    return { newCount: count, map }
  }
  let next = 1
  for (let i = 1; i <= count; i++) {
    if (i === dropVer) continue
    map.set(i, next)
    next += 1
  }
  return { newCount: next - 1, map }
}

/**
 * When already at IMAGE_VER_MAX and saving another edit: drop VER_1 (oldest),
 * shift VER_2→VER_1 … ; new tip writes as VER_MAX.
 */
export function renumberAfterShiftOldest(count: number): {
  newCount: number
  map: Map<number, number>
} {
  const map = new Map<number, number>()
  if (count < IMAGE_VER_MAX) {
    for (let i = 1; i <= count; i++) map.set(i, i)
    return { newCount: count, map }
  }
  for (let i = 2; i <= count; i++) map.set(i, i - 1)
  return { newCount: IMAGE_VER_MAX - 1, map }
}

/** Legacy sibling backup filename — used only by one-shot ADS migration. */
export function originalSiblingFileName(fileName: string): string {
  return `${fileName}.original`
}
