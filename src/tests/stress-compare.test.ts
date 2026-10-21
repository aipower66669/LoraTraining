import { describe, expect, it } from 'vitest'
import {
  orderStressCompareModels,
  orderStressCompareSets,
  remapStressCompareSetOrderAfterRemove
} from '@shared/stress-compare'

describe('orderStressCompareModels', () => {
  it('omits models not in the with-images set', () => {
    expect(
      orderStressCompareModels(['a', 'c'], ['a', 'b', 'c'], ['a', 'c'])
    ).toEqual(['a', 'c'])
  })

  it('appends unknown models after saved order', () => {
    expect(
      orderStressCompareModels(['a', 'b', 'c'], ['c'], ['a', 'b', 'c'])
    ).toEqual(['c', 'a', 'b'])
  })
})

describe('orderStressCompareSets', () => {
  it('defaults to newest activity first when saved order empty', () => {
    expect(
      orderStressCompareSets(
        [
          { setIndex: 0, activityMs: 100 },
          { setIndex: 1, activityMs: 300 },
          { setIndex: 2, activityMs: 200 }
        ],
        []
      )
    ).toEqual([1, 2, 0])
  })

  it('keeps saved order then appends new sets by activity', () => {
    expect(
      orderStressCompareSets(
        [
          { setIndex: 0, activityMs: 100 },
          { setIndex: 1, activityMs: 300 },
          { setIndex: 2, activityMs: 200 }
        ],
        [0, 2]
      )
    ).toEqual([0, 2, 1])
  })
})

describe('remapStressCompareSetOrderAfterRemove', () => {
  it('drops removed index and shifts later indices', () => {
    expect(remapStressCompareSetOrderAfterRemove([2, 0, 1], 1)).toEqual([1, 0])
  })
})
