/**
 * Diversify sibling naming: `{rootStem}_d{NN}.{ext}` so localeCompare keeps
 * generated images adjacent after the source (`photo.jpg` → `photo_d01.jpg`).
 */

const DIVERSIFY_SUFFIX_RE = /_d(\d+)$/i

/** Strip a trailing `_dNN` so generating from a sibling does not nest suffixes. */
export function diversifyRootStem(stem: string): string {
  return stem.replace(DIVERSIFY_SUFFIX_RE, '')
}

/** True when the stem is a Diversify output (`…_d01`), not a root source. */
export function isDiversifySiblingStem(stem: string): boolean {
  return DIVERSIFY_SUFFIX_RE.test(stem)
}

/** Zero-pad width for the numeric suffix (at least 2 digits). */
export function diversifyIndexPad(maxIndex: number): number {
  return Math.max(2, String(Math.max(1, maxIndex)).length)
}

/** `{rootStem}_d{NN}` with zero-padded index (1-based). */
export function diversifySiblingStem(rootStem: string, index: number, pad = 2): string {
  const n = Math.max(1, Math.floor(index))
  const width = Math.max(pad, diversifyIndexPad(n))
  return `${diversifyRootStem(rootStem)}_d${String(n).padStart(width, '0')}`
}

/**
 * Next free `{root}_dNN.{ext}` basename given existing file names in the folder.
 * Scans for the highest used Diversify index under this root stem, then +1.
 */
export function nextDiversifyFileName(
  sourceFileName: string,
  existingFileNames: Iterable<string>
): string {
  const dot = sourceFileName.lastIndexOf('.')
  const ext = dot >= 0 ? sourceFileName.slice(dot) : ''
  const rawStem = dot > 0 ? sourceFileName.slice(0, dot) : sourceFileName
  const root = diversifyRootStem(rawStem)

  let maxUsed = 0
  const prefix = `${root}_d`.toLowerCase()
  for (const name of existingFileNames) {
    const i = name.lastIndexOf('.')
    const stem = i > 0 ? name.slice(0, i) : name
    if (!stem.toLowerCase().startsWith(prefix)) continue
    const m = stem.match(DIVERSIFY_SUFFIX_RE)
    if (!m) continue
    // Ensure the stem before `_dNN` matches root exactly (case-insensitive).
    const before = stem.slice(0, stem.length - m[0].length)
    if (before.toLowerCase() !== root.toLowerCase()) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > maxUsed) maxUsed = n
  }

  const next = maxUsed + 1
  const pad = diversifyIndexPad(next)
  return `${diversifySiblingStem(root, next, pad)}${ext}`
}
