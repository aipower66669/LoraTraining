import type { JobStatus, JobSummary } from '@shared/ipc/contract'

/**
 * In-flight / unfinished statuses (still on the Jobs “New” filter).
 * Kept for callers that care about training-in-progress vs finished.
 */
const IN_FLIGHT_JOB_STATUSES = new Set<JobStatus>(['draft', 'queued', 'running', 'paused'])

/** Actually in the training FIFO (not a draft sitting on Jobs). */
const QUEUED_JOB_STATUSES = new Set<JobStatus>(['queued', 'running', 'paused'])

/** Prefer the most actionable job when a dataset somehow has more than one. */
const OPEN_JOB_PRIORITY: JobStatus[] = [
  'running',
  'paused',
  'queued',
  'draft',
  'failed',
  'cancelled',
  'complete'
]

export function isOpenJobStatus(status: JobStatus): boolean {
  return IN_FLIGHT_JOB_STATUSES.has(status)
}

export function isQueuedJobStatus(status: JobStatus): boolean {
  return QUEUED_JOB_STATUSES.has(status)
}

/**
 * True when this dataset already has a non-archived job.
 * One dataset → one live job; archive (or delete) before creating another.
 */
export function datasetHasOpenJob(
  jobs: Array<Pick<JobSummary, 'datasetId' | 'status' | 'archived'>>,
  datasetId: string
): boolean {
  return jobs.some((j) => j.datasetId === datasetId && !j.archived)
}

/**
 * True when this dataset has a job currently in the training queue
 * (queued / running / paused). Draft jobs do NOT count — those stay on Ready/etc.
 */
export function datasetHasQueuedJob(
  jobs: Array<Pick<JobSummary, 'datasetId' | 'status' | 'archived'>>,
  datasetId: string
): boolean {
  return jobs.some(
    (j) => j.datasetId === datasetId && !j.archived && isQueuedJobStatus(j.status)
  )
}

/** Prefer running → … → complete when multiple non-archived jobs exist. */
function pickPreferredJob<T extends { status: JobStatus }>(candidates: T[]): T | null {
  if (candidates.length === 0) return null
  let best = candidates[0]!
  let bestRank = OPEN_JOB_PRIORITY.indexOf(best.status)
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!
    const rank = OPEN_JOB_PRIORITY.indexOf(c.status)
    if (rank >= 0 && (bestRank < 0 || rank < bestRank)) {
      best = c
      bestRank = rank
    }
  }
  return best
}

export function openJobForDataset(
  jobs: Array<Pick<JobSummary, 'id' | 'datasetId' | 'status' | 'archived'>>,
  datasetId: string
): { id: string; status: JobStatus } | null {
  const hits = jobs.filter((j) => j.datasetId === datasetId && !j.archived)
  const hit = pickPreferredJob(hits)
  return hit ? { id: hit.id, status: hit.status } : null
}

/**
 * Jobs list / queue label: category breadcrumb + dataset name.
 * Example: `General \\ MyDataset`
 */
export function jobBreadcrumbParts(
  categoryName: string | null | undefined,
  datasetName: string
): { category: string; dataset: string } {
  return {
    category: (categoryName ?? '').trim() || 'Uncategorized',
    dataset: datasetName.trim() || 'Untitled'
  }
}

export function jobBreadcrumbLabel(
  categoryName: string | null | undefined,
  datasetName: string
): string {
  const { category, dataset } = jobBreadcrumbParts(categoryName, datasetName)
  return `${category} \\ ${dataset}`
}
