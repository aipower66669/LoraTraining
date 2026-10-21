/** Ids in `orderedIds` from anchor through clicked (inclusive), in list order. */
export function rangeIdsInclusive(
  orderedIds: string[],
  anchorId: string,
  clickId: string
): string[] {
  const a = orderedIds.indexOf(anchorId)
  const b = orderedIds.indexOf(clickId)
  if (a < 0 || b < 0) return [clickId]
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return orderedIds.slice(lo, hi + 1)
}

/**
 * Insert slot from pointer Y over a row: top half → before this index,
 * bottom half → after (index + 1). Result is in `0..orderedIds.length`.
 */
export function dropSlotFromPointer(hoverIndex: number, clientY: number, top: number, height: number): number {
  const after = clientY > top + height / 2
  return after ? hoverIndex + 1 : hoverIndex
}

/**
 * Move `movingIds` (preserving relative order) so the block is inserted
 * before `insertBeforeIndex` in the original list (`0..length`, length = append).
 * Returns null when the order would not change.
 */
export function moveIdsToSlot(
  orderedIds: string[],
  movingIds: string[],
  insertBeforeIndex: number
): string[] | null {
  if (movingIds.length === 0) return null
  if (insertBeforeIndex < 0 || insertBeforeIndex > orderedIds.length) return null

  const movingSet = new Set(movingIds)
  const movingInOrder = orderedIds.filter((id) => movingSet.has(id))
  if (movingInOrder.length === 0) return null

  const without = orderedIds.filter((id) => !movingSet.has(id))

  // Map the original insert index into the compacted `without` list.
  let insertAt = insertBeforeIndex
  for (let i = 0; i < insertBeforeIndex; i++) {
    if (movingSet.has(orderedIds[i]!)) insertAt--
  }
  insertAt = Math.max(0, Math.min(insertAt, without.length))

  const next = [...without.slice(0, insertAt), ...movingInOrder, ...without.slice(insertAt)]
  if (next.length !== orderedIds.length) return null
  if (next.every((id, i) => id === orderedIds[i])) return null
  return next
}

/**
 * Move `movingIds` so the block sits immediately before the item at `dropIndex`.
 * @deprecated Prefer moveIdsToSlot for before/after pointer slots.
 */
export function moveIdsBeforeIndex(
  orderedIds: string[],
  movingIds: string[],
  dropIndex: number
): string[] | null {
  if (dropIndex < 0 || dropIndex >= orderedIds.length) return null
  const movingSet = new Set(movingIds)
  if (movingSet.has(orderedIds[dropIndex]!)) return null
  return moveIdsToSlot(orderedIds, movingIds, dropIndex)
}
