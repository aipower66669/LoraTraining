import { isPreviewOutputDirName } from './validation-sets'

/**
 * How deep under `{dataset}/output` to look for `.safetensors`.
 * AI Toolkit writes checkpoints at the output root or one job-named folder —
 * never recurse into caches / samples (that was a multi-minute walk on big runs).
 */
export const CHECKPOINT_SCAN_MAX_DEPTH = 1

/**
 * Subtrees under `output/` that must not be walked when listing LoRA checkpoints.
 */
export function shouldSkipOutputSubtree(name: string): boolean {
  if (!name || name.startsWith('.')) return true
  if (isPreviewOutputDirName(name)) return true
  return /^(samples?|logs?|.*cache.*|text_embeds?|latents?|diffusers|optimizer)$/i.test(
    name
  )
}
