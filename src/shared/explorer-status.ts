import type { DatasetLifecycleStatus, DatasetSummary } from '@shared/ipc/contract'

/**
 * Explorer badge / Queue tab: done > validated > trained > in training queue > ready.
 * `inQueue` means queued/running/paused — NOT a draft job.
 */
export function explorerStatus(
  ds: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done'>,
  inQueue: boolean
): DatasetLifecycleStatus {
  if (ds.done) return 'done'
  if (ds.validated) return 'validated'
  if (ds.trained) return 'trained'
  if (inQueue) return 'queued'
  if (ds.ready) return 'ready'
  return 'none'
}

export type DatasetStatusFilter =
  | 'all'
  | 'none'
  | 'ready'
  | 'queued'
  | 'trained'
  | 'validated'
  | 'done'

export const EXPLORER_STATUS_FILTER_KEY = 'lora-training:explorer-status-filter'

const VALID_STATUS_FILTERS = new Set<DatasetStatusFilter>([
  'all',
  'none',
  'ready',
  'queued',
  'trained',
  'validated',
  'done'
])

export function readExplorerStatusFilter(): DatasetStatusFilter {
  try {
    const raw = localStorage.getItem(EXPLORER_STATUS_FILTER_KEY)
    if (raw && VALID_STATUS_FILTERS.has(raw as DatasetStatusFilter)) {
      return raw as DatasetStatusFilter
    }
  } catch {
    /* ignore */
  }
  return 'all'
}

export function writeExplorerStatusFilter(filter: DatasetStatusFilter): void {
  try {
    localStorage.setItem(EXPLORER_STATUS_FILTER_KEY, filter)
  } catch {
    /* ignore */
  }
}

export function matchesStatusFilter(
  ds: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done'>,
  filter: DatasetStatusFilter,
  inQueue: boolean
): boolean {
  // Exclusive buckets (same priority as explorer badges):
  // done > validated > trained > queued > ready.
  switch (filter) {
    case 'all':
      return true
    case 'none':
      return !ds.ready && !ds.trained && !ds.validated && !ds.done && !inQueue
    case 'ready':
      return ds.ready && !inQueue && !ds.trained && !ds.validated && !ds.done
    case 'queued':
      return inQueue && !ds.trained && !ds.validated && !ds.done
    case 'trained':
      return ds.trained && !ds.validated && !ds.done
    case 'validated':
      return ds.validated && !ds.done
    case 'done':
      return ds.done
  }
}

/**
 * Ready or higher lifecycle: Ready, Queue, Trained, Validated, or Done.
 * Not-ready datasets are excluded from caption validation.
 */
export function isAtLeastReady(
  ds: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done'>,
  inQueue: boolean
): boolean {
  return explorerStatus(ds, inQueue) !== 'none'
}

/**
 * Library list enrichment order: lower = sooner.
 * Active explorer tab matches first; Done (rarely opened) is always last unless
 * the user is already on Done.
 */
export function datasetListPriority(
  ds: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done'>,
  prioritize: DatasetStatusFilter,
  inQueue: boolean
): number {
  const status = explorerStatus(ds, inQueue)
  if (prioritize !== 'all' && matchesStatusFilter(ds, prioritize, inQueue)) return 0
  if (status === 'done' && prioritize !== 'done') return 100
  if (prioritize === 'all') return 10
  return 50
}

/** Stable sort key for listDatasets: priority asc, then newest updatedAt first. */
export function compareDatasetsForListPriority(
  a: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done' | 'updatedAt'>,
  b: Pick<DatasetSummary, 'ready' | 'trained' | 'validated' | 'done' | 'updatedAt'>,
  prioritize: DatasetStatusFilter,
  inQueueA: boolean,
  inQueueB: boolean
): number {
  const pa = datasetListPriority(a, prioritize, inQueueA)
  const pb = datasetListPriority(b, prioritize, inQueueB)
  if (pa !== pb) return pa - pb
  return b.updatedAt.localeCompare(a.updatedAt)
}
