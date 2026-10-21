import type { WorkflowGraph } from './workflow-profile'

/** LT nodes whose model-related inputs are injected at queue time — not fixed in the graph. */
export const LT_INJECT_NODE_CLASSES = new Set([
  'LoraTrainingPrompt',
  'LoraTrainingSeed',
  'LoraTrainingStyleIndex',
  'LoraTrainingModel',
  'LoraTrainingOutputFolder',
  'LoraTrainingOutputFilename',
  'LoraTrainingInputImage',
  'LoraTrainingDenoise',
  'LoraTrainingMaxSize'
])

/** Loader / weight keys that may hold a fixed filename when not wired from another node. */
const MODEL_INPUT_KEYS = new Set([
  'ckpt_name',
  'unet_name',
  'vae_name',
  'clip_name',
  'lora_name',
  'gguf_name',
  'model_name',
  'control_net_name',
  'weight_name',
  'ipadapter_file',
  'style_model_name',
  'encoder_name'
])

const MODEL_FILE_RE = /\.(safetensors|ckpt|pt|pth|bin|onnx|gguf)$/i

export type FixedWorkflowModelRef = {
  nodeId: string
  classType: string
  inputKey: string
  filename: string
}

function isNodeReference(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
}

/** Collect hard-coded model filenames from a Comfy API workflow graph (excludes LT inject nodes). */
export function extractFixedWorkflowModels(graph: WorkflowGraph): FixedWorkflowModelRef[] {
  const out: FixedWorkflowModelRef[] = []
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== 'object') continue
    const classType = node.class_type ?? ''
    if (LT_INJECT_NODE_CLASSES.has(classType)) continue
    const inputs = node.inputs ?? {}
    for (const [key, value] of Object.entries(inputs)) {
      if (isNodeReference(value)) continue
      if (typeof value !== 'string' || !value.trim()) continue
      const trimmed = value.trim()
      const looksLikeFile = MODEL_FILE_RE.test(trimmed)
      const looksLikeModelKey = MODEL_INPUT_KEYS.has(key)
      if (!looksLikeFile && !looksLikeModelKey) continue
      if (!looksLikeFile && looksLikeModelKey && (trimmed.includes(' ') || trimmed.length > 180)) continue
      out.push({ nodeId, classType, inputKey: key, filename: trimmed })
    }
  }
  return out
}

export function dedupeFixedWorkflowModels(
  refs: FixedWorkflowModelRef[]
): FixedWorkflowModelRef[] {
  const seen = new Set<string>()
  const out: FixedWorkflowModelRef[] = []
  for (const ref of refs) {
    const key = `${ref.filename}\0${ref.classType}\0${ref.inputKey}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename))
}
