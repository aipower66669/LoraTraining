import type { ExistingCopyPolicy, ValidationRunConfig } from '@shared/comfy'
import { composeValidationPrompt } from '@shared/validation-prompt'
import type { WorkflowGraph } from './workflowStore'
import type { NextValidationLora } from './nextValidationLora'
import { validationSetOutputFolder } from './validationSets'

/** Dynamic Prompts nodes that keep an in-memory iterator across API jobs. */
const DYNAMIC_PROMPTS_CLASSES = new Set([
  'DPRandomGenerator',
  'DPCombinatorialGenerator',
  'DPFeelingLucky',
  'DPJinja',
  'DPMagicPrompt'
])

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph)
}

function findNodesByClass(
  graph: WorkflowGraph,
  classType: string
): Array<[string, WorkflowGraph[string]]> {
  return Object.entries(graph).filter(([, n]) => n.class_type === classType)
}

function setInput(
  graph: WorkflowGraph,
  classType: string,
  key: string,
  value: unknown
): boolean {
  const found = findNodesByClass(graph, classType)
  if (found.length === 0) return false
  for (const [, node] of found) {
    node.inputs[key] = value
  }
  return true
}

/**
 * Force every plain seed widget to this value and disable randomize-after-generate.
 * Link arrays (connections) are left alone.
 */
export function forceFixedSeeds(graph: WorkflowGraph, seed: number): void {
  for (const node of Object.values(graph)) {
    const inputs = node.inputs
    if (!inputs) continue
    if (typeof inputs.seed === 'number') inputs.seed = seed
    if (typeof inputs.noise_seed === 'number') inputs.noise_seed = seed
    if (typeof inputs.value === 'number' && node.class_type === 'LoraTrainingSeed') {
      inputs.value = seed
    }
    if (typeof inputs.control_after_generate === 'string') {
      inputs.control_after_generate = 'fixed'
    }
    if (typeof inputs.control_before_generate === 'string') {
      inputs.control_before_generate = 'fixed'
    }
  }
}

/**
 * Dynamic Prompts (comfyui-dynamicprompts) keeps a prompt iterator on the node
 * instance across queue calls. With autorefresh=Yes it also rebuilds wildcard
 * state in an order that can discard the seeded RNG. Force No so a fixed seed
 * yields the same expansion when the template's wildcard portion is stable.
 */
export function forceDynamicPromptsStable(graph: WorkflowGraph): void {
  for (const node of Object.values(graph)) {
    if (!DYNAMIC_PROMPTS_CLASSES.has(node.class_type)) continue
    if (typeof node.inputs.autorefresh === 'string') {
      node.inputs.autorefresh = 'No'
    }
  }
}

/** Set LT · Model filename (supports `model_name` and legacy `ckpt_name`). */
export function injectLtModel(graph: WorkflowGraph, model: string): boolean {
  const found = findNodesByClass(graph, 'LoraTrainingModel')
  if (found.length === 0) return false
  for (const [, node] of found) {
    const inputs = node.inputs ?? (node.inputs = {})
    if ('model_name' in inputs || !('ckpt_name' in inputs)) {
      inputs.model_name = model
    } else {
      inputs.ckpt_name = model
    }
  }
  return true
}

/**
 * LT · Model outputs a filename string (wildcard type). If it's wired into a
 * sampler/conditioner `model` socket, Comfy runs and fails with
 * `'str' object has no attribute 'model'`. Catch that before queueing.
 */
export function assertLtModelWiredAsFilename(graph: WorkflowGraph): void {
  const ltModelIds = new Set(
    findNodesByClass(graph, 'LoraTrainingModel').map(([id]) => id)
  )
  if (ltModelIds.size === 0) return

  for (const [nodeId, node] of Object.entries(graph)) {
    const inputs = node.inputs
    if (!inputs) continue
    for (const [key, val] of Object.entries(inputs)) {
      // Filename sockets on loaders — these are correct.
      if (key === 'unet_name' || key === 'ckpt_name' || key === 'model_name') continue
      if (!Array.isArray(val) || val.length < 1) continue
      const srcId = String(val[0])
      if (!ltModelIds.has(srcId)) continue
      if (key === 'model') {
        throw new Error(
          `LT · Model is wired into ${node.class_type} (node ${nodeId}) “model” input. ` +
            `That socket needs a loaded MODEL from Load Diffusion Model / CheckpointLoader, not a filename. ` +
            `On the loader, convert unet_name (or ckpt_name) to an input and wire LT · Model there instead.`
        )
      }
      throw new Error(
        `LT · Model is wired into ${node.class_type} (node ${nodeId}) “${key}” — ` +
          `wire it only into Load Diffusion Model’s unet_name or CheckpointLoader’s ckpt_name.`
      )
    }
  }
}

/** Set LT · Seed in the API graph (supports legacy `seed` and current `value` input). */
export function injectLtSeed(graph: WorkflowGraph, seed: number): void {
  const nodes = findNodesByClass(graph, 'LoraTrainingSeed')
  if (nodes.length === 0) {
    throw new Error('Workflow must include an “LT · Seed” node (comfyui-lora-training).')
  }
  for (const [, node] of nodes) {
    node.inputs.value = seed
    // Drop legacy seed-widget fields so Comfy doesn't pass unknown kwargs / randomize.
    delete node.inputs.seed
    delete node.inputs.control_after_generate
    delete node.inputs.control_before_generate
  }
  forceFixedSeeds(graph, seed)
  forceDynamicPromptsStable(graph)
}

