import type { JobStatus } from '@shared/ipc/contract'

/** Statuses that belong in the in-memory FIFO across app restarts. */
export const QUEUE_RESTORABLE_STATUSES = new Set<JobStatus>([
  'queued',
  'paused',
  'running'
])

export type QueueHydrateJob = {
  id: string
  status: JobStatus
  archived: boolean
  queueOrder: number | null
  updatedAt: string
}

function belongsInQueue(j: QueueHydrateJob): boolean {
  if (j.archived) return false
  if (QUEUE_RESTORABLE_STATUSES.has(j.status)) return true
  // Stopped jobs stay in the FIFO until Remove / Retry clears the slot.
  if (j.status === 'cancelled' && j.queueOrder != null) return true
  return false
}

/**
 * Build FIFO order from persisted jobs.
 * Prefer queueOrder; fall back to updatedAt (oldest first) when order is missing.
 * Paused/running jobs are placed ahead of plain queued when orders tie / are null.
 */
export function buildQueueIdsFromJobs(jobs: QueueHydrateJob[]): string[] {
  const candidates = jobs.filter(belongsInQueue)
  const rank = (status: JobStatus): number => {
    if (status === 'running') return 0
    if (status === 'paused') return 1
    if (status === 'cancelled') return 3
    return 2
  }
  candidates.sort((a, b) => {
    const ao = a.queueOrder
    const bo = b.queueOrder
    if (ao != null && bo != null && ao !== bo) return ao - bo
    if (ao != null && bo == null) return -1
    if (ao == null && bo != null) return 1
    const rs = rank(a.status) - rank(b.status)
    if (rs !== 0) return rs
    return a.updatedAt.localeCompare(b.updatedAt)
  })
  return candidates.map((j) => j.id)
}

/** After a process restart, a disk "running" job cannot still be running. */
export function statusAfterRestart(status: JobStatus): JobStatus {
  return status === 'running' ? 'paused' : status
}
