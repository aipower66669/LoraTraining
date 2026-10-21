import { describe, expect, it } from 'vitest'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'

describe('formatComfyProgressLine', () => {
  it('joins node, steps, and detail like the Comfy console', () => {
    expect(
      formatComfyProgressLine({
        nodeTitle: 'KSampler',
        step: 0,
        max: 12,
        detail: 'Model Initializing ...'
      })
    ).toBe('KSampler · 0/12 · Model Initializing ...')
  })

  it('omits missing parts', () => {
    expect(formatComfyProgressLine({ detail: 'Loading' })).toBe('Loading')
    expect(formatComfyProgressLine({})).toBe('')
  })
})

describe('comfyStepPercent', () => {
  it('maps step/max to a clamped percent', () => {
    expect(comfyStepPercent(3, 12)).toBe(25)
    expect(comfyStepPercent(0, 12)).toBe(0)
    expect(comfyStepPercent(null, 12)).toBeNull()
  })
})
