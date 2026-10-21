/**
 * Pure helpers for the Stress Compare overview (models × stress sets).
 * Only models with at least one produced preview are shown.
 */

/** Prefer saved order, then append unknowns (stable extra order). */
export function orderStressCompareModels(
  modelsWithImages: readonly string[],
  savedOrder: readonly string[],
  extrasSorted: readonly string[]
): string[] {
  const present = new Set(modelsWithImages)
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of savedOrder) {
    if (!present.has(m) || seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  for (const m of extrasSorted) {
    if (!present.has(m) || seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  for (const m of modelsWithImages) {
    if (seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  return out
}

/**
 * Prefer saved set indices (still present), then append remaining by activity
 * date descending (newest first).
 */
export function orderStressCompareSets(
  sets: ReadonlyArray<{ setIndex: number; activityMs: number }>,
  savedOrder: readonly number[]
): number[] {
  const byIndex = new Map(sets.map((s) => [s.setIndex, s] as const))
  const present = new Set(sets.map((s) => s.setIndex))
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of savedOrder) {
    if (!present.has(i) || seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  const remaining = sets
    .filter((s) => !seen.has(s.setIndex))
    .sort((a, b) => {
      if (b.activityMs !== a.activityMs) return b.activityMs - a.activityMs
      return b.setIndex - a.setIndex
    })
  for (const s of remaining) {
    if (!byIndex.has(s.setIndex)) continue
    out.push(s.setIndex)
  }
  return out
}

/** Remap stored column order after removing stress set `removedIndex`. */
export function remapStressCompareSetOrderAfterRemove(
  order: readonly number[],
  removedIndex: number
): number[] {
  return order
    .filter((i) => i !== removedIndex)
    .map((i) => (i > removedIndex ? i - 1 : i))
}
