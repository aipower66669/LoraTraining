import type { JoyCaptionExistingMode } from './joycaption'

/** One dataset caption job in the serial JoyCaption queue (in-memory only). */
export interface CaptionQueueJob {
  runId: string
  datasetId: string
  mode: JoyCaptionExistingMode
  guidance: string | null
  prependTrigger: boolean
  /** Frozen at enqueue when prependTrigger; otherwise ''. */
  triggerToken: string
  /** Image count estimate at enqueue (for aggregate totals before the job starts). */
  plannedTotal: number
}

/**
 * Aggregate footer totals for a caption session.
 * `total` = images already finished in prior jobs + current job size + pending estimates.
 */
export function computeAggregateCaptionProgress(args: {
  sessionCompleted: number
  currentCompleted: number
  currentTotal: number
  pendingPlannedTotals: number[]
}): { completed: number; total: number } {
  const pendingSum = args.pendingPlannedTotals.reduce((a, b) => a + b, 0)
  return {
    completed: args.sessionCompleted + args.currentCompleted,
    total: args.sessionCompleted + args.currentTotal + pendingSum
  }
}

/** Whether a cancel request should tear down the whole caption session. */
export function captionCancelMatchesSession(
  runId: string,
  activeRunId: string | null,
  pendingRunIds: string[]
): boolean {
  if (activeRunId === runId) return true
  return pendingRunIds.includes(runId)
}
