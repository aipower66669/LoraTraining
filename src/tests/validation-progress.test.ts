import { describe, expect, it } from 'vitest'
import type { CheckpointEntry } from '@shared/ipc/contract'
import {
  countSetPreviewProgress,
  formatSetPreviewProgress
} from '@shared/validation-progress'

function cp(
  fileName: string,
  sets: string[]
): CheckpointEntry {
  return {
    fileName,
    relativePath: fileName,
    sizeBytes: 1,
    mtimeMs: 0,
    validationImageRelativePath: sets[0] ? `output/${sets[0]}/${fileName}.jpg` : null,
    validationImages: sets.map((setLabel) => ({
      setLabel,
      relativePath: `output/${setLabel}/${fileName.replace(/\.safetensors$/i, '')}.jpg`
    })),
    averageRating: null,
    ratingCount: 0,
    keepInComfy: true,
    comfyRelativeDir: null
  }
}

describe('validation progress', () => {
  it('counts previews per set', () => {
    const list = [
      cp('a.safetensors', ['Set 1', 'Set 2']),
      cp('b.safetensors', ['Set 1']),
      cp('c.safetensors', [])
    ]
    expect(countSetPreviewProgress(list, 'Set 1')).toEqual({
      setLabel: 'Set 1',
      done: 2,
      total: 3,
      percent: 67
    })
    expect(countSetPreviewProgress(list, 'Set 2')).toEqual({
      setLabel: 'Set 2',
      done: 1,
      total: 3,
      percent: 33
    })
  })

  it('formats progress', () => {
    expect(formatSetPreviewProgress({ setLabel: 'Set 1', done: 0, total: 0, percent: 0 })).toBe(
      'No checkpoints'
    )
    expect(formatSetPreviewProgress({ setLabel: 'Set 1', done: 2, total: 4, percent: 50 })).toBe(
      '2 / 4 · 50%'
    )
  })
})
