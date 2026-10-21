import { describe, expect, it } from 'vitest'
import type { DatasetSummary } from '@shared/ipc/contract'
import { datasetLifecycleStatus } from '@shared/ipc/contract'
import {
  datasetHasOpenJob,
  datasetHasQueuedJob,
  openJobForDataset
} from '@shared/dataset-jobs'
import { datasetFullyCaptioned, missingCaptionCount, imagesFullyCaptioned, missingCaptionCountFromImages } from '@shared/schemas/dataset'
import { explorerStatus, isAtLeastReady, matchesStatusFilter, datasetListPriority, compareDatasetsForListPriority } from '@shared/explorer-status'

function ds(partial: Partial<DatasetSummary> & Pick<DatasetSummary, 'id' | 'ready'>): DatasetSummary {
  return {
    name: partial.name ?? partial.id,
    folderPath: `/x/${partial.id}`,
    categoryId: 'c',
    trigger: '',
    stats: { images: 1, captions: 1, stemCollisions: [] },
    updatedAt: '',
    coverFileName: null,
    trained: false,
    validated: false,
    done: false,
    status: 'none',
    ...partial
  }
}

describe('datasetLifecycleStatus', () => {
  it('returns none when no flags', () => {
    expect(datasetLifecycleStatus({ ready: false, trained: false, validated: false })).toBe('none')
  })

  it('prefers done over validated', () => {
    expect(
      datasetLifecycleStatus({ ready: true, trained: true, validated: true, done: true })
    ).toBe('done')
  })

  it('prefers validated over trained and ready', () => {
    expect(datasetLifecycleStatus({ ready: true, trained: true, validated: true })).toBe(
      'validated'
    )
  })

  it('prefers trained over ready', () => {
    expect(datasetLifecycleStatus({ ready: true, trained: true, validated: false })).toBe(
      'trained'
    )
  })

  it('shows ready when only ready', () => {
    expect(datasetLifecycleStatus({ ready: true, trained: false, validated: false })).toBe('ready')
  })
})

describe('dataset open jobs', () => {
  const jobs = [
    { id: 'a', datasetId: 'ds1', status: 'draft' as const, archived: false },
    { id: 'b', datasetId: 'ds2', status: 'queued' as const, archived: false },
    { id: 'c', datasetId: 'ds3', status: 'complete' as const, archived: false },
    { id: 'd', datasetId: 'ds4', status: 'running' as const, archived: true },
    { id: 'e', datasetId: 'ds5', status: 'failed' as const, archived: false }
  ]

  it('treats any non-archived job as blocking Create Job', () => {
    expect(datasetHasOpenJob(jobs, 'ds1')).toBe(true)
    expect(datasetHasOpenJob(jobs, 'ds2')).toBe(true)
    expect(datasetHasOpenJob(jobs, 'ds3')).toBe(true)
    expect(datasetHasOpenJob(jobs, 'ds4')).toBe(false)
    expect(datasetHasOpenJob(jobs, 'ds5')).toBe(true)
  })

  it('Queue tab only counts queued/running/paused — not draft', () => {
    expect(datasetHasQueuedJob(jobs, 'ds1')).toBe(false)
    expect(datasetHasQueuedJob(jobs, 'ds2')).toBe(true)
    expect(datasetHasQueuedJob(jobs, 'ds3')).toBe(false)
    expect(datasetHasQueuedJob(jobs, 'ds4')).toBe(false)
  })

  it('returns the preferred non-archived job id', () => {
    expect(openJobForDataset(jobs, 'ds2')?.id).toBe('b')
    expect(openJobForDataset(jobs, 'ds3')?.id).toBe('c')
    expect(openJobForDataset(jobs, 'ds4')).toBeNull()
  })
})

