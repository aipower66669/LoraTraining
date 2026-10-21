import type { DiversifyRunConfig } from '@shared/comfy'
import type { DiversifyMode } from '@shared/diversify-config'
import { imageStem } from '@shared/schemas/dataset'
import type { WorkflowGraph } from './workflowStore'
import { injectLtSeed } from './injectValidationInputs'

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
 * Inject LT contract nodes for a Diversify run.
 *
 * Context: Input Image, Prompt, Seed, Output Folder, Output Filename.
 * Expression: Input Image, Seed (always random from the app), Output Folder,
 * Output Filename — no Prompt; count is handled by queuing multiple times.
 * No LT · Model — UNet / edit models stay hardcoded in the workflow.
 */
export function injectDiversifyInputs(
  graph: WorkflowGraph,
  config: DiversifyRunConfig,
  seed: number,
  outputFolder: string
): WorkflowGraph {
  const next = cloneGraph(graph)
  const mode: DiversifyMode = config.mode

  if (!setInput(next, 'LoraTrainingInputImage', 'image_path', config.sourceImagePath)) {
    throw new Error('Workflow must include an “LT · Input Image” node (comfyui-lora-training).')
  }

  injectLtSeed(next, seed)

  if (mode === 'context') {
    if (!setInput(next, 'LoraTrainingPrompt', 'text', config.prompt)) {
      throw new Error('Workflow must include an “LT · Prompt” node (comfyui-lora-training).')
    }

    // Optional style index if the graph has one (shared anime/real workflows).
    setInput(next, 'LoraTrainingStyleIndex', 'value', 0)
  }

  setInput(next, 'LoraTrainingOutputFolder', 'folder', outputFolder)
  const outStem = imageStem(config.outputFileName)
  if (!setInput(next, 'LoraTrainingOutputFilename', 'filename', outStem)) {
    throw new Error(
      'Workflow must include an “LT · Output Filename” node (comfyui-lora-training).'
    )
  }

  return next
}
