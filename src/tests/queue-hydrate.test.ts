import { describe, expect, it } from 'vitest'
import {
  buildQueueIdsFromJobs,
  statusAfterRestart,
  type QueueHydrateJob
} from '@shared/queue-hydrate'

function job(partial: Partial<QueueHydrateJob> & Pick<QueueHydrateJob, 'id' | 'status'>): QueueHydrateJob {
  return {
    archived: false,
    queueOrder: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

describe('buildQueueIdsFromJobs', () => {
  it('restores queued jobs by queueOrder', () => {
    const ids = buildQueueIdsFromJobs([
      job({ id: 'b', status: 'queued', queueOrder: 1 }),
      job({ id: 'a', status: 'queued', queueOrder: 0 }),
      job({ id: 'draft', status: 'draft', queueOrder: null }),
      job({ id: 'done', status: 'complete', queueOrder: null })
    ])
    expect(ids).toEqual(['a', 'b'])
  })

  it('skips archived jobs', () => {
    const ids = buildQueueIdsFromJobs([
      job({ id: 'x', status: 'queued', queueOrder: 0, archived: true }),
      job({ id: 'y', status: 'queued', queueOrder: 1 })
    ])
    expect(ids).toEqual(['y'])
  })

  it('puts running/paused ahead when order is missing', () => {
    const ids = buildQueueIdsFromJobs([
      job({ id: 'q', status: 'queued', updatedAt: '2026-01-01T00:00:00.000Z' }),
      job({ id: 'p', status: 'paused', updatedAt: '2026-01-02T00:00:00.000Z' })
    ])
    expect(ids[0]).toBe('p')
  })

  it('restores cancelled jobs that still have a queueOrder', () => {
    const ids = buildQueueIdsFromJobs([
      job({ id: 'old', status: 'cancelled', queueOrder: null }),
      job({ id: 'kept', status: 'cancelled', queueOrder: 0 }),
      job({ id: 'q', status: 'queued', queueOrder: 1 })
    ])
    expect(ids).toEqual(['kept', 'q'])
  })
  it('keeps paused job at its saved queueOrder after restart', () => {
    const ids = buildQueueIdsFromJobs([
      job({ id: 'q1', status: 'queued', queueOrder: 1 }),
      job({ id: 'paused', status: 'paused', queueOrder: 0 }),
      job({ id: 'q2', status: 'queued', queueOrder: 2 })
    ])
    expect(ids).toEqual(['paused', 'q1', 'q2'])
  })
})

describe('statusAfterRestart', () => {
  it('demotes running to paused', () => {
    expect(statusAfterRestart('running')).toBe('paused')
    expect(statusAfterRestart('queued')).toBe('queued')
    expect(statusAfterRestart('paused')).toBe('paused')
  })
})
