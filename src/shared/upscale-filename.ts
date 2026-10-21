/**
 * Suffix appended to the source image's stem for the ComfyUI-side result file,
 * written into the shared library `{libraryRoot}/!Temp/upscale` scratch folder before being converted
 * and swapped into the dataset image's own filename (see `upscaleQueue.ts`).
 */
export const UPSCALE_SUFFIX = '_upscaled'

/**
 * Strip any existing trailing `_upscaled` suffix from a stem. Kept in case a
 * source stem already carries one (defensive; shouldn't normally happen since
 * results are swapped in under the original's own name, not this suffix).
 */
export function normalizeUpscaleBaseStem(stem: string): string {
  return stem.endsWith(UPSCALE_SUFFIX) ? stem.slice(0, -UPSCALE_SUFFIX.length) : stem
}

/** `{stem}_upscaled` for the given source stem (normalized first). */
export function upscaleOutputStem(stem: string): string {
  return `${normalizeUpscaleBaseStem(stem)}${UPSCALE_SUFFIX}`
}

  /** Filename of the preserved pristine original (legacy sibling; ADS migration only). */
export function originalSiblingFileName(fileName: string): string {
  return `${fileName}.original`
}
