import { describe, expect, it } from 'vitest'
import { shouldCopyPathOnDatasetDuplicate } from '../shared/dataset-duplicate-copy'

describe('shouldCopyPathOnDatasetDuplicate', () => {
  it('copies ordinary images and captions', () => {
    expect(shouldCopyPathOnDatasetDuplicate('photo.jpg')).toBe(true)
    expect(shouldCopyPathOnDatasetDuplicate('photo.txt')).toBe(true)
    expect(shouldCopyPathOnDatasetDuplicate('sub/nested.png')).toBe(true)
  })

  it('skips output tree and dataset.json sidecars', () => {
    expect(shouldCopyPathOnDatasetDuplicate('output')).toBe(false)
    expect(shouldCopyPathOnDatasetDuplicate('output/foo.safetensors')).toBe(false)
    expect(shouldCopyPathOnDatasetDuplicate('dataset.json')).toBe(false)
    expect(shouldCopyPathOnDatasetDuplicate('Dataset.JSON')).toBe(false)
    expect(shouldCopyPathOnDatasetDuplicate('nested\\dataset.json')).toBe(false)
  })
})
