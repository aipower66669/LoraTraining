import { describe, expect, it } from 'vitest'
import {
  originalSiblingFileName,
  normalizeUpscaleBaseStem,
  upscaleOutputStem
} from '@shared/upscale-filename'

describe('normalizeUpscaleBaseStem', () => {
  it('leaves a plain stem untouched', () => {
    expect(normalizeUpscaleBaseStem('photo_001')).toBe('photo_001')
  })

  it('strips a trailing _upscaled suffix', () => {
    expect(normalizeUpscaleBaseStem('photo_001_upscaled')).toBe('photo_001')
  })

  it('only strips a trailing suffix, not one in the middle', () => {
    expect(normalizeUpscaleBaseStem('photo_upscaled_001')).toBe('photo_upscaled_001')
  })
})

describe('upscaleOutputStem', () => {
  it('appends _upscaled to a plain stem', () => {
    expect(upscaleOutputStem('photo_001')).toBe('photo_001_upscaled')
  })

  it('is idempotent — re-running on an already-upscaled stem does not pile up suffixes', () => {
    const once = upscaleOutputStem('photo_001')
    const twice = upscaleOutputStem(once)
    expect(once).toBe('photo_001_upscaled')
    expect(twice).toBe('photo_001_upscaled')
  })
})

describe('originalSiblingFileName', () => {
  it('appends .original to the filename (extension and all)', () => {
    expect(originalSiblingFileName('photo.jpg')).toBe('photo.jpg.original')
  })

  it('works for filenames without an extension', () => {
    expect(originalSiblingFileName('photo')).toBe('photo.original')
  })
})