/**
 * Patch litegraph uiWorkflow so extra_pnginfo metadata matches the API seed.
 * Seed widgets typically store [seedNumber, "fixed"|"randomize"|...].
 */
export function patchUiWorkflowSeed(uiWorkflow: unknown, seed: number): unknown {
  if (!uiWorkflow || typeof uiWorkflow !== 'object') return uiWorkflow
  const doc = structuredClone(uiWorkflow) as {
    nodes?: Array<{
      type?: string
      widgets_values?: unknown[]
      title?: string
      properties?: Record<string, unknown>
    }>
  }
  if (!Array.isArray(doc.nodes)) return doc

  for (const node of doc.nodes) {
    const type = node.type ?? ''
    const title = node.title ?? ''
    const isLtSeed =
      type === 'LoraTrainingSeed' ||
      title === 'LT · Seed' ||
      title.endsWith('LT · Seed')
    const isDp = DYNAMIC_PROMPTS_CLASSES.has(type)
    const wv = node.widgets_values
    if (isDp && Array.isArray(wv)) {
      // Random Prompts widgets: text, seed, control?, autorefresh, trim_result
      const arIdx = wv.findIndex(
        (v) => typeof v === 'string' && (v === 'Yes' || v === 'No')
      )
      if (arIdx >= 0) wv[arIdx] = 'No'
    }
    if (!isLtSeed) continue
    if (!Array.isArray(wv) || wv.length === 0) {
      node.widgets_values = [seed]
      continue
    }
    // First int-like slot is the seed/value; if a control string follows, force fixed.
    let seedIdx = wv.findIndex((v) => typeof v === 'number')
    if (seedIdx < 0) seedIdx = 0
    wv[seedIdx] = seed
    const controlIdx = wv.findIndex(
      (v) =>
        typeof v === 'string' &&
        ['fixed', 'randomize', 'increment', 'decrement', 'randomize each'].includes(
          v.toLowerCase()
        )
    )
    if (controlIdx >= 0) wv[controlIdx] = 'fixed'
  }
  return doc
}

export function readInjectedLtSeed(graph: WorkflowGraph): number | null {
  const nodes = findNodesByClass(graph, 'LoraTrainingSeed')
  const node = nodes[0]?.[1]
  if (!node) return null
  const v = node.inputs.value
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Inject LT contract nodes for the current LoRA / validation set. */
export function injectValidationInputs(
  graph: WorkflowGraph,
  datasetFolder: string,
  config: ValidationRunConfig,
  seed: number,
  target: NextValidationLora,
  stage?: {
    lorasFolder?: string
    validationLoraSubfolder?: string
    /** Resolved checkpoint filename; empty skips LT · Model injection. */
    model?: string
    /**
     * Override LT output folder / filename (Model Stress-Testing writes
     * `output/Stress N/{modelStem}` instead of `Set N/{loraStem}`).
     */
    outputFolder?: string
    outputFilename?: string
  }
): WorkflowGraph {
  const next = cloneGraph(graph)
  assertLtModelWiredAsFilename(next)

  const composed = composeValidationPrompt(
    config.prompt,
    target.stem,
    config.loraWeight,
    target.triggerKeyword
  )

  injectLtSeed(next, seed)

  if (!setInput(next, 'LoraTrainingPrompt', 'text', composed)) {
    throw new Error('Workflow must include an “LT · Prompt” node (comfyui-lora-training).')
  }
  // Stage checkpoint into Comfy models/loras so Load LoRA Tag can resolve <lora:stem>.
  setInput(next, 'LoraTrainingPrompt', 'lora_source', target.fullPath)
  setInput(
    next,
    'LoraTrainingPrompt',
    'existing_copy_policy',
    (config.existingCopyPolicy ??
      'reuse_if_identical_error_if_different') satisfies ExistingCopyPolicy
  )
  setInput(next, 'LoraTrainingPrompt', 'comfy_lora_root', stage?.lorasFolder?.trim() ?? '')
  setInput(
    next,
    'LoraTrainingPrompt',
    'comfy_lora_subfolder',
    stage?.validationLoraSubfolder?.trim() || '!Testing'
  )

  // Optional: workflows without this node keep working.
  const styleIndex = config.styleIndex === 1 ? 1 : 0
  setInput(next, 'LoraTrainingStyleIndex', 'value', styleIndex)

  const model = stage?.model?.trim() ?? ''
  if (model) {
    if (!injectLtModel(next, model)) {
      throw new Error(
        'Workflow must include an “LT · Model” node (comfyui-lora-training) when a validation model is set. Convert Load Diffusion Model’s unet_name (or CheckpointLoader ckpt_name) to an input and wire LT · Model into it.'
      )
    }
  }

  const outFolder =
    stage?.outputFolder?.trim() || validationSetOutputFolder(datasetFolder, config.setIndex)
  const outFilename = stage?.outputFilename?.trim() || target.stem
  setInput(next, 'LoraTrainingOutputFolder', 'folder', outFolder)
  if (!setInput(next, 'LoraTrainingOutputFilename', 'filename', outFilename)) {
    throw new Error(
      'Workflow must include an “LT · Output Filename” node (comfyui-lora-training).'
    )
  }

  return next
}
