import { imageStem } from '@shared/schemas/dataset'
import type { DatasetDetail } from '@shared/ipc/contract'

export function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string; remediation?: string } }
): T {
  if (!result.ok) {
    const rem = result.error.remediation ? ` — ${result.error.remediation}` : ''
    throw new Error(`${result.error.message}${rem}`)
  }
  return result.value
}

export function markCaptionExists(
  detail: DatasetDetail | null,
  fileName: string | null
): DatasetDetail | null {
  if (!detail || !fileName) return detail
  const lower = fileName.toLowerCase()
  const stemLower = imageStem(fileName).toLowerCase()
  let changed = false
  const images = detail.images.map((img) => {
    const nameMatch = img.fileName.toLowerCase() === lower
    const stemMatch = img.stem.toLowerCase() === stemLower
    if (!nameMatch && !stemMatch) return img
    if (img.captionExists) return img
    changed = true
    return { ...img, captionExists: true }
  })
  if (!changed) return detail
  const captions = images.filter((i) => i.captionExists).length
  return {
    ...detail,
    images,
    stats: { ...detail.stats, captions }
  }
}

/** Keep optimistic caption badges when a rescan briefly misses a just-written .txt. */
export function mergeCaptionFlags(prev: DatasetDetail | null, next: DatasetDetail): DatasetDetail {
  if (!prev || prev.id !== next.id) return next
  const prevByName = new Map(prev.images.map((i) => [i.fileName.toLowerCase(), i]))
  let changed = false
  const images = next.images.map((img) => {
    if (img.captionExists) return img
    const old = prevByName.get(img.fileName.toLowerCase())
    if (old?.captionExists) {
      changed = true
      return { ...img, captionExists: true }
    }
    return img
  })
  if (!changed) return next
  return {
    ...next,
    images,
    stats: {
      ...next.stats,
      captions: images.filter((i) => i.captionExists).length
    }
  }
}

export function applyCompletedCaptions(
  detail: DatasetDetail | null,
  fileNames: Array<string | null | undefined>
): DatasetDetail | null {
  let next = detail
  for (const name of fileNames) {
    if (name) next = markCaptionExists(next, name)
  }
  return next
}

export function selectionAfterMissing(
  prevImages: Array<{ fileName: string }> | undefined,
  missing: string | null,
  nextImages: Array<{ fileName: string }>
): string | null {
  if (nextImages.length === 0) return null
  if (!missing || !prevImages?.length) return nextImages[0]?.fileName ?? null
  const idx = prevImages.findIndex((i) => i.fileName === missing)
  if (idx < 0) return nextImages[0]?.fileName ?? null
  // Same slot after removal (= old next); else previous; never force first unless empty neighbors.
  return (
    nextImages[idx]?.fileName ?? nextImages[idx - 1]?.fileName ?? nextImages[0]?.fileName ?? null
  )
}
