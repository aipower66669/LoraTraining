import { describe, expect, it } from 'vitest'
import { isValidationCompleteForSets } from '@shared/validation-completeness'

describe('isValidationCompleteForSets', () => {
  it('requires every keep-in-Comfy stem in every set', () => {
    const previews = new Map<number, Set<string>>([
      [0, new Set(['a', 'b'])],
      [1, new Set(['a', 'b'])]
    ])
    expect(
      isValidationCompleteForSets({
        setCount: 2,
        keepInComfyStems: ['a', 'b'],
        previewStemsBySet: previews
      })
    ).toBe(true)
  })

  it('fails when a set is missing a stem', () => {
    const previews = new Map<number, Set<string>>([
      [0, new Set(['a', 'b'])],
      [1, new Set(['a'])]
    ])
    expect(
      isValidationCompleteForSets({
        setCount: 2,
        keepInComfyStems: ['a', 'b'],
        previewStemsBySet: previews
      })
    ).toBe(false)
  })

  it('ignores unticked stems (not in keepInComfyStems)', () => {
    const previews = new Map<number, Set<string>>([[0, new Set(['a'])]])
    expect(
      isValidationCompleteForSets({
        setCount: 1,
        keepInComfyStems: ['a'],
        previewStemsBySet: previews
      })
    ).toBe(true)
  })

  it('is not complete when no checkpoints are included', () => {
    expect(
      isValidationCompleteForSets({
        setCount: 2,
        keepInComfyStems: [],
        previewStemsBySet: new Map()
      })
    ).toBe(false)
  })

  it('rejects zero sets', () => {
    expect(
      isValidationCompleteForSets({
        setCount: 0,
        keepInComfyStems: ['a'],
        previewStemsBySet: new Map()
      })
    ).toBe(false)
  })
})
