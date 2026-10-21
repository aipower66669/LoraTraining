import { describe, expect, it } from 'vitest'
import {
  defaultWeightSetConfig,
  enumerateWeightSteps,
  formatWeightPreviewStem,
  formatWeightToken,
  isWeightSetDirName,
  sanitizeCheckpointStem,
  weightSetFromPrevious,
  weightSetLabel,
  weightsMissingPreviews
} from '@shared/weight-sets'
import { isPreviewOutputDirName } from '@shared/validation-sets'

describe('weight-sets', () => {
  it('labels Weight N folders', () => {
    expect(weightSetLabel(0)).toBe('Weight 1')
    expect(isWeightSetDirName('Weight 1')).toBe(true)
    expect(isWeightSetDirName('Set 1')).toBe(false)
    expect(isPreviewOutputDirName('Weight 2')).toBe(true)
    expect(isPreviewOutputDirName('Set 3')).toBe(true)
  })

  it('formats weight tokens with at least one decimal place', () => {
    expect(formatWeightToken(0.6)).toBe('0.6')
    expect(formatWeightToken(1)).toBe('1.0')
    expect(formatWeightToken(0)).toBe('0.0')
    expect(formatWeightToken(1.2)).toBe('1.2')
    expect(formatWeightToken(0.6 + 0.2 + 0.2)).toBe('1.0')
  })

  it('builds checkpoint_weight preview stems', () => {
    expect(sanitizeCheckpointStem('MyLora_000500.safetensors')).toBe('MyLora_000500')
    expect(formatWeightPreviewStem('MyLora_000500.safetensors', 0.6)).toBe(
      'MyLora_000500_0.6'
    )
    expect(formatWeightPreviewStem('path/foo.safetensors', 1)).toBe('foo_1.0')
    expect(formatWeightPreviewStem('path/foo.safetensors', 1.2)).toBe('foo_1.2')
  })

  it('enumerates inclusive steps on an integer grid', () => {
    const r = enumerateWeightSteps(0.6, 1.4, 0.2)
    expect(r).toEqual({
      ok: true,
      weights: [0.6, 0.8, 1, 1.2, 1.4]
    })
  })

  it('rejects invalid ranges', () => {
    expect(enumerateWeightSteps(1, 0.5, 0.1).ok).toBe(false)
    expect(enumerateWeightSteps(0.6, 1.4, 0).ok).toBe(false)
    expect(enumerateWeightSteps(0.6, 1.4, -0.2).ok).toBe(false)
  })

  it('selects weights missing previews by full stem', () => {
    const enumerated = enumerateWeightSteps(0.6, 1.0, 0.2)
    expect(enumerated.ok).toBe(true)
    if (!enumerated.ok) return
    const cp = 'lora.safetensors'
    const existing = new Set(['lora_0.6', 'lora_1.0'])
    expect(weightsMissingPreviews(cp, enumerated.weights, existing)).toEqual([0.8])
  })

  it('clones previous set range and bumps seed', () => {
    const prev = defaultWeightSetConfig({
      seed: 5,
      checkpointFileName: 'lora_100.safetensors',
      weightMin: 0.5,
      weightMax: 1.5,
      weightStep: 0.25
    })
    const next = weightSetFromPrevious(prev)
    expect(next.seed).toBe(6)
    expect(next.checkpointFileName).toBe('lora_100.safetensors')
    expect(next.weightMin).toBe(0.5)
    expect(next.weightMax).toBe(1.5)
    expect(next.weightStep).toBe(0.25)
  })
})
