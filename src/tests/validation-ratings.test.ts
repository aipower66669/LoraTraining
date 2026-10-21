import { describe, expect, it } from 'vitest'
import {
  averageCheckpointRating,
  emptyValidationRatings,
  formatAverageRating,
  getSetStemRating
} from '@shared/validation-ratings'

describe('validation ratings', () => {
  it('averages rated sets only', () => {
    const file = emptyValidationRatings()
    file.ratings['Set 1'] = { job_250: 5, job_500: 2 }
    file.ratings['Set 2'] = { job_250: 3 }
    expect(averageCheckpointRating(file, 'job_250')).toEqual({ average: 4, count: 2 })
    expect(averageCheckpointRating(file, 'job_500')).toEqual({ average: 2, count: 1 })
    expect(averageCheckpointRating(file, 'missing')).toEqual({ average: null, count: 0 })
  })

  it('includes zero ratings in the average', () => {
    const file = emptyValidationRatings()
    file.ratings['Set 1'] = { x: 0 }
    file.ratings['Set 2'] = { x: 4 }
    expect(averageCheckpointRating(file, 'x')).toEqual({ average: 2, count: 2 })
  })

  it('reads per-set ratings', () => {
    const file = emptyValidationRatings()
    file.ratings['Set 1'] = { a: 4 }
    expect(getSetStemRating(file, 'Set 1', 'a')).toBe(4)
    expect(getSetStemRating(file, 'Set 2', 'a')).toBeNull()
  })

  it('formats averages', () => {
    expect(formatAverageRating(null, 0)).toBe('—')
    expect(formatAverageRating(4, 2)).toBe('4★')
    expect(formatAverageRating(3.5, 2)).toBe('3.5★')
  })
})
