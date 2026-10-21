import { describe, expect, it, vi } from 'vitest'
import type { AppEvent, JobProgress, JobSummary, QueueSnapshot } from '@shared/ipc/contract'
import { applyEvent } from '../renderer/store/eventHandlers'
import type { AppStateGet, AppStateSet } from '../renderer/store/types'

function emptyProgress(): JobProgress {
  return {
    currentStep: 10,
    totalSteps: 100,
    percent: 10,
    elapsedMs: 1000,
    pausedMs: 0,
    etaMs: 9000,
    avgStepMs: 100,
    secondsPerStep: 0.1,
    stepsPerSecond: 10,
    lastMessage: 'step',
    updatedAt: '2020-01-01T00:00:00.000Z'
  }
}

function makeQueue(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    jobIds: ['job-b'],
    runningJobId: null,
    statuses: { 'job-b': 'queued' },
    totalSteps: { 'job-b': 100 },
    stopAfterCurrent: false,
    ...overrides
  }
}

function makeJob(id: string, status: JobSummary['status']): JobSummary {
  return {
    id,
    name: id,
    datasetId: 'ds1',
    status,
    archived: false,
    updatedAt: '2020-01-01T00:00:00.000Z',
    progress: null,
    lastError: null,
    totalSteps: 100,
    checkpointStep: 0,
    saveEvery: 0
  }
}

describe('queue UI event handlers', () => {
  it('applies queue-updated snapshot directly (no list round-trip)', () => {
    let state = { queue: makeQueue() as QueueSnapshot | null, jobs: [] as JobSummary[] }
    const set = ((partial: Partial<typeof state> | ((s: typeof state) => Partial<typeof state>)) => {
      if (typeof partial === 'function') {
        state = { ...state, ...partial(state) }
      } else {
        state = { ...state, ...partial }
      }
    }) as AppStateSet
    const get = (() => state) as unknown as AppStateGet

    const snap = makeQueue({ runningJobId: 'job-b', statuses: { 'job-b': 'running' } })
    applyEvent(set, get, { type: 'queue-updated', payload: snap })
    expect(state.queue?.runningJobId).toBe('job-b')
    expect(state.queue?.statuses['job-b']).toBe('running')
  })

  it('self-heals idle queue/jobs when process-metrics arrive for a running job', () => {
    let state = {
      queue: makeQueue({ runningJobId: null, statuses: { 'job-b': 'queued' } }),
      jobs: [makeJob('job-b', 'queued')],
      liveProgress: null as JobProgress | null
    }
    const set = ((partial: Partial<typeof state> | ((s: typeof state) => Partial<typeof state>)) => {
      if (typeof partial === 'function') {
        state = { ...state, ...partial(state) }
      } else {
        state = { ...state, ...partial }
      }
    }) as AppStateSet
    const get = (() => state) as unknown as AppStateGet

    const progress = emptyProgress()
    const event: AppEvent = {
      type: 'process-metrics',
      payload: { jobId: 'job-b', progress }
    }
    applyEvent(set, get, event)

    expect(state.liveProgress).toEqual(progress)
    expect(state.queue?.runningJobId).toBe('job-b')
    expect(state.queue?.statuses['job-b']).toBe('running')
    expect(state.jobs[0]?.status).toBe('running')
  })

  it('does not clear liveProgress for a late terminal update of a different job', () => {
    const progress = emptyProgress()
    let state = {
      queue: makeQueue({ runningJobId: 'job-b', statuses: { 'job-b': 'running' } }),
      jobs: [makeJob('job-a', 'complete'), makeJob('job-b', 'running')],
      datasets: [] as { id: string }[],
      datasetDetail: null,
      liveProgress: progress,
      refreshJobs: vi.fn(async () => undefined)
    }
    const set = ((partial: Partial<typeof state> | ((s: typeof state) => Partial<typeof state>)) => {
      if (typeof partial === 'function') {
        state = { ...state, ...partial(state) }
      } else {
        state = { ...state, ...partial }
      }
    }) as AppStateSet
    const get = (() => state) as unknown as AppStateGet

    applyEvent(set, get, {
      type: 'job-updated',
      payload: { jobId: 'job-a', status: 'complete', datasetId: 'ds1' }
    })

    expect(state.liveProgress).toEqual(progress)
  })
})
