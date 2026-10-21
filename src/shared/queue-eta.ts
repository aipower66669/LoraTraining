import type { JobProgress, JobStatus, JobSummary } from '@shared/ipc/contract'
import { isTrainingProgressPhase } from './progress-action'

/**
 * Cold-start fallback only — used until a measured s/it exists.
 * Prefer the last live sample once training has produced one.
 */
export const QUEUE_SECONDS_PER_STEP = 7

/** How often the live rate sample is refreshed while training. */
export const QUEUE_LIVE_RATE_SAMPLE_MS = 60_000

/** Prefer any positive planned/live step count. */
export function resolveJobTotalSteps(opts: {
  totalSteps?: number | null
  progressTotalSteps?: number | null
  configSteps?: number | string | null
  /**
   * Status is accepted for call-site convenience but does **not** change priority:
   * user `train.steps` always wins over tqdm `progress.totalSteps` (toolkit often
   * reports total−2). Progress totals are for metrics UI only, never planned steps.
   */
  status?: string | null
}): number {
  const fromConfig =
    typeof opts.configSteps === 'string' ? Number(opts.configSteps) : opts.configSteps
  // Always prefer configured train.steps — never let live tqdm rewrite the plan.
  for (const c of [fromConfig, opts.totalSteps, opts.progressTotalSteps]) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.floor(c)
  }
  return 0
}

/** Positive current step from live and/or persisted progress. */
export function resolveJobCurrentStep(opts: {
  liveCurrentStep?: number | null
  progressCurrentStep?: number | null
}): number {
  for (const c of [opts.liveCurrentStep, opts.progressCurrentStep]) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.floor(c)
  }
  return 0
}

/**
 * Current step for list/queue labels and remaining-step ETA.
 *
 * - complete → 0 (show total alone; tqdm often ends at total−2)
 * - running/paused in Training → live progress and/or checkpoint
 * - running/paused in pre-train phases (cache, load weights, …) → checkpoint only
 *   (tqdm current/total is for that phase, not train.steps)
 * - otherwise → on-disk checkpoint only (never persisted tqdm)
 */
export function resolveJobStepsLabelCurrent(opts: {
  status?: string | null
  checkpointStep?: number | null
  progressCurrentStep?: number | null
  liveCurrentStep?: number | null
  /** Live/persisted progress — used to detect pre-Training phases. */
  progress?: JobProgress | null
}): number {
  if (opts.status === 'complete') return 0

  const fromCkpt =
    typeof opts.checkpointStep === 'number' && opts.checkpointStep > 0
      ? Math.floor(opts.checkpointStep)
      : 0
  const active = opts.status === 'running' || opts.status === 'paused'
  if (active) {
    // Cache / init tqdm is X/N for that phase — never mix into train.steps labels.
    if (opts.progress != null && !isTrainingProgressPhase(opts.progress)) {
      return fromCkpt
    }
    const fromProgress = resolveJobCurrentStep({
      liveCurrentStep: opts.liveCurrentStep,
      progressCurrentStep: opts.progressCurrentStep
    })
    return Math.max(fromProgress, fromCkpt)
  }
  return fromCkpt
}

/**
 * List/queue step label: `2,500` when never started, `500/2,500` once there is progress
 * (resume / partial run).
 */
export function formatJobStepsLabel(current: number, total: number): string {
  if (!(total > 0)) return ''
  if (current > 0) return `${current.toLocaleString()}/${total.toLocaleString()}`
  return total.toLocaleString()
}

/**
 * Reconcile job status with configured steps vs progress already on disk.
 *
 * - draft / cancelled / failed + current ≥ steps → complete (N/N means done)
 * - complete + current < steps → draft (raising steps reopens for further training)
 * - queued / running / paused unchanged (do not yank an active queue slot)
 */
export function statusAfterStepsCaughtUp(opts: {
  status: string
  currentStep?: number | null
  configSteps: number | string | null
}): string {
  const steps =
    typeof opts.configSteps === 'string' ? Number(opts.configSteps) : opts.configSteps
  if (typeof steps !== 'number' || !Number.isFinite(steps) || steps <= 0) return opts.status
  const target = Math.floor(steps)
  const current = resolveJobCurrentStep({ progressCurrentStep: opts.currentStep })

  if (opts.status === 'complete') {
    // Reopen only when a real checkpoint exists and the plan exceeds it.
    return current > 0 && current < target ? 'draft' : 'complete'
  }
  if (opts.status === 'draft' || opts.status === 'cancelled' || opts.status === 'failed') {
    return current >= target ? 'complete' : opts.status
  }
  return opts.status
}

/**
 * Read s/it from toolkit progress metrics.
 * Only valid during the Training phase — cache/preprocess rates are huge and
 * must not drive queue ETAs.
 */
export function readSecondsPerStep(progress: JobProgress | null | undefined): number | null {
  if (!progress || !isTrainingProgressPhase(progress)) return null
  if (
    typeof progress.secondsPerStep === 'number' &&
    Number.isFinite(progress.secondsPerStep) &&
    progress.secondsPerStep > 0
  ) {
    return progress.secondsPerStep
  }
  if (
    typeof progress.avgStepMs === 'number' &&
    Number.isFinite(progress.avgStepMs) &&
    progress.avgStepMs > 0
  ) {
    return progress.avgStepMs / 1000
  }
  if (
    typeof progress.stepsPerSecond === 'number' &&
    Number.isFinite(progress.stepsPerSecond) &&
    progress.stepsPerSecond > 0
  ) {
    return 1 / progress.stepsPerSecond
  }
  return null
}

