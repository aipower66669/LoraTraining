export interface ComfyConnectionSettings {
  host: string
  port: number
  secure: boolean
}

export const DEFAULT_COMFY_CONNECTION: ComfyConnectionSettings = {
  host: '127.0.0.1',
  port: 8188,
  secure: false
}

export function comfyHttpBase(conn: ComfyConnectionSettings): string {
  const scheme = conn.secure ? 'https' : 'http'
  return `${scheme}://${conn.host}:${conn.port}`
}

export function comfyWsUrl(conn: ComfyConnectionSettings, clientId: string): string {
  const scheme = conn.secure ? 'wss' : 'ws'
  return `${scheme}://${conn.host}:${conn.port}/ws?clientId=${encodeURIComponent(clientId)}`
}

/** True for typical Node/Chromium failures when ComfyUI is down or unreachable. */
export function isComfyUnreachableError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err)
  return /fetch failed|failed to fetch|econnrefused|enotfound|etimedout|econnreset|network|socket|abort|undici/i.test(
    raw
  )
}

/**
 * User-facing message when HTTP/WS to ComfyUI fails.
 * Always includes the configured server URL (host:port).
 */
export function formatComfyConnectError(conn: ComfyConnectionSettings, err: unknown): string {
  const base = comfyHttpBase(conn)
  const raw = err instanceof Error ? err.message : String(err)
  if (isComfyUnreachableError(err)) {
    return (
      `Could not connect to ComfyUI at ${base}. ` +
      `Ensure the ComfyUI process is running and Settings → ComfyUI uses the correct host and port.`
    )
  }
  return `ComfyUI request failed (${base}): ${raw}`
}

/**
 * Collapse Comfy / Python walls of text to a short, actionable first line.
 * Prefers `ValueError: …` / Comfy’s “Exception during processing” summary.
 */
export function shortenComfyError(message: string, maxLen = 280): string {
  const raw = message.trim()
  if (!raw) return 'ComfyUI execution error'
  const named = raw.match(
    /\b((?:ValueError|RuntimeError|TypeError|OSError|KeyError|AttributeError|Exception):\s*[^\n\r]+)/
  )
  if (named?.[1]) return clipComfyErrorLine(named[1], maxLen)
  const banner = raw.match(
    /Exception during processing !!!\s*([^\n\r]+)/i
  )
  if (banner?.[1]) return clipComfyErrorLine(banner[1], maxLen)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (/^Traceback\b/i.test(t)) continue
    if (/^File "/.test(t)) continue
    if (/^\[ERROR\]\s*Traceback/i.test(t)) continue
    if (t === '^' || /^~+$/.test(t)) continue
    return clipComfyErrorLine(t.replace(/^\[ERROR\]\s*/i, ''), maxLen)
  }
  return clipComfyErrorLine(raw, maxLen)
}

