import type { AppSettings } from './schemas/settings'

export type ToolConfigFlags = {
  joyCaption: boolean
  aiToolkit: boolean
  comfy: boolean
}

/** JoyCaption: working directory required; script defaults to the bundled captioner. */
export function isJoyCaptionConfigured(
  tools: AppSettings['tools']['joyCaption']
): boolean {
  return Boolean(tools.workingDirectory.trim())
}

/** AI Toolkit: working directory is the runtime's required configuration gate. */
export function isAiToolkitConfigured(
  tools: AppSettings['tools']['aiToolkit']
): boolean {
  return Boolean(tools.workingDirectory.trim())
}

/** ComfyUI: LoRA folder must be set (required for validation staging and output tools). */
export function isComfyConfigured(comfy: AppSettings['comfy']): boolean {
  return Boolean(comfy.lorasFolder.trim())
}

export function toolConfigFlags(settings: AppSettings | null | undefined): ToolConfigFlags {
  if (!settings) {
    return { joyCaption: false, aiToolkit: false, comfy: false }
  }
  return {
    joyCaption: isJoyCaptionConfigured(settings.tools.joyCaption),
    aiToolkit: isAiToolkitConfigured(settings.tools.aiToolkit),
    comfy: isComfyConfigured(settings.comfy)
  }
}
