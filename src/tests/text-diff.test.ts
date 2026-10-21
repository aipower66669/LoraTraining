import { describe, expect, it } from 'vitest'
import {
  diffTokens,
  partsForAfter,
  partsForBefore,
  tokenizeForDiff
} from '@shared/text-diff'

describe('text-diff', () => {
  it('tokenizes words and whitespace', () => {
    expect(tokenizeForDiff('a, b')).toEqual(['a,', ' ', 'b'])
  })

  it('highlights a prefix addition', () => {
    const parts = diffTokens('cat', 'ohwx cat')
    expect(partsForBefore(parts).map((p) => p.text).join('')).toBe('cat')
    expect(partsForAfter(parts).some((p) => p.type === 'add' && p.text.includes('ohwx'))).toBe(
      true
    )
  })

  it('highlights a removal', () => {
    const parts = diffTokens('red blue green', 'red green')
    const removed = parts.filter((p) => p.type === 'remove').map((p) => p.text).join('')
    expect(removed).toContain('blue')
    expect(partsForAfter(parts).map((p) => p.text).join('')).toBe('red green')
  })

  it('handles empty to text', () => {
    const parts = diffTokens('', 'hello')
    expect(parts).toEqual([{ type: 'add', text: 'hello' }])
    expect(partsForBefore(parts)).toEqual([])
  })
})
