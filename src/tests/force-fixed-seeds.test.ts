import { describe, expect, it } from 'vitest'
import {
  forceDynamicPromptsStable,
  forceFixedSeeds,
  injectLtSeed,
  injectValidationInputs,
  patchUiWorkflowSeed,
  readInjectedLtSeed
} from '@main/comfy/injectValidationInputs'
import type { WorkflowGraph } from '@main/comfy/workflowStore'

describe('forceFixedSeeds', () => {
  it('sets numeric seed widgets and disables randomize', () => {
    const graph: WorkflowGraph = {
      '1': {
        class_type: 'KSampler',
        inputs: {
          seed: 99,
          control_after_generate: 'randomize',
          steps: 20
        }
      },
      '2': {
        class_type: 'LoraTrainingSeed',
        inputs: { value: 1 }
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: ['2', 0],
          control_after_generate: 'randomize'
        }
      }
    }
    forceFixedSeeds(graph, 12345)
    expect(graph['1']!.inputs.seed).toBe(12345)
    expect(graph['1']!.inputs.control_after_generate).toBe('fixed')
    expect(graph['2']!.inputs.value).toBe(12345)
    expect(graph['3']!.inputs.seed).toEqual(['2', 0])
    expect(graph['3']!.inputs.control_after_generate).toBe('fixed')
  })
})

describe('injectLtSeed', () => {
  it('writes value and strips legacy seed widget fields', () => {
    const graph: WorkflowGraph = {
      '9': {
        class_type: 'LoraTrainingSeed',
        inputs: { seed: 0, control_after_generate: 'randomize' }
      }
    }
    injectLtSeed(graph, 42)
    expect(graph['9']!.inputs.value).toBe(42)
    expect(graph['9']!.inputs.seed).toBeUndefined()
    expect(graph['9']!.inputs.control_after_generate).toBeUndefined()
    expect(readInjectedLtSeed(graph)).toBe(42)
  })

  it('patches uiWorkflow widgets_values', () => {
    const ui = {
      nodes: [
        { type: 'LoraTrainingSeed', widgets_values: [0, 'randomize'] },
        { type: 'KSampler', widgets_values: [1, 'fixed', 20] },
        { type: 'DPRandomGenerator', widgets_values: ['{a|b}', 1, 'Yes', false] }
      ]
    }
    const patched = patchUiWorkflowSeed(ui, 99) as typeof ui
    expect(patched.nodes[0]!.widgets_values).toEqual([99, 'fixed'])
    expect(patched.nodes[1]!.widgets_values).toEqual([1, 'fixed', 20])
    expect(patched.nodes[2]!.widgets_values).toEqual(['{a|b}', 1, 'No', false])
  })
})

describe('forceDynamicPromptsStable', () => {
  it('forces autorefresh No on Dynamic Prompts nodes', () => {
    const graph: WorkflowGraph = {
      '1': {
        class_type: 'DPRandomGenerator',
        inputs: { text: '{a|b}', seed: ['2', 0], autorefresh: 'Yes', trim_result: false }
      },
      '2': {
        class_type: 'KSampler',
        inputs: { seed: 1 }
      }
    }
    forceDynamicPromptsStable(graph)
    expect(graph['1']!.inputs.autorefresh).toBe('No')
  })
})

describe('injectValidationInputs', () => {
  it('stages lora_source on LT · Prompt', () => {
    const graph: WorkflowGraph = {
      '1': { class_type: 'LoraTrainingPrompt', inputs: { text: '' } },
      '2': { class_type: 'LoraTrainingSeed', inputs: { value: 0 } },
      '3': { class_type: 'LoraTrainingOutputFilename', inputs: { filename: '' } },
      '4': {
        class_type: 'DPRandomGenerator',
        inputs: { text: ['1', 0], seed: ['2', 0], autorefresh: 'Yes' }
      }
    }
    const next = injectValidationInputs(
      graph,
      'F:/sets/ds',
      {
        datasetId: 'd1',
        setIndex: 0,
        prompt: 'a {cat|dog}',
        seed: 42,
        loraWeight: 1,
        existingCopyPolicy: 'overwrite_if_different',
        styleIndex: 0,
        validationModel: 'Default'
      },
      42,
      {
        fileName: 'job_000000250.safetensors',
        relativePath: 'job_000000250.safetensors',
        fullPath: 'F:/sets/ds/output/job_000000250.safetensors',
        stem: 'job_000000250',
        triggerKeyword: 'ohwx'
      },
      {
        lorasFolder: 'F:/ComfyUI/models/loras',
        validationLoraSubfolder: '!Testing'
      }
    )
    expect(next['1']!.inputs.text).toContain('<lora:job_000000250:1>')
    expect(next['1']!.inputs.lora_source).toBe('F:/sets/ds/output/job_000000250.safetensors')
    expect(next['1']!.inputs.existing_copy_policy).toBe('overwrite_if_different')
    expect(next['1']!.inputs.comfy_lora_root).toBe('F:/ComfyUI/models/loras')
    expect(next['1']!.inputs.comfy_lora_subfolder).toBe('!Testing')
    expect(next['4']!.inputs.autorefresh).toBe('No')
  })
})
