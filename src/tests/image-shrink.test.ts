import { describe, expect, it } from 'vitest'
import { formatShrinkSample, shrinkTargetSize, SHRINK_MIN_EDGE } from '@shared/image-shrink'

describe('shrinkTargetSize', () => {
  it('returns null when shortest edge is already within minEdge', () => {
    expect(shrinkTargetSize(1024, 1024)).toBeNull()
    expect(shrinkTargetSize(800, 600)).toBeNull()
    expect(shrinkTargetSize(1024, 2048)).toBeNull()
    expect(shrinkTargetSize(1500, 1024)).toBeNull()
  })

  it('scales so the shortest edge is exactly minEdge (longer side stays larger)', () => {
    expect(shrinkTargetSize(2048, 1024)).toBeNull() // shortest already 1024
    expect(shrinkTargetSize(2048, 1536)).toEqual({ width: 1365, height: 1024 })
    expect(shrinkTargetSize(1536, 2048)).toEqual({ width: 1024, height: 1365 })
    expect(shrinkTargetSize(2048, 2048)).toEqual({ width: 1024, height: 1024 })
    expect(shrinkTargetSize(3000, 2000)).toEqual({ width: 1536, height: 1024 })
  })

  it('does not enlarge', () => {
    expect(shrinkTargetSize(512, 256, SHRINK_MIN_EDGE)).toBeNull()
  })

  it('formats preview samples', () => {
    expect(formatShrinkSample({ width: 2048, height: 1536 }, { width: 1365, height: 1024 })).toEqual(
      {
        before: '2048×1536',
        after: '1365×1024'
      }
    )
  })
})
