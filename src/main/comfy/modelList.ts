import {
  comfyHttpBase,
  formatComfyConnectError,
  isComfyUnreachableError,
  type ComfyConnectionSettings
} from '@shared/comfy'
import { loadSettings } from '../settings/store'

/**
 * ComfyUI model folder types that hold loadable “main” weights.
 * Modern Flux / Krea workflows use `diffusion_models`, not `checkpoints`.
 */
const MODEL_FOLDERS = ['checkpoints', 'diffusion_models'] as const

/** Session cache — Comfy model list rarely changes. */
let cachedModels: string[] | null = null

function uniqSorted(names: string[]): string[] {
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  )
}

export function parseModelsPayload(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json.filter((x): x is string => typeof x === 'string')
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    for (const key of ['checkpoints', 'models', 'files', 'diffusion_models']) {
      const v = obj[key]
      if (Array.isArray(v)) {
        return v.filter((x): x is string => typeof x === 'string')
      }
    }
  }
  return []
}

/** Pull combo-list options from an object_info node definition. */
export function parseObjectInfoComboLists(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const root = json as Record<string, unknown>
  const out: string[] = []

  const nodes: Array<Record<string, unknown>> = []
  for (const v of Object.values(root)) {
    if (v && typeof v === 'object' && 'input' in (v as object)) {
      nodes.push(v as Record<string, unknown>)
    }
  }
  // `/object_info/Foo` sometimes returns the node body directly.
  if (nodes.length === 0 && 'input' in root) nodes.push(root)

  for (const node of nodes) {
    const input = node['input'] as Record<string, unknown> | undefined
    for (const section of ['required', 'optional'] as const) {
      const block = input?.[section] as Record<string, unknown> | undefined
      if (!block) continue
      for (const [key, spec] of Object.entries(block)) {
        if (!/name$/i.test(key) && key !== 'ckpt_name' && key !== 'unet_name') continue
        if (!Array.isArray(spec) || !Array.isArray(spec[0])) continue
        for (const item of spec[0]) {
          if (typeof item === 'string') out.push(item)
        }
      }
    }
  }
  return out
}

async function fetchFolderModels(
  conn: ComfyConnectionSettings,
  folder: string
): Promise<string[]> {
  const base = comfyHttpBase(conn)
  let res: Response
  try {
    res = await fetch(`${base}/models/${encodeURIComponent(folder)}`, {
      signal: AbortSignal.timeout(8000)
    })
  } catch (err) {
    throw new Error(formatComfyConnectError(conn, err))
  }
  if (res.status === 404) return []
  if (!res.ok) return []
  const json = (await res.json().catch(() => null)) as unknown
  return parseModelsPayload(json)
}

async function fetchObjectInfoCombos(
  conn: ComfyConnectionSettings,
  nodeClass: string
): Promise<string[]> {
  const base = comfyHttpBase(conn)
  let res: Response
  try {
    res = await fetch(`${base}/object_info/${encodeURIComponent(nodeClass)}`, {
      signal: AbortSignal.timeout(12000)
    })
  } catch (err) {
    throw new Error(formatComfyConnectError(conn, err))
  }
  if (!res.ok) return []
  const json = (await res.json().catch(() => null)) as unknown
  return parseObjectInfoComboLists(json)
}

async function fetchAllModels(conn: ComfyConnectionSettings): Promise<string[]> {
  const collected: string[] = []

  for (const folder of MODEL_FOLDERS) {
    collected.push(...(await fetchFolderModels(conn, folder)))
  }

  if (collected.length === 0) {
    // Fallbacks when /models/{type} is empty or unavailable.
    collected.push(
      ...(await fetchObjectInfoCombos(conn, 'CheckpointLoaderSimple')),
      ...(await fetchObjectInfoCombos(conn, 'UNETLoader'))
    )
  }

  const models = uniqSorted(collected)
  if (models.length === 0) {
    const base = comfyHttpBase(conn)
    throw new Error(
      `ComfyUI at ${base} has no loadable models in checkpoints or diffusion_models. ` +
        `Your validation workflow likely uses UNET / diffusion weights — put them under ` +
        `ComfyUI/models/diffusion_models (or checkpoints for classic SD loaders).`
    )
  }
  return models
}

/**
 * List ComfyUI model filenames (checkpoints + diffusion_models).
 * Cached for the app session unless `forceRefresh` is true.
 */
export async function listComfyCheckpointModels(
  forceRefresh = false
): Promise<{ models: string[]; fromCache: boolean }> {
  if (!forceRefresh && cachedModels) {
    return { models: cachedModels, fromCache: true }
  }
  const settings = await loadSettings()
  try {
    const models = await fetchAllModels(settings.comfy)
    cachedModels = models
    return { models: cachedModels, fromCache: false }
  } catch (err) {
    if (err instanceof Error && !isComfyUnreachableError(err)) throw err
    throw new Error(formatComfyConnectError(settings.comfy, err))
  }
}

export function clearComfyModelListCache(): void {
  cachedModels = null
}
