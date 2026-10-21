/** Renderer-side media URL; optional bust forces Chromium to re-fetch the file. */
export function datasetMediaUrl(
  datasetId: string,
  fileName: string,
  cacheBust?: number | string
): string {
  const path = `loratraining-media://dataset/${datasetId}/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}

/** 200×200 center-cropped thumb (generated/cached in main). Prefer for grids & covers. */
export function datasetThumbUrl(
  datasetId: string,
  fileName: string,
  cacheBust?: number | string
): string {
  const path = `loratraining-media://dataset/${datasetId}/thumb/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}

/**
 * Pristine `$DATA` body for an image with tip ADS versions — the "Before"
 * side of the Upscale comparison (edits live in `VER_*`, not a sibling file).
 */
export function datasetOriginalMediaUrl(
  datasetId: string,
  fileName: string,
  cacheBust?: number | string
): string {
  const path = `loratraining-media://dataset/${datasetId}/original/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}