export function remainingStepsForQueueJob(opts: {
  totalSteps: number
  status: JobStatus | string
  progress: JobProgress | null | undefined
  /** Prefer this over progress.currentStep when set (latest on-disk checkpoint). */
  checkpointStep?: number | null
}): number {
  const total = resolveJobTotalSteps({ totalSteps: opts.totalSteps })
  if (total <= 0) return 0
  if (opts.status === 'complete') return 0
  const current = resolveJobStepsLabelCurrent({
    status: opts.status,
    checkpointStep: opts.checkpointStep,
    progressCurrentStep: opts.progress?.currentStep,
    progress: opts.progress
  })
  if (current > 0 || opts.status === 'running' || opts.status === 'paused') {
    return Math.max(0, total - Math.min(current, total))
  }
  return total
}

/**
 * Seconds/step for ETA:
 * - running: sampled live rate (fallback cold-start 7s)
 * - paused / queued / idle: last known measured rate if we have one (no jump back to 7s)
 * - never seen a rate: cold-start 7s
 */
export function secondsPerStepForQueueJob(opts: {
  status: JobStatus | string
  progress: JobProgress | null | undefined
  /**
   * Live sample while a job is running, or the last measured rate retained
   * after training stops (offline ETA).
   */
  liveRateSecondsPerStep?: number | null
}): number {
  const known =
    typeof opts.liveRateSecondsPerStep === 'number' &&
    Number.isFinite(opts.liveRateSecondsPerStep) &&
    opts.liveRateSecondsPerStep > 0
      ? opts.liveRateSecondsPerStep
      : null
  const fromProgress = readSecondsPerStep(opts.progress)

  if (opts.status === 'running') {
    return known ?? fromProgress ?? QUEUE_SECONDS_PER_STEP
  }
  if (opts.status === 'paused') {
    return fromProgress ?? known ?? QUEUE_SECONDS_PER_STEP
  }
  return known ?? QUEUE_SECONDS_PER_STEP
}

export type QueueEtaEntry = {
  jobId: string
  /** This job's remaining training steps. */
  ownSteps: number
  /** Sum of remaining steps through this job (jobs ahead + self). */
  cumulativeSteps: number
  /** Duration of this job alone (ms). */
  ownDurationMs: number
  /** Wall time until this job finishes (ms), includes jobs ahead. */
  finishEtaMs: number
  /** s/it used for this row's duration. */
  secondsPerStep: number
  /** True when duration used a measured rate (not cold-start 7s). */
  usedLiveRate: boolean
}

/** Build per-row cumulative ETAs for the FIFO list. */
export function buildQueueEtas(opts: {
  orderedIds: string[]
  jobsById: Map<string, Pick<JobSummary, 'totalSteps' | 'progress' | 'checkpointStep'>>
  totalStepsById?: Record<string, number>
  statuses: Record<string, JobStatus | string>
  liveProgress: JobProgress | null
  runningJobId: string | null | undefined
  /** Sampled live s/it, or last known rate when idle. */
  liveRateSecondsPerStep?: number | null
}): QueueEtaEntry[] {
  const out: QueueEtaEntry[] = []
  let cumulativeSteps = 0
  let cumulativeMs = 0
  for (let i = 0; i < opts.orderedIds.length; i++) {
    const id = opts.orderedIds[i]!
    const job = opts.jobsById.get(id)
    const status = opts.statuses[id] ?? 'queued'
    const isActive = id === opts.runningJobId
    const progress = isActive
      ? (opts.liveProgress ?? job?.progress ?? null)
      : (job?.progress ?? null)
    const total = resolveJobTotalSteps({
      totalSteps: opts.totalStepsById?.[id] ?? job?.totalSteps,
      progressTotalSteps: progress?.totalSteps ?? job?.progress?.totalSteps,
      status
    })
    const ownSteps = remainingStepsForQueueJob({
      totalSteps: total,
      status,
      progress,
      checkpointStep: job?.checkpointStep
    })
    const secondsPerStep = secondsPerStepForQueueJob({
      status,
      progress,
      liveRateSecondsPerStep: opts.liveRateSecondsPerStep
    })
    const usedLiveRate = secondsPerStep !== QUEUE_SECONDS_PER_STEP
    const ownDurationMs = ownSteps * secondsPerStep * 1000
    cumulativeSteps += ownSteps
    cumulativeMs += ownDurationMs
    out.push({
      jobId: id,
      ownSteps,
      cumulativeSteps,
      ownDurationMs,
      finishEtaMs: cumulativeMs,
      secondsPerStep,
      usedLiveRate
    })
  }
  return out
}

/** @deprecated Prefer buildQueueEtas — kept for call sites/tests. */
export function queueFinishEtaMs(opts: {
  orderedIds: string[]
  index: number
  jobsById: Map<string, Pick<JobSummary, 'totalSteps' | 'progress' | 'checkpointStep'>>
  totalStepsById?: Record<string, number>
  statuses: Record<string, JobStatus | string>
  liveProgress: JobProgress | null
  runningJobId: string | null | undefined
  liveRateSecondsPerStep?: number | null
}): number {
  return buildQueueEtas(opts)[opts.index]?.finishEtaMs ?? 0
}

/** Human duration for queue ETAs (supports multi-day). */
export function formatQueueEtaMs(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const totalSec = Math.max(0, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const totalMin = Math.floor(totalSec / 60)
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins = totalMin % 60
  if (days > 0) {
    if (hours > 0) return `${days}d ${hours}h`
    return `${days}d`
  }
  if (totalMin >= 60) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return `${mins}m`
}
