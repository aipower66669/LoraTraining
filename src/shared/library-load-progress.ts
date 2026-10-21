/** Progressive library refresh — sync discovery, then sticky tiles, then badge enrich. */
export type LibraryLoadPhase = 'sync' | 'read' | 'enrich' | 'done'

export type LibraryLoadProgress = {
  phase: LibraryLoadPhase
  /** Folders / datasets processed in this phase. */
  done: number
  /** Total units in this phase (0 = unknown / indeterminate). */
  total: number
  /** Category currently being scanned (sync phase). */
  categoryName?: string | null
  /** Short status-bar line. */
  message: string
}

export function formatLibraryLoadStatus(p: LibraryLoadProgress): string {
  if (p.phase === 'done') return 'Ready'
  if (p.total > 0) {
    const pct = Math.min(100, Math.round((100 * p.done) / p.total))
    return `${p.message} (${p.done}/${p.total} · ${pct}%)`
  }
  return p.message
}
