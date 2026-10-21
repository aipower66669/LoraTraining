import { z } from 'zod'
import {
  ExistingCopyPolicySchema,
  StyleIndexSchema,
  normalizeStyleIndex
} from './validation-sets'

/**
 * Per-set Model Stress-Testing config: one fixed LoRA checkpoint, many Comfy
 * models. Same prompt/seed/weight/style as LoRA Validation; axes inverted.
 */
export const StressTestSetConfigSchema = z.object({
  prompt: z.string().default(''),
  seed: z.number().default(1),
  loraWeight: z.number().default(1),
  styleIndex: StyleIndexSchema,
  /** Comfy checkpoint / UNET names to stress against (tick list). */
  models: z.array(z.string()).default([]),
  /**
   * Basename of the chosen training checkpoint under `output/`
   * (e.g. `MyLora_000500.safetensors`). Null = not chosen yet.
   */
  checkpointFileName: z.string().nullable().default(null),
  existingCopyPolicy: ExistingCopyPolicySchema.default(
    'reuse_if_identical_error_if_different'
  )
})

export type StressTestSetConfig = z.infer<typeof StressTestSetConfigSchema>

export function defaultStressTestSetConfig(
  overrides?: Partial<StressTestSetConfig>
): StressTestSetConfig {
  return StressTestSetConfigSchema.parse(overrides ?? {})
}

/** New set cloned from the previous one (models kept, seed + 1). */
export function stressTestSetFromPrevious(previous: StressTestSetConfig): StressTestSetConfig {
  const base = StressTestSetConfigSchema.parse(previous)
  const nextSeed = base.seed <= 0 ? 1 : base.seed + 1
  return StressTestSetConfigSchema.parse({
    prompt: base.prompt,
    seed: nextSeed,
    loraWeight: base.loraWeight,
    styleIndex: normalizeStyleIndex(base.styleIndex),
    models: [...base.models],
    checkpointFileName: base.checkpointFileName,
    existingCopyPolicy: base.existingCopyPolicy
  })
}

/** Folder / tab label for 0-based index. */
export function stressTestSetLabel(index: number): string {
  return `Stress ${index + 1}`
}

/** True for directories named `Stress 1`, `Stress 2`, … under dataset output. */
export function isStressTestSetDirName(name: string): boolean {
  return /^Stress \d+$/.test(name)
}

/**
 * Filesystem-safe stem for a Comfy model name used as the preview basename
 * under `output/Stress N/{stem}.jpg`.
 *
 * Basename only — callers that need uniqueness across folders must use
 * {@link modelPreviewStemMap} (appends a stable hash of the full model id).
 */
export function sanitizeModelPreviewStem(modelName: string): string {
  const base = modelName.replace(/\\/g, '/').split('/').pop()?.trim() || 'model'
  const noExt = base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '')
  const cleaned = noExt
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[/\\]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return cleaned || 'model'
}

/** Short stable hash for disambiguating colliding sanitized stems. */
export function shortStableHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

/**
 * Map each Comfy model name → unique preview stem within the set.
 *
 * Always suffixes a short hash of the full model id (path + filename) so
 * `folderA/foo.safetensors` and `folderB/foo.safetensors` never share a file.
 * New previews are written under this stem; {@link previewStemsForModel} also
 * accepts legacy basename-only files from older builds.
 */
export function modelPreviewStemMap(models: string[]): Map<string, string> {
  const taken = new Set<string>()
  const out = new Map<string, string>()
  for (const modelName of models) {
    const base = sanitizeModelPreviewStem(modelName)
    let n = 0
    let stem = `${base.slice(0, 112)}_${shortStableHash(modelName)}`
    let key = stem.toLowerCase()
    while (taken.has(key)) {
      n += 1
      stem = `${base.slice(0, 110)}_${shortStableHash(`${modelName}#${n}`)}`
      key = stem.toLowerCase()
    }
    taken.add(key)
    out.set(modelName, stem)
  }
  return out
}

/**
 * Disk stems that satisfy a model: the current mapped stem, plus the legacy
 * basename-only stem from builds that did not hash the full model id.
 */
export function previewStemsForModel(modelName: string, mappedStem: string): string[] {
  const legacy = sanitizeModelPreviewStem(modelName)
  if (legacy.toLowerCase() === mappedStem.toLowerCase()) return [mappedStem]
  return [mappedStem, legacy]
}

/** True when `existingStemsLower` contains any acceptable stem for this model. */
export function modelHasPreviewStem(
  modelName: string,
  mappedStem: string,
  existingStemsLower: ReadonlySet<string>
): boolean {
  return previewStemsForModel(modelName, mappedStem).some((s) =>
    existingStemsLower.has(s.toLowerCase())
  )
}

/** Models in `models` that do not yet have a preview under `existingStemsLower`. */
export function modelsMissingPreviews(
  models: string[],
  existingStemsLower: ReadonlySet<string>
): string[] {
  const stems = modelPreviewStemMap(models)
  return models.filter((m) => {
    const stem = stems.get(m)
    return !stem || !modelHasPreviewStem(m, stem, existingStemsLower)
  })
}

/**
 * Drop selected Comfy model names that are no longer in the live Comfy list
 * (deleted / renamed weights). Keeps order; case-insensitive match.
 */
export function pruneModelsToAvailable(
  selected: readonly string[],
  available: readonly string[]
): { kept: string[]; removed: string[] } {
  const byLower = new Map<string, string>()
  for (const raw of available) {
    const name = raw.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, name)
  }
  const kept: string[] = []
  const removed: string[] = []
  const seen = new Set<string>()
  for (const raw of selected) {
    const name = raw.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const match = byLower.get(key)
    if (!match) {
      removed.push(name)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(match)
  }
  return { kept, removed }
}

/** Comfy / LT error when a selected checkpoint/UNET file is gone from disk. */
export function isMissingComfyModelError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /\bnot found\b/.test(m) &&
    (/\bfilename\b/.test(m) ||
      /\bdiffusion_models\b/.test(m) ||
      /\bcheckpoints\b/.test(m) ||
      /\bmodel in folder\b/.test(m))
  )
}
