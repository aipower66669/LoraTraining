import { describe, expect, it } from 'vitest'
import {
  defaultStressTestSetConfig,
  isMissingComfyModelError,
  isStressTestSetDirName,
  modelPreviewStemMap,
  modelsMissingPreviews,
  pruneModelsToAvailable,
  sanitizeModelPreviewStem,
  stressTestSetFromPrevious,
  stressTestSetLabel
} from '@shared/stress-sets'
import { isPreviewOutputDirName } from '@shared/validation-sets'

describe('stress-sets', () => {
  it('labels Stress N folders', () => {
    expect(stressTestSetLabel(0)).toBe('Stress 1')
    expect(isStressTestSetDirName('Stress 1')).toBe(true)
    expect(isStressTestSetDirName('Set 1')).toBe(false)
    expect(isPreviewOutputDirName('Stress 2')).toBe(true)
    expect(isPreviewOutputDirName('Set 3')).toBe(true)
  })

  it('sanitizes model names for preview stems', () => {
    expect(sanitizeModelPreviewStem('flux/foo.safetensors')).toBe('foo')
    expect(sanitizeModelPreviewStem('bar.ckpt')).toBe('bar')
  })

  it('disambiguates colliding sanitized stems with a full-path hash', () => {
    const map = modelPreviewStemMap(['a/foo.safetensors', 'b/foo.safetensors'])
    const a = map.get('a/foo.safetensors')
    const b = map.get('b/foo.safetensors')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
    expect(a?.startsWith('foo_')).toBe(true)
    expect(b?.startsWith('foo_')).toBe(true)
  })

  it('never assigns the same preview stem to two models', () => {
    const models = [
      'foo.safetensors',
      'dir/foo.safetensors',
      'foo_aaaaaa.safetensors',
      'other/foo_aaaaaa.safetensors'
    ]
    const map = modelPreviewStemMap(models)
    const stems = models.map((m) => map.get(m)!)
    expect(new Set(stems).size).toBe(models.length)
  })

  it('selects models missing previews', () => {
    const models = ['x/a.safetensors', 'y/a.safetensors', 'z/b.safetensors']
    const stems = modelPreviewStemMap(models)
    const existing = new Set([(stems.get('x/a.safetensors') ?? '').toLowerCase()])
    expect(modelsMissingPreviews(models, existing)).toEqual([
      'y/a.safetensors',
      'z/b.safetensors'
    ])
  })

  it('treats legacy basename-only previews as already done', () => {
    const models = ['dir/Foo.safetensors', 'other/Bar.safetensors']
    const existing = new Set(['foo', 'bar'])
    expect(modelsMissingPreviews(models, existing)).toEqual([])
  })

  it('still queues models whose legacy basename is absent', () => {
    const models = [
      'myKrea2RestoredDiffusion_int8ConvrotVersion.safetensors',
      'parities_souparity.safetensors'
    ]
    const legacy = sanitizeModelPreviewStem(models[0]!)
    const existing = new Set([legacy.toLowerCase()])
    expect(modelsMissingPreviews(models, existing)).toEqual(['parities_souparity.safetensors'])
  })

  it('prunes models missing from the Comfy list', () => {
    const { kept, removed } = pruneModelsToAvailable(
      ['keep.safetensors', 'parities_souparity.safetensors', 'KEEP.safetensors'],
      ['keep.safetensors', 'other.safetensors']
    )
    expect(kept).toEqual(['keep.safetensors'])
    expect(removed).toEqual(['parities_souparity.safetensors'])
  })

  it('detects Comfy missing-model errors', () => {
    expect(
      isMissingComfyModelError(
        "Model in folder 'diffusion_models' with filename 'parities_souparity.safetensors' not found."
      )
    ).toBe(true)
    expect(isMissingComfyModelError('CUDA out of memory')).toBe(false)
  })

  it('clones previous set models and bumps seed', () => {
    const prev = defaultStressTestSetConfig({
      seed: 5,
      models: ['a.safetensors', 'b.safetensors'],
      checkpointFileName: 'lora_100.safetensors'
    })
    const next = stressTestSetFromPrevious(prev)
    expect(next.seed).toBe(6)
    expect(next.models).toEqual(['a.safetensors', 'b.safetensors'])
    expect(next.checkpointFileName).toBe('lora_100.safetensors')
  })
})
