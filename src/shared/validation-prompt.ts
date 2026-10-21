function formatLoraWeight(weight: number): string {
  if (!Number.isFinite(weight)) return '1'
  const s = String(weight)
  if (!s.includes('e') && !s.includes('E')) {
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  }
  return String(Number(weight))
}

/**
 * Build the positive prompt injected into LT · Prompt for a validation job:
 * `{userPrompt}, <lora:{stem}:{weight}> {trigger}`
 *
 * Use the bare stem only — ComfyUI Load LoRA Tag resolves by filename; folder
 * prefixes (especially `!Testing`) break loading. Staging still uses the
 * subfolder via `comfy_lora_subfolder` on the node.
 */
export function composeValidationPrompt(
  userPrompt: string,
  stem: string,
  weight: number,
  triggerKeyword: string
): string {
  const tag = `<lora:${stem}:${formatLoraWeight(weight)}>`
  const trigger = triggerKeyword.trim()
  const loraAndKeyword = trigger ? `${tag} ${trigger}` : tag
  const prompt = userPrompt.trim()
  if (!prompt) return loraAndKeyword
  if (prompt.endsWith(',')) return `${prompt} ${loraAndKeyword}`
  return `${prompt}, ${loraAndKeyword}`
}