function clipComfyErrorLine(line: string, maxLen: number): string {
  const t = line.replace(/\s+/g, ' ').trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`
}

export type ExistingCopyPolicy =
  | 'reuse_if_identical_error_if_different'
  | 'overwrite_if_different'

export type { ValidationSetConfig } from './validation-sets'
export {
  defaultValidationSetConfig,
  validationSetLabel,
  isValidationSetDirName
} from './validation-sets'

/** Details-pane inputs applied into the saved workflow before each queue. */
export interface ValidationRunConfig {
  datasetId: string
  /** 0-based index into the dataset's validationSets. */
  setIndex: number
  /** Positive prompt injected into LoraTrainingPrompt. */
  prompt: string
  /** Sampler seed; ≤0 = random each job. */
  seed: number
  loraWeight: number
  /** 0 = realistic, 1 = anime — injected into LoraTrainingStyleIndex. */
  styleIndex: 0 | 1
  /** Checkpoint for this set; `"Default"` = Settings default. */
  validationModel: string
  existingCopyPolicy: ExistingCopyPolicy
}

export type ValidationRunStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error'

export interface ValidationProgress {
  status: ValidationRunStatus
  datasetId: string | null
  setIndex: number | null
  setLabel: string | null
  jobsCompleted: number
  lastMessage?: string
  error?: string
  /** Dataset-relative path of the most recently written set preview (e.g. output/Set 1/foo.jpg). */
  lastPreviewRelativePath?: string | null
  /** Checkpoint file name for that preview (e.g. foo.safetensors). */
  lastPreviewFileName?: string | null
  /** Live ComfyUI node / sampler progress (from WebSocket). */
  comfyNodeTitle?: string | null
  comfyStep?: number | null
  comfyMax?: number | null
  /** Short status from Comfy (e.g. "Model Initializing ..."). */
  comfyDetail?: string | null
}

/** Model Stress-Testing progress (same shape as validation + current model). */
export interface StressTestProgress extends ValidationProgress {
  /** Comfy model currently being generated (when running). */
  currentModel?: string | null
  /** Jobs remaining estimate for the active set (selected models still missing). */
  jobsTotal?: number | null
}

/** Validation Weight progress (same shape as validation + current weight). */
export interface WeightValidationProgress extends ValidationProgress {
  /** LoRA weight currently being generated (when running). */
  currentWeight?: number | null
  /** Jobs remaining estimate for the active set (weights still missing). */
  jobsTotal?: number | null
}

export const DEFAULT_VALIDATION_RUN_CONFIG: Omit<ValidationRunConfig, 'datasetId' | 'setIndex'> = {
  prompt: '',
  seed: 0,
  loraWeight: 1,
  styleIndex: 0,
  validationModel: 'Default',
  existingCopyPolicy: 'reuse_if_identical_error_if_different'
}

export const PREVIEW_COMPLETE_MARKER = 'LoRA preview generation is complete'

export type { UpscaleConfig } from './upscale-config'
export { defaultUpscaleConfig, cloneUpscaleConfig } from './upscale-config'

/** Details-pane inputs applied into the saved Upscale workflow before queuing. */
export interface UpscaleRunConfig {
  datasetId: string
  /** Canonical dataset filename this run is for (identity — unaffected by which physical file is the current source). */
  fileName: string
  /** Absolute path to the resolved source image: pristine `$DATA` (never tip). */
  sourceImagePath: string
  /** Positive prompt injected into LoraTrainingPrompt. */
  prompt: string
  /** Sampler seed; ≤0 = random each run. */
  seed: number
  /** Checkpoint for this run; empty = leave the workflow's own loader untouched. */
  model: string
  /** KSampler denoise strength (0..1). */
  denoise: number
  /** 0 = realistic, 1 = anime — injected into LoraTrainingStyleIndex. */
  styleIndex: 0 | 1
  /** Largest-dimension target — injected into LoraTrainingMaxSize. */
  maxSize: number
}

export type UpscaleRunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface UpscaleProgress {
  status: UpscaleRunStatus
  datasetId: string | null
  /** Canonical dataset filename this progress describes. */
  fileName: string | null
  lastMessage?: string
  error?: string
  /** Whether tip ADS versions exist (`VER_COUNT ≥ 1`). */
  hasOriginal?: boolean
  /** 1-based index when Run all is active; omitted for single-image runs. */
  batchIndex?: number | null
  /** Total images in a Run all queue; omitted for single-image runs. */
  batchTotal?: number | null
  /** Live ComfyUI node / sampler progress (from WebSocket). */
  comfyNodeTitle?: string | null
  comfyStep?: number | null
  comfyMax?: number | null
  /** Short status from Comfy (e.g. "Model Initializing ..."). */
  comfyDetail?: string | null
}

export const DEFAULT_UPSCALE_PROGRESS: UpscaleProgress = {
  status: 'idle',
  datasetId: null,
  fileName: null,
  batchIndex: null,
  batchTotal: null
}

export type { DiversifyConfig, DiversifyMode } from './diversify-config'
export { defaultDiversifyConfig, cloneDiversifyConfig } from './diversify-config'

/** Inputs applied into a Diversify (Context / Expression) workflow before queuing. */
export interface DiversifyRunConfig {
  datasetId: string
  mode: import('./diversify-config').DiversifyMode
  /** Source image filename in the dataset. */
  fileName: string
  sourceImagePath: string
  prompt: string
  seed: number
  /** Final basename to write into the dataset after reencode (e.g. `photo_d01.jpg`). */
  outputFileName: string
}

export type DiversifyRunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface DiversifyProgress {
  status: DiversifyRunStatus
  datasetId: string | null
  mode: import('./diversify-config').DiversifyMode | null
  /** Source image currently being diversified. */
  fileName: string | null
  /** Latest generated sibling basename (if any). */
  outputFileName?: string | null
  lastMessage?: string
  error?: string
  batchIndex?: number | null
  batchTotal?: number | null
  comfyNodeTitle?: string | null
  comfyStep?: number | null
  comfyMax?: number | null
  comfyDetail?: string | null
}

export const DEFAULT_DIVERSIFY_PROGRESS: DiversifyProgress = {
  status: 'idle',
  datasetId: null,
  mode: null,
  fileName: null,
  outputFileName: null,
  batchIndex: null,
  batchTotal: null
}
