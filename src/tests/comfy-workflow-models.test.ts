import { describe, expect, it } from 'vitest'
import {
  dedupeFixedWorkflowModels,
  extractFixedWorkflowModels
} from '@shared/comfy-workflow-models'
import type { WorkflowGraph } from '@shared/workflow-profile'

describe('comfy-workflow-models', () => {
  it('skips LT inject nodes and node references', () => {
    const graph: WorkflowGraph = {
      '1': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      '2': { class_type: 'UNETLoader', inputs: { unet_name: ['9', 0] } },
      '9': { class_type: 'LoraTrainingModel', inputs: { model_name: 'dynamic.safetensors' } },
      '3': { class_type: 'LoraTrainingPrompt', inputs: { text: 'hello' } }
    }
    expect(extractFixedWorkflowModels(graph)).toEqual([
      {
        nodeId: '1',
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'qwen_image_vae.safetensors'
      }
    ])
  })

  it('dedupes identical filename/class/key tuples', () => {
    const refs = dedupeFixedWorkflowModels([
      { nodeId: '1', classType: 'VAELoader', inputKey: 'vae_name', filename: 'a.safetensors' },
      { nodeId: '2', classType: 'VAELoader', inputKey: 'vae_name', filename: 'a.safetensors' }
    ])
    expect(refs).toHaveLength(1)
  })
})
