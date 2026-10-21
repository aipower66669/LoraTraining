/** Folder name under ComfyUI `custom_nodes/`. */
export const LT_COMFY_NODES_DIR = 'comfyui-lora-training'

export type LtComfyNodesStatus = {
  /** Bundled copy shipped with this app build. */
  bundleFound: boolean
  bundlePath: string | null
  /** Resolved ComfyUI install root used for the check. */
  comfyRoot: string | null
  /** Absolute path to `{comfyRoot}/custom_nodes/comfyui-lora-training`. */
  installPath: string | null
  installed: boolean
}

export type InstallLtComfyNodesResult = {
  comfyRoot: string
  installPath: string
  /** True when files were copied; false when already up to date and skipped. */
  updated: boolean
  /** Library workflow JSON files created (only when missing). */
  workflowsSeeded: string[]
}

export type SeedLtWorkflowsResult = {
  /** Basenames written because the file was missing (never overwrites). */
  created: string[]
  /** Basenames skipped because a workflow file already exists. */
  skipped: string[]
}

/**
 * Infer ComfyUI root from a typical `models/loras` path, e.g.
 * `F:\ComfyUI\models\loras` → `F:\ComfyUI`.
 */
export function inferComfyRootFromLorasFolder(lorasFolder: string): string | null {
  const trimmed = lorasFolder.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const m = normalized.match(/^(.*)\/models\/loras$/i)
  return m?.[1]?.trim() || null
}

export function ltNodesInstallPath(comfyRoot: string): string {
  const root = comfyRoot.trim().replace(/[/\\]+$/, '')
  return `${root}/custom_nodes/${LT_COMFY_NODES_DIR}`.replace(/\//g, '\\')
}
