import { describe, expect, it } from 'vitest'
import {
  buildValidationSetPreviews,
  nextPreviewIndexAfterListChange,
  previewIndexForPreferredStep,
  previewIndexForSetChange
} from '@shared/validation-set-previews'
import type { CheckpointEntry } from '@shared/ipc/contract'

function cp(
  fileName: string,
  images: Array<{ setLabel: string; relativePath: string }>
): CheckpointEntry {
  return {
    fileName,
    relativePath: fileName,
    sizeBytes: 1,
    mtimeMs: 1,
    validationImageRelativePath: images[0]?.relativePath ?? null,
    validationImages: images,
    averageRating: null,
    ratingCount: 0,
    keepInComfy: true,
    comfyRelativeDir: null
  }
}

describe('validation set previews', () => {
  it('builds ordered previews and appends live progress when new', () => {
    const list = buildValidationSetPreviews({
      checkpoints: [
        cp('a_000000100.safetensors', [
          { setLabel: 'Set 1', relativePath: 'output/Set 1/a_000000100.jpg' }
        ]),
        cp('a_000000200.safetensors', [
          { setLabel: 'Set 1', relativePath: 'output/Set 1/a_000000200.jpg' }
        ]),
        cp('a_000000300.safetensors', [
          { setLabel: 'Set 2', relativePath: 'output/Set 2/a_000000300.jpg' }
        ])
      ],
      setLabel: 'Set 1',
      datasetId: 'd1',
      setIndex: 0,
      progress: {
        status: 'running',
        datasetId: 'd1',
        setIndex: 0,
        setLabel: 'Set 1',
        jobsCompleted: 3,
        lastPreviewRelativePath: 'output/Set 1/a_000000300.jpg',
        lastPreviewFileName: 'a_000000300.safetensors'
      }
    })
    expect(list.map((p) => p.relativePath)).toEqual([
      'output/Set 1/a_000000100.jpg',
      'output/Set 1/a_000000200.jpg',
      'output/Set 1/a_000000300.jpg'
    ])
  })

  it('does not resurrect lastPreview after the run finishes', () => {
    const list = buildValidationSetPreviews({
      checkpoints: [
        cp('a_000000100.safetensors', [
          { setLabel: 'Set 1', relativePath: 'output/Set 1/a_000000100.jpg' }
        ])
      ],
      setLabel: 'Set 1',
      datasetId: 'd1',
      setIndex: 0,
      progress: {
        status: 'done',
        datasetId: 'd1',
        setIndex: 0,
        setLabel: 'Set 1',
        jobsCompleted: 2,
        lastPreviewRelativePath: 'output/Set 1/a_000000200.jpg',
        lastPreviewFileName: 'a_000000200.safetensors'
      }
    })
    expect(list.map((p) => p.relativePath)).toEqual(['output/Set 1/a_000000100.jpg'])
  })

  it('follows last only when already on last', () => {
    expect(
      nextPreviewIndexAfterListChange({ prevLength: 2, prevIndex: 1, nextLength: 3 })
    ).toBe(2)
    expect(
      nextPreviewIndexAfterListChange({ prevLength: 2, prevIndex: 0, nextLength: 3 })
    ).toBe(0)
    expect(
      nextPreviewIndexAfterListChange({ prevLength: 0, prevIndex: 0, nextLength: 1 })
    ).toBe(0)
  })

  it('clamps preferred index across sets', () => {
    expect(previewIndexForSetChange(5, 3)).toBe(2)
    expect(previewIndexForSetChange(1, 5)).toBe(1)
    expect(previewIndexForSetChange(0, 0)).toBe(0)
  })

  it('matches preferred step across sets, nearest when missing', () => {
    const set2 = [{ step: 100 }, { step: 200 }, { step: 500 }]
    // |300-200|=100 beats |300-500|=200
    expect(previewIndexForPreferredStep(300, set2)).toBe(1)
    expect(previewIndexForPreferredStep(500, set2)).toBe(2)
    expect(previewIndexForPreferredStep(100, set2)).toBe(0)
    expect(previewIndexForPreferredStep(Number.POSITIVE_INFINITY, set2)).toBe(2)
    // Tie distance prefers the lower step
    expect(previewIndexForPreferredStep(250, [{ step: 200 }, { step: 300 }])).toBe(0)
    expect(previewIndexForPreferredStep(300, [{ step: 100 }, { step: 200 }, { step: 300 }])).toBe(2)
  })
})
