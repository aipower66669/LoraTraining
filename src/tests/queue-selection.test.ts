import { describe, expect, it } from 'vitest'
import {
  dropSlotFromPointer,
  moveIdsBeforeIndex,
  moveIdsToSlot,
  rangeIdsInclusive
} from '../shared/queue-selection'

describe('queue selection helpers', () => {
  it('builds an inclusive range in list order', () => {
    expect(rangeIdsInclusive(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIdsInclusive(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeIdsInclusive(['a', 'b', 'c'], 'a', 'a')).toEqual(['a'])
  })

  it('picks before/after from pointer Y', () => {
    expect(dropSlotFromPointer(2, 10, 0, 40)).toBe(2)
    expect(dropSlotFromPointer(2, 30, 0, 40)).toBe(3)
  })

  it('moves a single id before the drop target', () => {
    expect(moveIdsBeforeIndex(['a', 'b', 'c'], ['a'], 2)).toEqual(['b', 'a', 'c'])
    expect(moveIdsBeforeIndex(['a', 'b', 'c'], ['c'], 0)).toEqual(['c', 'a', 'b'])
  })

  it('moves via insert slot (before index / append)', () => {
    expect(moveIdsToSlot(['a', 'b', 'c'], ['a'], 3)).toEqual(['b', 'c', 'a'])
    expect(moveIdsToSlot(['a', 'b', 'c'], ['c'], 0)).toEqual(['c', 'a', 'b'])
    expect(moveIdsToSlot(['a', 'b', 'c', 'd'], ['b', 'c'], 4)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves a multi selection as one block', () => {
    expect(moveIdsBeforeIndex(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 4)).toEqual([
      'a',
      'c',
      'b',
      'd',
      'e'
    ])
    expect(moveIdsBeforeIndex(['a', 'b', 'c', 'd'], ['c', 'd'], 0)).toEqual([
      'c',
      'd',
      'a',
      'b'
    ])
  })

  it('returns null when dropping onto the moving block or no change', () => {
    expect(moveIdsBeforeIndex(['a', 'b', 'c'], ['a', 'b'], 1)).toBeNull()
    expect(moveIdsBeforeIndex(['a', 'b', 'c'], ['b'], 1)).toBeNull()
    expect(moveIdsToSlot(['a', 'b', 'c'], ['a'], 0)).toBeNull()
    expect(moveIdsToSlot(['a', 'b', 'c'], ['a'], 1)).toBeNull()
  })
})
