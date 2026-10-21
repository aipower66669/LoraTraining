import { describe, expect, it } from 'vitest'
import {
  QUEUE_SECONDS_PER_STEP,
  buildQueueEtas,
  formatJobStepsLabel,
  formatQueueEtaMs,
  readSecondsPerStep,
  remainingStepsForQueueJob,
  resolveJobStepsLabelCurrent,
  resolveJobTotalSteps,
  secondsPerStepForQueueJob,
  statusAfterStepsCaughtUp
} from '../shared/queue-eta'

describe('queue ETA', () => {
  it('resolves steps from config when progress has none', () => {
    expect(
      resolveJobTotalSteps({
        progressTotalSteps: undefined,
        configSteps: 2000
      })
    ).toBe(2000)
  })

  it('prefers config over stale progress for queued jobs', () => {
    expect(
      resolveJobTotalSteps({
        progressTotalSteps: 2000,
        configSteps: 3500,
        status: 'queued'
      })
    ).toBe(3500)
  })

  it('always prefers user config over tqdm progress total (even while running)', () => {
    expect(
      resolveJobTotalSteps({
        progressTotalSteps: 1998,
        configSteps: 2000,
        status: 'running'
      })
    ).toBe(2000)
    expect(
      resolveJobTotalSteps({
        progressTotalSteps: 2000,
        configSteps: 3500,
        status: 'running'
      })
    ).toBe(3500)
  })

  it('formats started jobs as current/total', () => {
    expect(formatJobStepsLabel(0, 2500)).toBe('2,500')
    expect(formatJobStepsLabel(500, 2500)).toBe('500/2,500')
    expect(formatJobStepsLabel(1000, 1000)).toBe('1,000/1,000')
  })

  it('resolves label current from checkpoint only when stopped', () => {
    expect(
      resolveJobStepsLabelCurrent({
        status: 'queued',
        checkpointStep: 500,
        progressCurrentStep: 512
      })
    ).toBe(500)
    // Stale tqdm must not drive the label (often total−2).
    expect(
      resolveJobStepsLabelCurrent({
        status: 'queued',
        checkpointStep: 0,
        progressCurrentStep: 500
      })
    ).toBe(0)
    expect(
      resolveJobStepsLabelCurrent({
        status: 'complete',
        checkpointStep: 0,
        progressCurrentStep: 2998
      })
    ).toBe(0)
    expect(
      resolveJobStepsLabelCurrent({
        status: 'running',
        checkpointStep: 500,
        progressCurrentStep: 612,
        liveCurrentStep: 620,
        progress: {
          lastMessage: 'Training',
          currentStep: 620,
          totalSteps: 2500,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: '2020-01-01T00:00:00.000Z'
        }
      })
    ).toBe(620)
    // Pre-train phases (cache, etc.) must not show tqdm current against train.steps.
    expect(
      resolveJobStepsLabelCurrent({
        status: 'running',
        checkpointStep: 0,
        progressCurrentStep: 30,
        liveCurrentStep: 30,
        progress: {
          lastMessage: 'Caching latents to disk',
          currentStep: 30,
          totalSteps: 200,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: '2020-01-01T00:00:00.000Z'
        }
      })
    ).toBe(0)
    expect(
      resolveJobStepsLabelCurrent({
        status: 'running',
        checkpointStep: 500,
        progressCurrentStep: 30,
        liveCurrentStep: 30,
        progress: {
          lastMessage: 'Caching text embeddings to disk',
          currentStep: 30,
          totalSteps: 200,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: '2020-01-01T00:00:00.000Z'
        }
      })
    ).toBe(500)
  })

  it('ignores non-Training rates for s/it', () => {
    expect(
      readSecondsPerStep({
        lastMessage: 'Caching latents to disk',
        secondsPerStep: 0.0002,
        currentStep: 30,
        totalSteps: 200,
        elapsedMs: 0,
        pausedMs: 0,
        updatedAt: '2020-01-01T00:00:00.000Z'
      })
    ).toBeNull()
    expect(
      readSecondsPerStep({
        lastMessage: 'Training',
        secondsPerStep: 3.5,
        currentStep: 100,
        totalSteps: 2500,
        elapsedMs: 0,
        pausedMs: 0,
        updatedAt: '2020-01-01T00:00:00.000Z'
      })
    ).toBe(3.5)
  })

  it('promotes cancelled/failed/draft to complete when steps caught up (N/N)', () => {
    expect(
      statusAfterStepsCaughtUp({ status: 'cancelled', currentStep: 1000, configSteps: 1000 })
    ).toBe('complete')
    expect(
      statusAfterStepsCaughtUp({ status: 'failed', currentStep: 1200, configSteps: 1000 })
    ).toBe('complete')
    expect(
      statusAfterStepsCaughtUp({ status: 'draft', currentStep: 1000, configSteps: 1000 })
    ).toBe('complete')
    expect(
      statusAfterStepsCaughtUp({ status: 'cancelled', currentStep: 500, configSteps: 2500 })
    ).toBe('cancelled')
    expect(
      statusAfterStepsCaughtUp({ status: 'draft', currentStep: 500, configSteps: 1000 })
    ).toBe('draft')
    expect(
      statusAfterStepsCaughtUp({ status: 'queued', currentStep: 1000, configSteps: 1000 })
    ).toBe('queued')
  })

  it('demotes complete to draft when steps are raised past the checkpoint', () => {
    expect(
      statusAfterStepsCaughtUp({ status: 'complete', currentStep: 1000, configSteps: 2000 })
    ).toBe('draft')
    expect(
      statusAfterStepsCaughtUp({ status: 'complete', currentStep: 1000, configSteps: 1000 })
    ).toBe('complete')
    expect(
      statusAfterStepsCaughtUp({ status: 'complete', currentStep: 1000, configSteps: 500 })
    ).toBe('complete')
    // No checkpoint on disk — do not reopen a complete job just because steps are high.
    expect(
      statusAfterStepsCaughtUp({ status: 'complete', currentStep: 0, configSteps: 2000 })
    ).toBe('complete')
  })

  it('uses remaining steps for queued jobs with a checkpoint', () => {
    expect(
      remainingStepsForQueueJob({
        totalSteps: 2500,
        status: 'queued',
        checkpointStep: 500,
        progress: {
          currentStep: 512,
          totalSteps: 2500,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: ''
        }
      })
    ).toBe(2000)
  })

  it('ignores tqdm progress for remaining when no checkpoint', () => {
    expect(
      remainingStepsForQueueJob({
        totalSteps: 2500,
        status: 'queued',
        progress: {
          currentStep: 500,
          totalSteps: 2500,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: ''
        }
      })
    ).toBe(2500)
  })

  it('complete jobs have no remaining steps', () => {
    expect(
      remainingStepsForQueueJob({
        totalSteps: 3000,
        status: 'complete',
        progress: {
          currentStep: 2998,
          totalSteps: 3000,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: ''
        }
      })
    ).toBe(0)
  })

  it('uses full steps for queued jobs', () => {
    expect(
      remainingStepsForQueueJob({ totalSteps: 100, status: 'queued', progress: null })
    ).toBe(100)
  })

  it('subtracts current step for running jobs', () => {
    expect(
      remainingStepsForQueueJob({
        totalSteps: 100,
        status: 'running',
        progress: {
          lastMessage: 'Training',
          currentStep: 40,
          totalSteps: 100,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: ''
        }
      })
    ).toBe(60)
  })

  it('does not subtract cache-phase tqdm from train.steps remaining', () => {
    expect(
      remainingStepsForQueueJob({
        totalSteps: 5000,
        status: 'running',
        progress: {
          lastMessage: 'Caching latents to disk',
          currentStep: 30,
          totalSteps: 200,
          secondsPerStep: 0.0002,
          elapsedMs: 0,
          pausedMs: 0,
          updatedAt: ''
        }
      })
    ).toBe(5000)
  })

  it('uses last measured rate for queued jobs (no blend / no jump to 7s)', () => {
    expect(
      secondsPerStepForQueueJob({ status: 'queued', progress: null, liveRateSecondsPerStep: null })
    ).toBe(QUEUE_SECONDS_PER_STEP)
    expect(
      secondsPerStepForQueueJob({ status: 'queued', progress: null, liveRateSecondsPerStep: 3 })
    ).toBe(3)
    expect(
      secondsPerStepForQueueJob({
        status: 'running',
        progress: null,
        liveRateSecondsPerStep: 3.1
      })
    ).toBe(3.1)
  })

  it('accumulates with the same measured rate for running + queued', () => {
    const jobsById = new Map([
      ['a', { totalSteps: 100, progress: null, checkpointStep: 0 }],
      ['b', { totalSteps: 200, progress: null, checkpointStep: 0 }]
    ])
    const etas = buildQueueEtas({
      orderedIds: ['a', 'b'],
      jobsById,
      totalStepsById: { a: 100, b: 200 },
      statuses: { a: 'running', b: 'queued' },
      liveProgress: {
        lastMessage: 'Training',
        currentStep: 40,
        totalSteps: 100,
        elapsedMs: 0,
        pausedMs: 0,
        secondsPerStep: 3,
        updatedAt: ''
      },
      runningJobId: 'a',
      liveRateSecondsPerStep: 3
    })
    // running: 60 steps * 3s; queued: 200 * 3s (same last measured rate)
    expect(etas[0]!.ownSteps).toBe(60)
    expect(etas[0]!.ownDurationMs).toBe(60 * 3 * 1000)
    expect(etas[0]!.usedLiveRate).toBe(true)
    expect(etas[1]!.secondsPerStep).toBe(3)
    expect(etas[1]!.ownDurationMs).toBe(200 * 3 * 1000)
    expect(etas[1]!.finishEtaMs).toBe(60 * 3 * 1000 + 200 * 3 * 1000)
  })

  it('accumulates different step counts per row at 7s when idle with no measured rate', () => {
    const jobsById = new Map([
      ['a', { totalSteps: 0, progress: null, checkpointStep: 0 }],
      ['b', { totalSteps: 0, progress: null, checkpointStep: 0 }],
      ['c', { totalSteps: 0, progress: null, checkpointStep: 0 }]
    ])
    const etas = buildQueueEtas({
      orderedIds: ['a', 'b', 'c'],
      jobsById,
      totalStepsById: { a: 2000, b: 3000, c: 2000 },
      statuses: { a: 'queued', b: 'queued', c: 'queued' },
      liveProgress: null,
      runningJobId: null
    })
    expect(etas.map((e) => e.ownSteps)).toEqual([2000, 3000, 2000])
    expect(etas.map((e) => e.cumulativeSteps)).toEqual([2000, 5000, 7000])
    expect(etas[0]!.finishEtaMs).toBe(2000 * QUEUE_SECONDS_PER_STEP * 1000)
    expect(etas[1]!.finishEtaMs).toBe(5000 * QUEUE_SECONDS_PER_STEP * 1000)
    expect(etas[2]!.finishEtaMs).toBe(7000 * QUEUE_SECONDS_PER_STEP * 1000)
    expect(formatQueueEtaMs(etas[0]!.finishEtaMs)).toBe('3h 53m')
    expect(formatQueueEtaMs(etas[1]!.finishEtaMs)).toBe('9h 43m')
    expect(formatQueueEtaMs(etas[2]!.finishEtaMs)).toBe('13h 36m')
  })

  it('formats multi-day totals', () => {
    expect(formatQueueEtaMs(19000 * QUEUE_SECONDS_PER_STEP * 1000)).toBe('1d 12h')
  })
})
