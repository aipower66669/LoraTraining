import { describe, expect, it } from 'vitest'
import { formatLibraryLoadStatus } from '@shared/library-load-progress'

describe('formatLibraryLoadStatus', () => {
  it('shows counts and percent when total is known', () => {
    expect(
      formatLibraryLoadStatus({
        phase: 'enrich',
        done: 30,
        total: 100,
        message: 'Updating dataset badges…'
      })
    ).toBe('Updating dataset badges… (30/100 · 30%)')
  })

  it('omits counts when total is unknown', () => {
    expect(
      formatLibraryLoadStatus({
        phase: 'sync',
        done: 0,
        total: 0,
        message: 'Discovering datasets…'
      })
    ).toBe('Discovering datasets…')
  })

  it('returns Ready when done', () => {
    expect(
      formatLibraryLoadStatus({
        phase: 'done',
        done: 10,
        total: 10,
        message: 'Ready'
      })
    ).toBe('Ready')
  })
})
