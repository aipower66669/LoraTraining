import { describe, expect, it } from 'vitest'
import { wrapIndex } from '@shared/keyboard'

describe('wrapIndex', () => {
  it('wraps forward and backward', () => {
    expect(wrapIndex(3, 3)).toBe(0)
    expect(wrapIndex(-1, 3)).toBe(2)
    expect(wrapIndex(1, 3)).toBe(1)
  })

  it('handles empty length', () => {
    expect(wrapIndex(0, 0)).toBe(0)
  })
})
