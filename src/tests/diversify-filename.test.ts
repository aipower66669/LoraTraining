import { describe, expect, it } from 'vitest'
import {
  diversifyRootStem,
  diversifySiblingStem,
  isDiversifySiblingStem,
  nextDiversifyFileName
} from '@shared/diversify-filename'

describe('diversify-filename', () => {
  it('strips trailing _dNN from root stem', () => {
    expect(diversifyRootStem('photo')).toBe('photo')
    expect(diversifyRootStem('photo_d01')).toBe('photo')
    expect(diversifyRootStem('photo_d12')).toBe('photo')
  })

  it('detects sibling stems', () => {
    expect(isDiversifySiblingStem('photo')).toBe(false)
    expect(isDiversifySiblingStem('photo_d01')).toBe(true)
  })

  it('builds zero-padded sibling stems', () => {
    expect(diversifySiblingStem('photo', 1)).toBe('photo_d01')
    expect(diversifySiblingStem('photo_d03', 4)).toBe('photo_d04')
  })

  it('allocates next free basename after existing siblings', () => {
    expect(nextDiversifyFileName('photo.jpg', ['photo.jpg', 'other.png'])).toBe('photo_d01.jpg')
    expect(
      nextDiversifyFileName('photo.jpg', ['photo.jpg', 'photo_d01.jpg', 'photo_d02.jpg'])
    ).toBe('photo_d03.jpg')
    expect(nextDiversifyFileName('photo_d01.jpg', ['photo.jpg', 'photo_d01.jpg'])).toBe(
      'photo_d02.jpg'
    )
  })
})
