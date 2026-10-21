/**
 * Arrow-key index navigation for a flat grid of `n` cells with `cols` columns.
 * Left/right: ±1 with wrap across the whole list (end of row → next row, last → first).
 * Up/down: same column, wrapping within cells that occupy that column (short last rows).
 */
export function nextIndexForArrow(
  index: number,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  cols: number,
  n: number
): number {
  if (n <= 0) return 0
  const i = ((index % n) + n) % n

  if (key === 'ArrowRight') {
    return (i + 1) % n
  }
  if (key === 'ArrowLeft') {
    return (i - 1 + n) % n
  }

  const col = i % cols
  const columnIndices: number[] = []
  for (let j = col; j < n; j += cols) {
    columnIndices.push(j)
  }
  const pos = columnIndices.indexOf(i)
  const delta = key === 'ArrowDown' ? 1 : -1
  const nextPos = (pos + delta + columnIndices.length) % columnIndices.length
  return columnIndices[nextPos]!
}

export function columnCountForWidth(width: number, minColWidth = 112, gap = 8): number {
  return Math.max(1, Math.floor((width + gap) / (minColWidth + gap)))
}

/** Pixel size of one square cell for a grid with `cols` columns in `width` px. */
export function cellSizeForWidth(width: number, cols: number, gap = 8): number {
  const c = Math.max(1, cols)
  return Math.max(1, Math.floor((Math.max(0, width) - gap * (c - 1)) / c))
}
