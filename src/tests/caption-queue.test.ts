import { describe, expect, it } from 'vitest'
import {
  captionCancelMatchesSession,
  computeAggregateCaptionProgress,
  type CaptionQueueJob
} from '@shared/caption-queue'

describe('computeAggregateCaptionProgress', () => {
  it('sums session + current + pending estimates', () => {
    expect(
      computeAggregateCaptionProgress({
        sessionCompleted: 10,
        currentCompleted: 3,
        currentTotal: 8,
        pendingPlannedTotals: [5, 2]
      })
    ).toEqual({ completed: 13, total: 10 + 8 + 5 + 2 })
  })

  it('handles idle-like zeros', () => {
    expect(
      computeAggregateCaptionProgress({
        sessionCompleted: 0,
        currentCompleted: 0,
        currentTotal: 0,
        pendingPlannedTotals: []
      })
    ).toEqual({ completed: 0, total: 0 })
  })

  it('uses currentTotal even when completed catches up', () => {
    expect(
      computeAggregateCaptionProgress({
        sessionCompleted: 4,
        currentCompleted: 6,
        currentTotal: 6,
        pendingPlannedTotals: [3]
      })
    ).toEqual({ completed: 10, total: 13 })
  })
})

describe('captionCancelMatchesSession', () => {
  it('matches active run', () => {
    expect(captionCancelMatchesSession('a', 'a', ['b'])).toBe(true)
  })

  it('matches a pending run id', () => {
    expect(captionCancelMatchesSession('b', 'a', ['b', 'c'])).toBe(true)
  })

  it('rejects unknown ids', () => {
    expect(captionCancelMatchesSession('z', 'a', ['b'])).toBe(false)
  })
})

describe('CaptionQueueJob freeze fields', () => {
  it('holds per-job mode and trigger for serial drain', () => {
    const jobs: CaptionQueueJob[] = [
      {
        runId: '1',
        datasetId: 'ds-a',
        mode: 'missing',
        guidance: 'cat',
        prependTrigger: true,
        triggerToken: 'ohwx',
        plannedTotal: 12
      },
      {
        runId: '2',
        datasetId: 'ds-b',
        mode: 'append',
        guidance: null,
        prependTrigger: false,
        triggerToken: '',
        plannedTotal: 4
      }
    ]
    expect(jobs.map((j) => j.mode)).toEqual(['missing', 'append'])
    expect(jobs[0]!.triggerToken).toBe('ohwx')
    expect(
      computeAggregateCaptionProgress({
        sessionCompleted: 0,
        currentCompleted: 0,
        currentTotal: jobs[0]!.plannedTotal,
        pendingPlannedTotals: jobs.slice(1).map((j) => j.plannedTotal)
      }).total
    ).toBe(16)
  })
})
