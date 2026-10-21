import { describe, expect, it } from 'vitest'
import { injectUpscaleInputs } from '@main/comfy/injectUpscaleInputs'
import type { WorkflowGraph } from '@main/comfy/workflowStore'
import type { UpscaleRunConfig } from '@shared/comfy'

function baseGraph(): WorkflowGraph {
  return {
    '1': { class_type: 'LoraTrainingInputImage', inputs: { image_path: '' } },
    '2': { class_type: 'LoraTrainingSeed', inputs: { value: 0 } },
    '3': { class_type: 'LoraTrainingPrompt', inputs: { text: '' } },
    '4': { class_type: 'LoraTrainingStyleIndex', inputs: { value: 0 } },
    '5': { class_type: 'LoraTrainingDenoise', inputs: { value: 0.5 } },
    '6': { class_type: 'LoraTrainingMaxSize', inputs: { value: 1600 } },
    '7': { class_type: 'LoraTrainingOutputFolder', inputs: { folder: '' } },
    '8': { class_type: 'LoraTrainingOutputFilename', inputs: { filename: '' } }
  }
}

function baseConfig(overrides?: Partial<UpscaleRunConfig>): UpscaleRunConfig {
  return {
    datasetId: 'd1',
    fileName: 'cat.png',
    sourceImagePath: 'F:/photos/cat.png',
    prompt: 'a photo of a cat',
    seed: 42,
    model: '',
    denoise: 0.65,
    styleIndex: 0,
    maxSize: 2048,
    ...overrides
  }
}

describe('injectUpscaleInputs', () => {
  it('injects source path, prompt, seed, denoise, max size, style, output folder/filename', () => {
    const graph = baseGraph()
    const config = baseConfig()
    const next = injectUpscaleInputs(graph, config, 42, 'F:/photos/output', 'cat')

    expect(next['1']!.inputs.image_path).toBe('F:/photos/cat.png')
    expect(next['2']!.inputs.value).toBe(42)
    expect(next['3']!.inputs.text).toBe('a photo of a cat')
    expect(next['4']!.inputs.value).toBe(0)
    expect(next['5']!.inputs.value).toBe(0.65)
    expect(next['6']!.inputs.value).toBe(2048)
    expect(next['7']!.inputs.folder).toBe('F:/photos/output')
    expect(next['8']!.inputs.filename).toBe('cat_upscaled')
    // Original graph left untouched (pure function).
    expect(graph['1']!.inputs.image_path).toBe('')
  })

  it('normalizes an already-upscaled source stem instead of stacking suffixes', () => {
    const graph = baseGraph()
    const next = injectUpscaleInputs(
      graph,
      baseConfig(),
      42,
      'F:/photos/output',
      'cat_upscaled'
    )
    expect(next['8']!.inputs.filename).toBe('cat_upscaled')
  })

  it('injects the model when set', () => {
    const graph = baseGraph()
    graph['9'] = { class_type: 'LoraTrainingModel', inputs: {} }
    const next = injectUpscaleInputs(
      graph,
      baseConfig({ model: 'sdxl_base.safetensors' }),
      42,
      'F:/photos/output',
      'cat'
    )
    expect(next['9']!.inputs.model_name).toBe('sdxl_base.safetensors')
  })

  it('skips model injection when resolved model is empty (Default with no settings fallback)', () => {
    const graph = baseGraph()
    graph['9'] = { class_type: 'LoraTrainingModel', inputs: { model_name: 'baked.safetensors' } }
    const next = injectUpscaleInputs(
      graph,
      baseConfig({ model: '' }),
      42,
      'F:/photos/output',
      'cat'
    )
    expect(next['9']!.inputs.model_name).toBe('baked.safetensors')
  })

  it('rejects LT · Model wired into a sampler model socket', () => {
    const graph = baseGraph()
    graph['9'] = { class_type: 'LoraTrainingModel', inputs: { model_name: 'a.safetensors' } }
    graph['10'] = {
      class_type: 'KSampler',
      inputs: { model: ['9', 0], seed: 1, steps: 20 }
    }
    expect(() =>
      injectUpscaleInputs(
        graph,
        baseConfig({ model: 'a.safetensors' }),
        42,
        'F:/photos/output',
        'cat'
      )
    ).toThrow(/wired into KSampler.*“model”/)
  })

  it('throws a clear error when a required LT node is missing', () => {
    const graph = baseGraph()
    delete graph['1']
    expect(() =>
      injectUpscaleInputs(graph, baseConfig(), 42, 'F:/photos/output', 'cat')
    ).toThrow(/LT · Input Image/)
  })
})
