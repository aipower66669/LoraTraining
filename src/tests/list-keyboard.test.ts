import { describe, expect, it } from 'vitest'
import { cycleIndex, isEditableKeyboardTarget } from '../renderer/util/listKeyboard'

describe('cycleIndex', () => {
  it('wraps at ends', () => {
    expect(cycleIndex(3, 2, 1)).toBe(0)
    expect(cycleIndex(3, 0, -1)).toBe(2)
    expect(cycleIndex(3, 1, 1)).toBe(2)
  })

  it('picks an end when current is invalid', () => {
    expect(cycleIndex(4, -1, 1)).toBe(0)
    expect(cycleIndex(4, -1, -1)).toBe(3)
    expect(cycleIndex(0, 0, 1)).toBe(-1)
  })
})

describe('isEditableKeyboardTarget', () => {
  it('ignores null', () => {
    expect(isEditableKeyboardTarget(null)).toBe(false)
  })
})