describe('explorerStatus / matchesStatusFilter', () => {
  it('shows queued only when actually in the training queue', () => {
    expect(explorerStatus(ds({ id: 'x', ready: true }), true)).toBe('queued')
  })

  it('shows ready when ready and not in queue (draft jobs still Ready)', () => {
    expect(explorerStatus(ds({ id: 'x', ready: true }), false)).toBe('ready')
  })

  it('Ready filter excludes datasets in the training queue only', () => {
    const ready = ds({ id: 'r', ready: true })
    expect(matchesStatusFilter(ready, 'ready', false)).toBe(true)
    expect(matchesStatusFilter(ready, 'ready', true)).toBe(false)
    expect(matchesStatusFilter(ready, 'queued', true)).toBe(true)
    expect(matchesStatusFilter(ready, 'queued', false)).toBe(false)
  })

  it('Trained, Validated, and Done filters are exclusive', () => {
    const trainedOnly = ds({ id: 't', ready: true, trained: true, validated: false })
    const validated = ds({ id: 'v', ready: true, trained: true, validated: true })
    const done = ds({ id: 'd', ready: true, trained: true, validated: true, done: true })
    expect(matchesStatusFilter(trainedOnly, 'trained', false)).toBe(true)
    expect(matchesStatusFilter(trainedOnly, 'validated', false)).toBe(false)
    expect(matchesStatusFilter(validated, 'trained', false)).toBe(false)
    expect(matchesStatusFilter(validated, 'validated', false)).toBe(true)
    expect(matchesStatusFilter(validated, 'done', false)).toBe(false)
    expect(matchesStatusFilter(done, 'validated', false)).toBe(false)
    expect(matchesStatusFilter(done, 'done', false)).toBe(true)
    expect(explorerStatus(done, false)).toBe('done')
  })

  it('isAtLeastReady excludes Not ready only', () => {
    const notReady = ds({ id: 'n', ready: false })
    const ready = ds({ id: 'r', ready: true })
    const trained = ds({ id: 't', ready: true, trained: true })
    const validated = ds({ id: 'v', ready: true, trained: true, validated: true })
    const done = ds({ id: 'd', ready: true, trained: true, validated: true, done: true })
    expect(isAtLeastReady(notReady, false)).toBe(false)
    expect(isAtLeastReady(notReady, true)).toBe(true) // queued counts as Ready+
    expect(isAtLeastReady(ready, false)).toBe(true)
    expect(isAtLeastReady(ready, true)).toBe(true)
    expect(isAtLeastReady(trained, false)).toBe(true)
    expect(isAtLeastReady(validated, false)).toBe(true)
    expect(isAtLeastReady(done, false)).toBe(true)
  })
})

describe('datasetListPriority', () => {
  it('puts the active tab first and Done last', () => {
    const ready = ds({ id: 'r', ready: true, updatedAt: '2020' })
    const validated = ds({
      id: 'v',
      ready: true,
      trained: true,
      validated: true,
      updatedAt: '2021'
    })
    const done = ds({
      id: 'd',
      ready: true,
      trained: true,
      validated: true,
      done: true,
      updatedAt: '2022'
    })
    expect(datasetListPriority(validated, 'validated', false)).toBe(0)
    expect(datasetListPriority(ready, 'validated', false)).toBe(50)
    expect(datasetListPriority(done, 'validated', false)).toBe(100)
    expect(datasetListPriority(done, 'done', false)).toBe(0)
    expect(datasetListPriority(done, 'all', false)).toBe(100)
  })

  it('sorts Queue tab matches ahead of Done', () => {
    const queued = ds({ id: 'q', ready: true, updatedAt: '2020' })
    const done = ds({
      id: 'd',
      ready: true,
      trained: true,
      validated: true,
      done: true,
      updatedAt: '2022'
    })
    expect(
      compareDatasetsForListPriority(queued, done, 'queued', true, false)
    ).toBeLessThan(0)
    expect(
      compareDatasetsForListPriority(done, queued, 'queued', false, true)
    ).toBeGreaterThan(0)
  })
})

describe('datasetFullyCaptioned', () => {
  it('requires every image to have a caption', () => {
    expect(datasetFullyCaptioned({ images: 0, captions: 0 })).toBe(false)
    expect(datasetFullyCaptioned({ images: 3, captions: 2 })).toBe(false)
    expect(datasetFullyCaptioned({ images: 3, captions: 3 })).toBe(true)
    expect(datasetFullyCaptioned({ images: 3, captions: 4 })).toBe(true)
  })

  it('counts missing captions', () => {
    expect(missingCaptionCount({ images: 5, captions: 2 })).toBe(3)
    expect(missingCaptionCount({ images: 2, captions: 2 })).toBe(0)
  })

  it('uses per-image flags when detail is open', () => {
    expect(imagesFullyCaptioned([])).toBe(false)
    expect(
      imagesFullyCaptioned([{ captionExists: true }, { captionExists: true }])
    ).toBe(true)
    expect(
      imagesFullyCaptioned([{ captionExists: true }, { captionExists: false }])
    ).toBe(false)
    expect(
      missingCaptionCountFromImages([{ captionExists: true }, { captionExists: false }])
    ).toBe(1)
  })
})
