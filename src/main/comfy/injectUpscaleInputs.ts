import type { UpscaleRunConfig } from '@shared/comfy'
import { upscaleOutputStem } from '@shared/upscale-filename'
import type { WorkflowGraph } from './workflowStore'
import {
  assertLtModelWiredAsFilename,
  injectLtModel,
  injectLtSeed
} from './injectValidationInputs'

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph)
}

function findNodesByClass(
  graph: WorkflowGraph,
  classType: string
): Array<[string, WorkflowGraph[string]]> {
  return Object.entries(graph).filter(([, n]) => n.class_type === classType)
}

function setInput(graph: WorkflowGraph, classType: string, key: string, value: unknown): boolean {
  const found = findNodesByClass(graph, classType)
  if (found.length === 0) return false
  for (const [, node] of found) {
    node.inputs[key] = value
  }
  return true
}

/**
 * Inject LT contract nodes for a single Upscale/Detail run. Unlike
 * `injectValidationInputs`, there's no LoRA staging or per-set output folder —
 * just a source image path, prompt, seed/model/denoise/style/max-size, and a
 * resolved output folder + filename stem.
 */
export function injectUpscaleInputs(
  graph: WorkflowGraph,
  config: UpscaleRunConfig,
  seed: number,
  outputFolder: string,
  sourceStem: string
): WorkflowGraph {
  const next = cloneGraph(graph)
  assertLtModelWiredAsFilename(next)

  if (!setInput(next, 'LoraTrainingInputImage', 'image_path', config.sourceImagePath)) {
    throw new Error('Workflow must include an “LT · Input Image” node (comfyui-lora-training).')
  }

  injectLtSeed(next, seed)

  if (!setInput(next, 'LoraTrainingPrompt', 'text', config.prompt)) {
    throw new Error('Workflow must include an “LT · Prompt” node (comfyui-lora-training).')
  }

  const styleIndex = config.styleIndex === 1 ? 1 : 0
  setInput(next, 'LoraTrainingStyleIndex', 'value', styleIndex)

  if (!setInput(next, 'LoraTrainingDenoise', 'value', config.denoise)) {
    throw new Error('Workflow must include an “LT · Denoise” node (comfyui-lora-training).')
  }

  if (!setInput(next, 'LoraTrainingMaxSize', 'value', config.maxSize)) {
    throw new Error('Workflow must include an “LT · Max Size” node (comfyui-lora-training).')
  }

  const model = config.model.trim()
  if (model) {
    if (!injectLtModel(next, model)) {
      throw new Error(
        'Workflow must include an “LT · Model” node (comfyui-lora-training) when a model is set. Convert the checkpoint/UNet loader’s model name widget to an input and wire LT · Model into it.'
      )
    }
  }

  setInput(next, 'LoraTrainingOutputFolder', 'folder', outputFolder)
  if (!setInput(next, 'LoraTrainingOutputFilename', 'filename', upscaleOutputStem(sourceStem))) {
    throw new Error(
      'Workflow must include an “LT · Output Filename” node (comfyui-lora-training).'
    )
  }

  return next
}
