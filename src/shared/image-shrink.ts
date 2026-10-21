/** Shortest-edge target for training-ready shrink (do not enlarge). */
export const SHRINK_MIN_EDGE = 1024

export type ShrinkSize = { width: number; height: number }

/**
 * Target size so min(width, height) === minEdge when the shortest side is oversized.
 * Returns null when no shrink is needed (shortest side already ≤ minEdge).
 * For non-square images the longer side stays > minEdge.
 */
export function shrinkTargetSize(
  width: number,
  height: number,
  minEdge: number = SHRINK_MIN_EDGE
): ShrinkSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const w = Math.round(width)
  const h = Math.round(height)
  const shortest = Math.min(w, h)
  if (shortest <= minEdge) return null
  const scale = minEdge / shortest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  }
}

export function formatShrinkSample(before: ShrinkSize, after: ShrinkSize): {
  before: string
  after: string
} {
  return {
    before: `${before.width}×${before.height}`,
    after: `${after.width}×${after.height}`
  }
}
