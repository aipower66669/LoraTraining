import { describe, expect, it } from 'vitest'
import {
  defaultStressTestSetConfig,
  stressTestSetFromPrevious
} from '../shared/stress-sets'

describe('stress set model defaults', () => {
  it('seeds a first set from lastStressModels-style overrides', () => {
    const models = ['a.safetensors', 'b_fp8.safetensors']
    const set = defaultStressTestSetConfig({ models, prompt: 'hello' })
    expect(set.models).toEqual(models)
    expect(set.prompt).toBe('hello')
  })

  it('clones previous models; caller can replace with global Apply list', () => {
    const prev = defaultStressTestSetConfig({
      models: ['old.safetensors'],
      seed: 3,
      prompt: 'p'
    })
    const cloned = stressTestSetFromPrevious(prev)
    expect(cloned.models).toEqual(['old.safetensors'])
    expect(cloned.seed).toBe(4)
    const global = ['good1.safetensors', 'good2.safetensors']
    const withGlobal = { ...cloned, models: [...global] }
    expect(withGlobal.models).toEqual(global)
    expect(withGlobal.prompt).toBe('p')
  })
})
